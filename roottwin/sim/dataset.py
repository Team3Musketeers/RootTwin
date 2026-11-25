"""Dataset v1 (T12, Person A): labelled simulated scenarios as parquet and in TimescaleDB.

    python -m roottwin.sim dataset --generate 200 --seed 42 --jobs 4 --db

- Scenarios: roottwin.faults.generate_scenarios (B's T09 generator), replayed on the real
  SimPy line with the maintenance team and a corrective policy (a down machine is reported
  after `response_min`, then the nearest qualified worker goes).
- Timeline: scenario i is one 8-hour morning shift on its own day, from 2026-02-02 06:00 UTC
  (after the public datasets, which start 2026-01-01; long before the live line), so time
  queries never mix two scenarios.
- Database: every message goes through roottwin.contracts.to_rows (the ingestor's own
  validation), then COPY into sensor_readings / events / production. Repairs and inspections
  also become rows of `interventions` (MTTR view, T28 benchmark). Loading is idempotent:
  rows of the same scenario_ids are deleted first.
- Parquet: one row per (minute, machine), same columns as roottwin.faults.offline.simulate
  (+ time, activity, health, speed_factor), for B's training scripts.
"""
from __future__ import annotations

import csv
import io
import json
import os
from datetime import datetime, timedelta, timezone
from typing import Any, Iterable

from roottwin.contracts import COLUMNS, to_rows
from roottwin.faults.scenario import Scenario
from roottwin.sim.sinks import MemorySink

DATASET_T0 = datetime(2026, 2, 2, 6, 0, tzinfo=timezone.utc)      # a Monday
DEFAULT_DB = "postgresql://twin:twin_dev_password@localhost:5433/twin"
INTERVENTION_COLUMNS = ("time_start", "time_end", "machine_id", "worker_id", "action", "fault_code",
                        "decided_by", "cost_eur", "scenario_id")
_DECIDED_BY = {"baseline": "corrective"}       # issued_by -> interventions.decided_by vocabulary


def scenario_start(index: int) -> datetime:
    return DATASET_T0 + timedelta(days=index)


def _csv(rows: Iterable[tuple]) -> str:
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\n")
    for r in rows:
        w.writerow([json.dumps(v) if isinstance(v, dict) else
                    v.isoformat() if isinstance(v, datetime) else v for v in r])
    return buf.getvalue()


def _intervention(table: str, row: tuple) -> tuple | None:
    """repair_end / inspection event row -> interventions row."""
    time, machine_id, event_type, _state, fault_code, _sev, _source, scenario_id, payload = row
    if event_type == "repair_end":
        start = time - timedelta(minutes=float(payload.get("minutes", 0)))
        action, cost = payload.get("action"), payload.get("cost_eur")
    elif event_type == "inspection":
        start, action, cost = time - timedelta(minutes=5), "inspect", 0
    else:
        return None
    decided = payload.get("decided_by")
    return (start, time, machine_id, payload.get("worker_id"), action, fault_code,
            _DECIDED_BY.get(decided, decided), cost, scenario_id)


def run_one(args: tuple[Scenario, int, dict[str, Any]]):
    """Simulate one scenario -> (labelled frame, CSV text per table). Top-level for multiprocessing."""
    from roottwin.sim.runner import simulate_scenario

    sc, index, kw = args
    sink = MemorySink()
    df = simulate_scenario(sc, start_ts=scenario_start(index), sink=sink, **kw)
    tables: dict[str, list[tuple]] = {"sensor_readings": [], "events": [], "production": [], "interventions": []}
    for topic, body in sink.messages:
        table, rows, _ = to_rows(topic, json.dumps(body))          # the ingestor's validation
        tables[table].extend(rows)
        if table == "events":
            tables["interventions"].extend(r for r in map(lambda r: _intervention(table, r), rows) if r)
    return df, {t: _csv(rows) for t, rows in tables.items()}


def iter_scenarios(scenarios: list[Scenario], jobs: int = 1, **kw):
    """Yield (scenario, frame, csv_tables) in order, optionally from parallel processes."""
    args = [(sc, i, kw) for i, sc in enumerate(scenarios)]
    if jobs <= 1:
        for a in args:
            yield (a[0], *run_one(a))
        return
    from concurrent.futures import ProcessPoolExecutor

    with ProcessPoolExecutor(max_workers=jobs) as pool:
        for a, (df, tables) in zip(args, pool.map(run_one, args, chunksize=2)):
            yield a[0], df, tables


def connect(db_url: str | None = None):
    import psycopg2

    return psycopg2.connect(db_url or os.getenv("DATABASE_URL", DEFAULT_DB))


def delete_scenarios(conn, scenario_ids: list[str]) -> None:
    with conn.cursor() as cur:
        for table in ("sensor_readings", "events", "production", "interventions"):
            cur.execute(f"DELETE FROM {table} WHERE scenario_id = ANY(%s)", (scenario_ids,))
    conn.commit()


def copy_tables(conn, tables: dict[str, str]) -> None:
    columns = {**COLUMNS, "interventions": INTERVENTION_COLUMNS}
    with conn.cursor() as cur:
        for table, text in tables.items():
            if text:
                cur.copy_expert(f"COPY {table} ({', '.join(columns[table])}) FROM STDIN WITH (FORMAT csv)",
                                io.StringIO(text))
    conn.commit()


def generate_dataset(scenarios: list[Scenario], *, jobs: int = 1, conn=None, progress=None, **kw):
    """Simulate every scenario; load it into the DB if `conn` is given; return the labelled frame."""
    import pandas as pd

    if conn is not None:
        delete_scenarios(conn, [s.scenario_id for s in scenarios])
    frames = []
    for i, (sc, df, tables) in enumerate(iter_scenarios(scenarios, jobs, **kw), 1):
        frames.append(df)
        if conn is not None:
            copy_tables(conn, tables)
        if progress:
            progress(i, len(scenarios))
    return pd.concat(frames, ignore_index=True)
