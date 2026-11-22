"""T16 - train the autoencoder detector, compare with T13, plot ROC/PR curves.

    python scripts/train_detector.py      # T13 first (creates data/processed/sim_v0.parquet)
    python scripts/train_autoencoder.py   # -> reports/detection_autoencoder.json + reports/figures/
"""
from __future__ import annotations

import json

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from sklearn.metrics import precision_recall_curve, roc_curve

from roottwin.datasets import PROCESSED
from roottwin.detection import MODELS, REPORTS
from roottwin.detection.autoencoder import AEDetector, sequences, spectrum
from roottwin.detection.events import alarms, evaluate, threshold_for_false_alarms
from roottwin.detection.iforest import IForestDetector
from roottwin.detection.metrics import report, threshold_for_recall
from roottwin.faults.offline import ROLLING_FEATURES

FIG = REPORTS / "figures"
SEED, PERSIST, SEQ = 0, 5, 30


def curves(ax_roc, ax_pr, y, s, label):
    fpr, tpr, _ = roc_curve(y, s)
    p, r, _ = precision_recall_curve(y, s)
    ax_roc.plot(fpr, tpr, label=label)
    ax_pr.plot(r, p, label=label)


def cwru_experiment(results):
    print("[CWRU] spectrum autoencoder, trained on normal windows only")
    d = np.load(PROCESSED / "cwru_windows.npz")
    X, y = spectrum(d["X"]), (d["y"] != "normal").astype(int)
    rng = np.random.default_rng(SEED)
    normal = np.where(y == 0)[0]
    rng.shuffle(normal)
    # contiguous overlap between windows -> split normal by position to avoid leakage
    normal = np.sort(normal)
    n = len(normal)
    tr, va, te_n = normal[: int(.6 * n)], normal[int(.6 * n): int(.8 * n)], normal[int(.8 * n):]
    faults = np.where(y == 1)[0]
    rng.shuffle(faults)
    va_f, te_f = faults[: len(faults) // 2], faults[len(faults) // 2:]
    det = AEDetector(hidden=64, latent=8).fit(X[tr], X[va])
    val_idx, test_idx = np.r_[va, va_f], np.r_[te_n, te_f]
    thr = threshold_for_recall(y[val_idx], det.score(X[val_idx]), 0.9)
    s = det.score(X[test_idx])
    res = report(y[test_idx], s, thr)
    by_class = {str(c): round(float((s[d["y"][test_idx] == c] >= thr).mean()), 3) for c in np.unique(d["y"])}
    results["cwru"] = {"autoencoder": {**res, "alarm_rate_by_class": by_class, "epochs": len(det.history_)}}
    print(f"  ROC-AUC {res['roc_auc']:.3f} PR-AUC {res['pr_auc']:.3f} | P {res['precision']:.2f} "
          f"R {res['recall']:.2f} F1 {res['f1']:.2f} | alarm rate by class {by_class}")
    det.threshold = thr
    det.save(MODELS / "ae_cwru.pt")
    fig, ax = plt.subplots(1, 2, figsize=(10, 4))
    curves(ax[0], ax[1], y[test_idx], s, "autoencoder (spectrum)")
    ax[0].plot([0, 1], [0, 1], "k--", lw=.8)
    for a, t in zip(ax, ("ROC - CWRU", "Precision-Recall - CWRU")):
        a.set_title(t); a.legend(loc="lower right")
    ax[0].set_xlabel("false positive rate"); ax[0].set_ylabel("true positive rate")
    ax[1].set_xlabel("recall"); ax[1].set_ylabel("precision")
    fig.tight_layout(); fig.savefig(FIG / "ae_cwru_roc_pr.png", dpi=110); plt.close(fig)


def sim_experiment(results):
    print(f"[Simulated line] sequence autoencoder on the last {SEQ} min of 4 sensors")
    sim = pd.read_parquet(PROCESSED / "sim_v0.parquet")
    ids = sorted(sim["scenario_id"].unique())
    rng = np.random.default_rng(SEED)
    rng.shuffle(ids)
    n = len(ids)
    split = {"train": ids[: int(.6 * n)], "val": ids[int(.6 * n): int(.8 * n)], "test": ids[int(.8 * n):]}
    parts = {k: sim[sim["scenario_id"].isin(v)].reset_index(drop=True) for k, v in split.items()}

    # training sequences: windows fully inside healthy periods
    Xtr, itr = sequences(parts["train"], SEQ)
    healthy_tr = parts["train"]["label"].rolling(SEQ, min_periods=1).max().to_numpy()[itr] == 0
    Xva, iva = sequences(parts["val"], SEQ)
    healthy_va = parts["val"]["label"].rolling(SEQ, min_periods=1).max().to_numpy()[iva] == 0
    # consecutive windows overlap by 29/30 minutes: keep 1 in 5 (same information, 5x faster)
    Xh, Xvh = Xtr[healthy_tr][::5], Xva[healthy_va][::5]
    det = AEDetector(hidden=64, latent=8, epochs=100).fit(Xh, Xvh)
    print(f"  trained {len(det.history_)} epochs on {len(Xh)} healthy windows")

    def scored(part):
        X, idx = sequences(part, SEQ)
        df = part.loc[idx]
        return df, det.score(X)

    vdf, vs = scored(parts["val"])
    tdf, ts = scored(parts["test"])
    thr = threshold_for_false_alarms(vdf, vs, 1.0, PERSIST)
    ev = evaluate(tdf, alarms(tdf, ts, thr, PERSIST))
    hit = tdf.assign(alarm=alarms(tdf, ts, thr, PERSIST).to_numpy())[tdf["label"] == 1]
    ev["by_fault"] = hit.groupby(["scenario_id", "machine_id", "fault_code"])["alarm"].any() \
        .groupby(level="fault_code").mean().round(2).to_dict()
    pw = report(tdf["label"], ts, threshold_for_recall(vdf["label"].to_numpy(), vs, 0.9), 1440)
    results["sim"] = {"autoencoder": {"point_wise": pw, "event_level": {"threshold": thr, "persist_min": PERSIST, **ev}}}
    print(f"  point-wise ROC-AUC {pw['roc_auc']:.3f} PR-AUC {pw['pr_auc']:.3f}")
    print(f"  event level: episodes caught {ev['episode_detection_rate']:.0%} | warned before down "
          f"{ev['warned_before_down_rate']:.0%} | lead time median {ev['lead_time_min_median']} min | "
          f"false alarms {ev['false_alarms_per_machine_day']:.2f}/machine-day")
    print(f"  by fault: {ev['by_fault']}")
    det.threshold = thr
    det.save(MODELS / "ae_sim.pt")

    # comparison figure with the T13 Isolation Forest on the same test rows
    iso = IForestDetector.load(MODELS / "iforest_sim.joblib")
    iso_s = iso.score(tdf[ROLLING_FEATURES])
    fig, ax = plt.subplots(1, 2, figsize=(10, 4))
    curves(ax[0], ax[1], tdf["label"], ts, f"autoencoder (PR-AUC {pw['pr_auc']:.2f})")
    from sklearn.metrics import average_precision_score
    curves(ax[0], ax[1], tdf["label"], iso_s,
           f"Isolation Forest (PR-AUC {average_precision_score(tdf['label'], iso_s):.2f})")
    ax[0].plot([0, 1], [0, 1], "k--", lw=.8)
    for a, t in zip(ax, ("ROC - simulated line", "Precision-Recall - simulated line")):
        a.set_title(t); a.legend(loc="lower right", fontsize=8)
    ax[0].set_xlabel("false positive rate"); ax[0].set_ylabel("true positive rate")
    ax[1].set_xlabel("recall"); ax[1].set_ylabel("precision")
    fig.tight_layout(); fig.savefig(FIG / "ae_vs_iforest_sim_roc_pr.png", dpi=110); plt.close(fig)

    # one example episode: score over time vs state
    ep = tdf[(tdf["fault_code"] == "BEARING_WEAR")].groupby(["scenario_id", "machine_id"]).size()
    if len(ep):
        sid, mid = ep.index[0]
        g_mask = (tdf["scenario_id"] == sid) & (tdf["machine_id"] == mid)
        g = tdf[g_mask]
        fig, ax = plt.subplots(figsize=(10, 3.2))
        ax.plot(g["t_min"], ts[g_mask.to_numpy()], label="reconstruction error")
        ax.axhline(thr, color="r", ls="--", lw=1, label="alarm threshold")
        for st, c in (("degraded", "orange"), ("down", "red")):
            t = g.loc[g["state"] == st, "t_min"]
            if len(t):
                ax.axvline(t.iloc[0], color=c, lw=1, label=f"state = {st}")
        ax.set_yscale("log"); ax.set_xlabel("simulated minutes"); ax.legend(fontsize=8)
        ax.set_title(f"{sid} {mid}: BEARING_WEAR - the alarm comes before the stop")
        fig.tight_layout(); fig.savefig(FIG / "ae_sim_episode.png", dpi=110); plt.close(fig)


def main():
    FIG.mkdir(parents=True, exist_ok=True)
    results = {"protocol": {"seed": SEED, "persist_min": PERSIST, "seq_len_min": SEQ}}
    cwru_experiment(results)
    sim_experiment(results)
    (REPORTS / "detection_autoencoder.json").write_text(json.dumps(results, indent=2), encoding="utf-8")
    print(f"-> reports/detection_autoencoder.json, reports/figures/, models/ae_*.pt")


if __name__ == "__main__":
    main()
