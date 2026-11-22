"""Offline labelled telemetry from fault scenarios (no MQTT, no SimPy).

A stand-in for the real simulation's dataset generation (T12) so detectors can
be trained/evaluated on OUR fault signatures today. Same nominal values and
noise as scripts/publish_fake_data.py; faults applied with ActiveFault.
Replace with Person A's simulation output once dataset v1 exists.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from roottwin.faults.models import ActiveFault, load_catalog, worst_state
from roottwin.faults.scenario import Scenario

NOMINAL = {"vibration": 2.0, "temperature": 45.0, "current": 12.0, "cadence": 30.0}
SENSORS = list(NOMINAL)


def simulate(sc: Scenario, step_min: float = 1.0, noise: float = 0.03,
             repair_after_down_min: float = 30.0) -> pd.DataFrame:
    """One row per (minute, machine): sensors, state, active fault, label.

    label = 1 while a fault is active (from injection until repair), so a
    detector is rewarded for catching it EARLY (before state = down).
    A machine that goes down is repaired `repair_after_down_min` later.
    """
    rng = np.random.default_rng(sc.seed)
    cat = load_catalog()
    pending = list(sc.faults)
    active: dict[str, list[ActiveFault]] = {m: [] for m in sc.machines}
    down_since: dict[str, float] = {}
    # slow per-machine drift of the operating point (machines are not identical)
    offset = {m: {s: rng.normal(1, 0.02) for s in SENSORS} for m in sc.machines}
    rows = []
    for t in np.arange(0, sc.duration_min, step_min):
        while pending and pending[0].at_min <= t:
            f = pending.pop(0)
            active[f.machine_id].append(ActiveFault(cat[f.fault_code], f.machine_id, f.at_min, f.ramp_min))
        for m in sc.machines:
            vals = {s: NOMINAL[s] * offset[m][s] * rng.normal(1, noise) for s in SENSORS}
            for af in active[m]:
                vals = af.apply(vals, t, rng)
            state = worst_state([af.state(t) for af in active[m]])
            if state == "down":
                vals["cadence"] = 0.0
                down_since.setdefault(m, t)
            codes = [af.code for af in active[m]]
            rows.append({"scenario_id": sc.scenario_id, "t_min": float(t), "machine_id": m, **vals,
                         "state": state, "fault_code": codes[-1] if codes else None,
                         "label": int(bool(active[m]))})
            if m in down_since and t - down_since[m] >= repair_after_down_min:
                active[m].clear()
                down_since.pop(m)
    return pd.DataFrame(rows)


def simulate_many(scenarios: list[Scenario], **kw) -> pd.DataFrame:
    return pd.concat([simulate(s, **kw) for s in scenarios], ignore_index=True)


def add_rolling_features(df: pd.DataFrame, window: int = 10) -> pd.DataFrame:
    """Rolling mean/std per machine and scenario: detectors see trends, not single noisy points."""
    df = df.sort_values(["scenario_id", "machine_id", "t_min"]).copy()
    g = df.groupby(["scenario_id", "machine_id"])[SENSORS]
    roll = g.rolling(window, min_periods=1)
    mean = roll.mean().reset_index(level=[0, 1], drop=True)
    std = roll.std().reset_index(level=[0, 1], drop=True).fillna(0)
    for s in SENSORS:
        df[f"{s}_mean"] = mean[s]
        df[f"{s}_std"] = std[s]
    return df


ROLLING_FEATURES = [f"{s}_{k}" for s in SENSORS for k in ("mean", "std")]
