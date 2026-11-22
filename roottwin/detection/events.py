"""Event-level evaluation for streaming detection (what the KPI actually measures).

Point-wise metrics punish a detector for not flagging the first minutes of a
fault, when its signature is still invisible. In operation what matters is:
- did we raise ONE alarm per fault episode, before the machine stopped?
- how many alarms did we raise on healthy machines per day?

Alarm logic: score >= threshold for `persist` consecutive samples (debounce).
"""
from __future__ import annotations

import numpy as np
import pandas as pd

KEYS = ["scenario_id", "machine_id"]


def alarms(df: pd.DataFrame, scores: np.ndarray, threshold: float, persist: int = 5) -> pd.Series:
    """Boolean alarm per row, after the persistence filter (rows sorted by KEYS + t_min)."""
    above = pd.Series(scores >= threshold, index=df.index)
    run = above.groupby([df[k] for k in KEYS]).transform(
        lambda s: s.astype(int).groupby((~s).cumsum()).cumsum())
    return run >= persist


def _episodes(df: pd.DataFrame):
    """Contiguous runs of label == 1 per machine (one fault episode each)."""
    lab = df["label"].astype(int).eq(1)
    new_machine = (df[KEYS] != df[KEYS].shift()).any(axis=1)
    starts = lab & (new_machine | ~lab.shift(fill_value=False))
    ep_id = starts.cumsum().where(lab)
    return df.assign(episode=ep_id).dropna(subset=["episode"]).groupby("episode")


def evaluate(df: pd.DataFrame, alarm: pd.Series, step_min: float = 1.0) -> dict:
    df = df.assign(alarm=alarm.to_numpy())
    healthy = df[df["label"] == 0]
    # false alarm events = rising edges of alarm on healthy rows
    rising = healthy.groupby(KEYS)["alarm"].transform(lambda s: s & ~s.shift(fill_value=False))
    machine_days = len(healthy) * step_min / 1440
    fa_events = int(rising.sum())

    caught, leads, missed_down, n_ep, n_down = 0, [], 0, 0, 0
    for _, ep in _episodes(df):
        n_ep += 1
        hit = ep.loc[ep["alarm"], "t_min"]
        caught += int(not hit.empty)
        down = ep.loc[ep["state"] == "down", "t_min"]
        if not down.empty:
            n_down += 1
            if hit.empty or hit.iloc[0] > down.iloc[0]:
                missed_down += 1
            else:
                leads.append(float(down.iloc[0] - hit.iloc[0]))
    return {
        "fault_episodes": n_ep,
        "episode_detection_rate": caught / max(n_ep, 1),
        "stopping_faults": n_down,
        "warned_before_down_rate": (n_down - missed_down) / max(n_down, 1),
        "lead_time_min_median": float(np.median(leads)) if leads else None,
        "lead_time_min_p10": float(np.percentile(leads, 10)) if leads else None,
        "false_alarms_per_machine_day": fa_events / max(machine_days, 1e-9),
    }


def threshold_for_false_alarms(df: pd.DataFrame, scores: np.ndarray, max_per_day: float = 1.0,
                               persist: int = 5, step_min: float = 1.0) -> float:
    """Lowest threshold (most sensitive) keeping false alarms <= max_per_day on this split."""
    healthy_scores = scores[df["label"].to_numpy() == 0]
    cand = np.quantile(healthy_scores, np.linspace(0.90, 0.999999, 200))   # increasing
    fa = lambda thr: evaluate(df, alarms(df, scores, thr, persist), step_min)["false_alarms_per_machine_day"]
    lo, hi = 0, len(cand) - 1          # false alarms decrease as the threshold rises: bisection
    if fa(cand[hi]) > max_per_day:
        return float(cand[hi])
    while lo < hi:
        mid = (lo + hi) // 2
        if fa(cand[mid]) <= max_per_day:
            hi = mid
        else:
            lo = mid + 1
    return float(cand[lo])
