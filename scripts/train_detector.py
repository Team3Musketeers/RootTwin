"""T13 - baseline detectors: z-score thresholds and Isolation Forest.

    python scripts/train_detector.py          # all experiments -> reports/detection_baseline.json

Protocol (same for every later detector, so results are comparable):
- fit on NORMAL samples of the train split only (semi-supervised);
- choose the alarm threshold on the validation split for recall >= 0.9;
- report on the untouched test split.
"""
from __future__ import annotations

import json

import numpy as np
import pandas as pd
from sklearn.model_selection import train_test_split

from roottwin.datasets import PROCESSED, ai4i, cwru
from roottwin.detection import MODELS, REPORTS
from roottwin.detection.iforest import IForestDetector, ZScoreDetector
from roottwin.detection.events import alarms, evaluate, threshold_for_false_alarms
from roottwin.detection.metrics import report, threshold_best_f1, threshold_for_recall
from roottwin.faults import generate_scenarios
from roottwin.faults.offline import ROLLING_FEATURES, add_rolling_features, simulate_many

TARGET_RECALL = 0.9
SEED = 0
PERSIST = 5


def by_fault(det, test, thr):
    """Episode detection rate per fault code (which faults the detector cannot see)."""
    alarm = alarms(test, det.score(test), thr, PERSIST)
    hit = test.assign(alarm=alarm.to_numpy())[test["label"] == 1]
    per_ep = hit.groupby(["scenario_id", "machine_id", "fault_code"])["alarm"].any()
    return per_ep.groupby(level="fault_code").mean().round(2).to_dict()


def split(df, label, seed=SEED):
    train, rest = train_test_split(df, test_size=0.4, stratify=df[label], random_state=seed)
    val, test = train_test_split(rest, test_size=0.5, stratify=rest[label], random_state=seed)
    return train, val, test


def run(name, det, train, val, test, label, per_day=None, extra=None):
    det.fit(train[train[label] == 0])
    s_val, s_test = det.score(val), det.score(test)
    thr = threshold_for_recall(val[label].to_numpy(), s_val, TARGET_RECALL)
    det.threshold = thr
    res = {"at_recall_0.9": report(test[label], s_test, thr, per_day),
           "at_best_f1": report(test[label], s_test, threshold_best_f1(val[label].to_numpy(), s_val), per_day)}
    if extra:
        res.update(extra(det, test, s_test, thr))
    r = res["at_recall_0.9"]
    print(f"  {name:<22} ROC-AUC {r['roc_auc']:.3f}  PR-AUC {r['pr_auc']:.3f}  |  @recall>=0.9 on val: "
          f"P {r['precision']:.2f} R {r['recall']:.2f} F1 {r['f1']:.2f}"
          + (f"  FA/day {r['false_alarms_per_day']:.1f}" if per_day else ""))
    return res


def per_mode_recall(det, test, scores, thr):
    hit = scores >= thr
    out = {}
    for mode in ai4i.FAILURE_MODES:
        m = test[mode].to_numpy() == 1
        if m.any():
            out[mode] = round(float(hit[m].mean()), 3)
    return {"recall_by_failure_mode": out}


def lead_times(det, test, scores, thr):
    """Minutes between first alarm and the machine going down (positive = early warning)."""
    df = test.assign(alarm=scores >= thr)
    leads, missed = [], 0
    for (_, _), g in df[df["label"] == 1].groupby(["scenario_id", "machine_id"]):
        down = g.loc[g["state"] == "down", "t_min"]
        if down.empty:
            continue
        first_alarm = g.loc[g["alarm"], "t_min"]
        if first_alarm.empty or first_alarm.iloc[0] > down.iloc[0]:
            missed += 1
        else:
            leads.append(down.iloc[0] - first_alarm.iloc[0])
    return {"lead_time_min": {"median": float(np.median(leads)) if leads else None,
                              "p10": float(np.percentile(leads, 10)) if leads else None,
                              "caught_before_down": len(leads), "missed_or_late": missed}}


def main():
    results = {"protocol": {"target_recall": TARGET_RECALL, "seed": SEED,
                            "fit": "normal samples of train split", "threshold": "validation split"}}

    print("[AI4I 2020]  1 record = 1 min")
    df = ai4i.load()
    feats = list(ai4i.SENSORS) + ["power_w", "temp_diff_k"]
    tr, va, te = split(df, "failure")
    results["ai4i"] = {
        "zscore": run("z-score thresholds", ZScoreDetector(feats), tr, va, te, "failure", 1440, per_mode_recall),
        "iforest": run("Isolation Forest", IForestDetector(feats), tr, va, te, "failure", 1440, per_mode_recall),
    }

    print("[CWRU bearings]  features per 2048-sample window")
    f = cwru.load_features()
    cf = ["rms", "peak", "crest_factor", "kurtosis", "skewness", "std", "p2p"]
    tr, va, te = split(f, "is_fault")
    results["cwru"] = {
        "zscore": run("z-score thresholds", ZScoreDetector(cf), tr, va, te, "is_fault"),
        "iforest": run("Isolation Forest", IForestDetector(cf), tr, va, te, "is_fault"),
    }

    print("[Simulated line]  200 generated scenarios, 1 row / machine / min, rolling 10-min features")
    scs = generate_scenarios(200, seed=42)
    sim = add_rolling_features(simulate_many(scs))
    sim.to_parquet(PROCESSED / "sim_v0.parquet", index=False)
    ids = sorted(sim["scenario_id"].unique())
    rng = np.random.default_rng(SEED)
    rng.shuffle(ids)
    n = len(ids)
    parts = {k: sim[sim["scenario_id"].isin(v)] for k, v in
             (("train", ids[: int(.6 * n)]), ("val", ids[int(.6 * n): int(.8 * n)]), ("test", ids[int(.8 * n):]))}
    per_day = 1440  # per machine
    results["sim"] = {
        "zscore": run("z-score thresholds", ZScoreDetector(ROLLING_FEATURES), *parts.values(), "label", per_day,
                      lead_times),
        "iforest": run("Isolation Forest", IForestDetector(ROLLING_FEATURES), *parts.values(), "label", per_day,
                       lead_times),
    }
    print("  event level (alarm = 5 consecutive min above threshold, threshold for <= 1 false alarm/machine-day on val):")
    for name, det in (("zscore", ZScoreDetector(ROLLING_FEATURES)), ("iforest", IForestDetector(ROLLING_FEATURES))):
        det.fit(parts["train"][parts["train"]["label"] == 0])
        thr = threshold_for_false_alarms(parts["val"], det.score(parts["val"]), max_per_day=1.0, persist=PERSIST)
        det.threshold = thr
        ev = evaluate(parts["test"], alarms(parts["test"], det.score(parts["test"]), thr, PERSIST))
        ev["by_fault"] = by_fault(det, parts["test"], thr)
        results["sim"][name]["event_level"] = {"threshold": thr, "persist_min": PERSIST, **ev}
        print(f"  {name:<8} episodes caught {ev['episode_detection_rate']:.0%} | stopping faults warned before down "
              f"{ev['warned_before_down_rate']:.0%} | lead time median {ev['lead_time_min_median']} min | "
              f"false alarms {ev['false_alarms_per_machine_day']:.2f}/machine-day")
        if name == "iforest":
            det.save(MODELS / "iforest_sim.joblib")

    REPORTS.mkdir(exist_ok=True)
    (REPORTS / "detection_baseline.json").write_text(json.dumps(results, indent=2), encoding="utf-8")
    print(f"-> {REPORTS / 'detection_baseline.json'}, {MODELS / 'iforest_sim.joblib'}")


if __name__ == "__main__":
    main()
