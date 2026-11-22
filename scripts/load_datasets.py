"""Load the cleaned public datasets into TimescaleDB + data/processed (T07).

    python scripts/load_datasets.py                 # all three
    python scripts/load_datasets.py ai4i cmapss     # some
    python scripts/load_datasets.py --no-db         # only write data/processed/*.parquet

Idempotent: rows of a dataset (source = ai4i | cmapss | cwru) are deleted
before being re-inserted. Datasets have no wall-clock time, so each sample is
placed on a synthetic timeline starting 2026-01-01 UTC (far from live data):
  ai4i   1 record = 1 minute        machine AI4I-<L|M|H>
  cmapss 1 cycle  = 1 hour          machine CMAPSS-FD001-<train|test>-U###
  cwru   1 window = 2048/12000 s    machine CWRU-<class>
"""
from __future__ import annotations

import argparse
import io
import json
import os
from datetime import datetime, timezone

import pandas as pd
import psycopg2

from roottwin.datasets import PROCESSED, ai4i, cmapss, cwru

T0 = pd.Timestamp(datetime(2026, 1, 1, tzinfo=timezone.utc))
DB = os.getenv("DATABASE_URL", "postgresql://twin:twin_dev_password@localhost:5433/twin")


# ---------------------------------------------------------------- build frames
def build_ai4i():
    df = ai4i.load()
    df.to_parquet(PROCESSED / "ai4i.parquet", index=False)
    df["time"] = T0 + pd.to_timedelta(df["udi"] - 1, unit="min")
    df["machine_id"] = "AI4I-" + df["quality"].astype(str)
    readings = df.melt(id_vars=["time", "machine_id"], value_vars=list(ai4i.SENSORS),
                       var_name="sensor", value_name="value")
    fails = df[df["failure"] == 1]
    events = pd.DataFrame({
        "time": fails["time"], "machine_id": fails["machine_id"], "event_type": "failure",
        "state": "down",
        "fault_code": fails["failure_mode"].map(lambda m: ai4i.TO_CATALOG.get(m)),
        "severity": 5,
        "payload": fails.apply(lambda r: json.dumps({"ai4i_mode": r["failure_mode"], "udi": int(r["udi"]),
                                                     "product_id": r["product_id"]}), axis=1),
    })
    units = {k: u for k, (_, u) in ai4i.SENSORS.items()}
    machines = sorted(df["machine_id"].unique())
    return readings, events, machines, units


def build_cmapss():
    train, test = cmapss.load("FD001")
    sensors = cmapss.informative_sensors(train)
    train.to_parquet(PROCESSED / "cmapss_fd001_train.parquet", index=False)
    test.to_parquet(PROCESSED / "cmapss_fd001_test.parquet", index=False)
    frames, events = [], []
    for split, df in (("train", train), ("test", test)):
        d = df.copy()
        d["machine_id"] = d["unit"].map(lambda u: f"CMAPSS-FD001-{split}-U{u:03d}")
        d["time"] = T0 + pd.to_timedelta(d["cycle"], unit="h")
        frames.append(d.melt(id_vars=["time", "machine_id"], value_vars=sensors,
                             var_name="sensor", value_name="value"))
        if split == "train":  # run-to-failure: last cycle is a failure
            last = d.loc[d.groupby("unit")["cycle"].idxmax()]
            events.append(pd.DataFrame({
                "time": last["time"], "machine_id": last["machine_id"], "event_type": "failure",
                "state": "down", "fault_code": None, "severity": 5,
                "payload": last["cycle"].map(lambda c: json.dumps({"cmapss_fault": "HPC degradation",
                                                                   "cycles": int(c)})),
            }))
    readings = pd.concat(frames, ignore_index=True)
    readings["sensor"] = "cmapss_" + readings["sensor"]
    machines = sorted(readings["machine_id"].unique())
    return readings, pd.concat(events, ignore_index=True), machines, {f"cmapss_{s}": "raw" for s in sensors}


def build_cwru():
    f = cwru.load_features()
    f.to_parquet(PROCESSED / "cwru_features.parquet", index=False)
    X, y = cwru.load_windows(step=cwru.WINDOW // 4)  # 75 % overlap for the autoencoder (T16)
    import numpy as np
    np.savez_compressed(PROCESSED / "cwru_windows.npz", X=X, y=y)
    f["machine_id"] = "CWRU-" + f["label"].astype(str)
    f["time"] = T0 + pd.to_timedelta(f["window"] * cwru.WINDOW / cwru.FS, unit="s")
    feats = ["rms", "peak", "crest_factor", "kurtosis"]
    readings = f.melt(id_vars=["time", "machine_id"], value_vars=feats, var_name="sensor", value_name="value")
    readings["sensor"] = "cwru_de_" + readings["sensor"]
    first_fault = f[f["is_fault"] == 1].groupby("machine_id", as_index=False).first()
    events = pd.DataFrame({
        "time": first_fault["time"], "machine_id": first_fault["machine_id"], "event_type": "fault_label",
        "state": "degraded",
        "fault_code": first_fault["label"].astype(str).map(cwru.TO_CATALOG), "severity": 3,
        "payload": first_fault["label"].astype(str).map(lambda l: json.dumps({"cwru_class": l, "fault_diameter_in": 0.007})),
    })
    units = {f"cwru_de_{k}": u for k, u in (("rms", "g"), ("peak", "g"), ("crest_factor", "-"), ("kurtosis", "-"))}
    return readings, events, sorted(f["machine_id"].unique()), units


BUILDERS = {"ai4i": build_ai4i, "cmapss": build_cmapss, "cwru": build_cwru}


# ---------------------------------------------------------------- write to DB
def copy_df(cur, table: str, df: pd.DataFrame, cols: list[str]) -> None:
    buf = io.StringIO()
    df[cols].to_csv(buf, index=False, header=False, na_rep="\\N")
    buf.seek(0)
    cur.copy_expert(f"COPY {table} ({', '.join(cols)}) FROM STDIN WITH (FORMAT csv, NULL '\\N')", buf)


def load_db(conn, source: str, readings, events, machines, units) -> None:
    with conn.cursor() as cur:
        cur.execute("DELETE FROM sensor_readings WHERE source = %s", (source,))
        cur.execute("DELETE FROM events WHERE source = %s", (source,))
        cur.executemany("INSERT INTO machines (machine_id, line_id, source) VALUES (%s, 'datasets', %s) "
                        "ON CONFLICT (machine_id) DO NOTHING", [(m, source) for m in machines])
        cur.executemany("INSERT INTO sensor_types (sensor, unit, description) VALUES (%s, %s, %s) "
                        "ON CONFLICT (sensor) DO NOTHING",
                        [(s, u, f"{source} dataset") for s, u in units.items()])
        r = readings.assign(source=source, scenario_id=source.upper())
        copy_df(cur, "sensor_readings", r, ["time", "machine_id", "sensor", "value", "source", "scenario_id"])
        e = events.assign(source=source, scenario_id=source.upper())
        e["severity"] = e["severity"].astype("Int64")
        copy_df(cur, "events", e, ["time", "machine_id", "event_type", "state", "fault_code", "severity",
                                   "source", "scenario_id", "payload"])
    conn.commit()


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("datasets", nargs="*", help=f"subset of {list(BUILDERS)} (default: all)")
    p.add_argument("--no-db", action="store_true")
    a = p.parse_args()
    a.datasets = a.datasets or list(BUILDERS)
    if bad := set(a.datasets) - set(BUILDERS):
        p.error(f"unknown dataset(s): {sorted(bad)}")
    PROCESSED.mkdir(parents=True, exist_ok=True)
    conn = None if a.no_db else psycopg2.connect(DB)
    for name in a.datasets:
        readings, events, machines, units = BUILDERS[name]()
        msg = f"[{name}] {len(readings):>7} readings, {len(events):>4} events, {len(machines):>3} machines"
        if conn:
            load_db(conn, name, readings, events, machines, units)
            msg += "  -> TimescaleDB"
        print(msg + "  + data/processed/")
    if conn:
        conn.close()


if __name__ == "__main__":
    main()
