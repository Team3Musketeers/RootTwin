"""Component-labelled dataset (components_v1): per-minute, per-component channels with root-cause labels.

For every machine M1..M6 and every fault code located on one of its components (faults/components.yaml),
run the line engine with that fault injected and record each component's local channels. Rows are labelled
with the faulted component, so a model can learn *which part* fails, not only which machine - what the
3D twin needs to highlight the exact part in red.

    python scripts/make_component_dataset.py              # -> data/processed/components_v1.parquet
    python scripts/make_component_dataset.py --seeds 2    # quicker
"""
from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
import pandas as pd

from roottwin.components import load_components, machine_components
from roottwin.line import Line

OUT = Path(__file__).resolve().parents[1] / "data" / "processed" / "components_v1.parquet"


def run(machine: str, code: str | None, seed: int, minutes: int, inject_at: int) -> list[dict]:
    line = Line(seed=seed)
    line.command("LINE", "start_line")
    rng = np.random.default_rng(seed + 1000)
    idx = [m.id for m in line.machines].index(machine)
    rows = []
    for minute in range(minutes):
        if code and minute == inject_at:
            line.command(machine, "inject_fault", {"fault_code": code})
        line.step(1.0)
        m = line.machines[idx]
        for c in machine_components(machine, line.sensors(idx), m.faults, m.wear, line.t, rng):
            base = {"scenario": f"{machine}-{code or 'NONE'}-{seed}", "t_min": round(line.t, 1), "machine_id": machine,
                    "component_id": c["id"], "component_kind": c["kind"], "machine_status": m.status, "health": c["health"],
                    "fault_code": c["fault"]["code"] if c["fault"] else None,
                    "fault_progress": c["fault"]["progress"] if c["fault"] else 0.0,
                    "label": int(c["fault"] is not None and c["fault"]["state"] != "ok")}
            rows += [{**base, "channel": k, "value": v["value"], "unit": v["unit"]} for k, v in c["channels"].items()]
    return rows


def build(seeds: int = 4, minutes: int = 240, inject_at: int = 60) -> pd.DataFrame:
    rows = []
    for mid, m in load_components().items():
        codes = sorted({f for c in m["components"] for f in c["faults"]})
        for seed in range(seeds):
            rows += run(mid, None, seed, minutes, inject_at)                   # healthy reference run
            for code in codes:
                rows += run(mid, code, seed, minutes, inject_at)
    return pd.DataFrame(rows)


def main():
    a = argparse.ArgumentParser()
    a.add_argument("--seeds", type=int, default=4)
    a.add_argument("--minutes", type=int, default=240)
    a.add_argument("--out", type=Path, default=OUT)
    args = a.parse_args()
    df = build(args.seeds, args.minutes)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    df.to_parquet(args.out, index=False)
    print(f"{len(df):,} rows, {df.scenario.nunique()} scenarios, {df.component_id.nunique()} components -> {args.out}")
    print(df.groupby("machine_id").label.mean().round(3).rename("faulty share").to_string())


if __name__ == "__main__":
    main()
