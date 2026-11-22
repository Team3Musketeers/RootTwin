"""T22 - explain the alerts of the Isolation Forest on the simulated test scenarios.

    python scripts/explain_alerts.py   # needs models/iforest_sim.joblib (scripts/train_detector.py)

Measures whether explanations are RIGHT, not only pretty:
- sensor accuracy: is the top SHAP sensor one of the sensors the true fault affects?
- fault matching: is the true fault in the top-1 / top-3 signature candidates?
"""
from __future__ import annotations

import json

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import shap

from roottwin.datasets import PROCESSED
from roottwin.detection import MODELS, REPORTS
from roottwin.detection.events import alarms
from roottwin.detection.explain import AlertExplainer
from roottwin.detection.iforest import IForestDetector
from roottwin.faults.models import load_catalog

SEED, PERSIST = 0, 5


def fault_type_probs(test: pd.DataFrame, seq: int = 30):
    """Return f(row_index) -> {fault_code: probability} from the T20 LSTM, or None."""
    path = MODELS / "faulttype_lstm_sim.pt"
    if not path.exists():
        return None
    import torch
    from roottwin.detection.temporal import LSTMNet
    ck = torch.load(path, weights_only=False)
    net = LSTMNet(4, len(ck["classes"]), hidden=ck["state"]["lstm.weight_hh_l0"].shape[1])
    net.load_state_dict(ck["state"]); net.eval()
    sensors = ["vibration", "temperature", "current", "cadence"]
    mu, sd = pd.Series(ck["mu"]), pd.Series(ck["sd"])
    z = ((test[sensors] - mu[sensors]) / sd[sensors]).to_numpy(np.float32)
    key = test["scenario_id"] + "/" + test["machine_id"]
    start = key.ne(key.shift()).cumsum()

    def f(i):
        lo = max(i - seq + 1, int(np.flatnonzero(start.to_numpy() == start.iloc[i])[0]))
        w = z[lo:i + 1]
        if len(w) < seq:
            w = np.vstack([np.repeat(w[:1], seq - len(w), axis=0), w])
        with torch.no_grad():
            p = torch.softmax(net(torch.tensor(w[None])), dim=1)[0].numpy()
        return dict(zip(ck["classes"], p.astype(float)))
    return f


def main():
    det = IForestDetector.load(MODELS / "iforest_sim.joblib")
    sim = pd.read_parquet(PROCESSED / "sim_v0.parquet")
    ids = sorted(sim["scenario_id"].unique())
    rng = np.random.default_rng(SEED)
    rng.shuffle(ids)
    n = len(ids)
    train = sim[sim["scenario_id"].isin(ids[: int(.6 * n)])]
    test = sim[sim["scenario_id"].isin(ids[int(.8 * n):])].reset_index(drop=True)
    exp = AlertExplainer(det, train[train["label"] == 0])
    cat = load_catalog()

    alarm = alarms(test, det.score(test), det.threshold, PERSIST).to_numpy()
    test = test.assign(alarm=alarm)
    # first alarm of each machine episode = the alert the operator sees
    onset = test["alarm"] & ~test.groupby(["scenario_id", "machine_id"])["alarm"].shift(fill_value=False)
    alerts = test[onset]
    probs_of = fault_type_probs(test)   # T20 classifier, None if not trained yet
    rows, sensor_ok, top1, top3, n_true = [], 0, 0, 0, 0
    for i, r in alerts.iterrows():
        e = exp.explain(r, r["machine_id"], r["t_min"], fault_probs=probs_of(i) if probs_of else None)
        true = r["fault_code"] if r["label"] == 1 else None
        rec = {**e.to_dict(), "scenario_id": r["scenario_id"], "true_fault": true}
        rows.append(rec)
        if true:
            n_true += 1
            top_sensor = next(iter(e.contributions))
            sensor_ok += top_sensor in cat[true].sensors
            codes = [c for c, _ in e.candidates]
            top1 += codes[:1] == [true]
            top3 += true in codes
    summary = {"alerts": len(rows), "alerts_on_real_faults": n_true,
               "top_sensor_in_fault_signature": round(sensor_ok / max(n_true, 1), 3),
               "true_fault_top1": round(top1 / max(n_true, 1), 3),
               "true_fault_top3": round(top3 / max(n_true, 1), 3)}
    by_fault = pd.DataFrame([r for r in rows if r["true_fault"]]).assign(
        top1=lambda d: d.apply(lambda r: r["candidates"][0]["fault_code"] == r["true_fault"], axis=1))
    summary["top1_by_fault"] = by_fault.groupby("true_fault")["top1"].mean().round(2).to_dict()
    print(json.dumps({k: v for k, v in summary.items() if k != "top1_by_fault"}, indent=1))
    print("top-1 by fault:", summary["top1_by_fault"])
    for r in rows[:3]:
        print(" -", r["text"], f"[true: {r['true_fault']}]")
    (REPORTS / "alert_explanations.json").write_text(
        json.dumps({"summary": summary, "examples": rows[:40]}, indent=1, default=float), encoding="utf-8")

    # global SHAP summary on a sample of alerted rows
    sample = alerts.sample(min(300, len(alerts)), random_state=SEED)
    sv = exp.shap_values(sample[det.features])
    plt.figure()
    shap.summary_plot(sv, det.transform(sample[det.features]), feature_names=det.features, show=False,
                      plot_size=(8, 5))
    plt.title("What drives Isolation Forest alerts (SHAP, positive = more anomalous)")
    plt.tight_layout(); plt.savefig(REPORTS / "figures" / "shap_summary_iforest.png", dpi=110); plt.close()
    print("-> reports/alert_explanations.json, reports/figures/shap_summary_iforest.png")


if __name__ == "__main__":
    main()
