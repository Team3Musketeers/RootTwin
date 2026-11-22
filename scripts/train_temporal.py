"""T20 - LSTM / TCN: remaining useful life (C-MAPSS FD001) + fault-type classification (simulated line).

    python scripts/train_temporal.py   # -> reports/temporal_models.json, reports/figures/, models/*.pt
"""
from __future__ import annotations

import json

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import torch
from sklearn.metrics import classification_report, confusion_matrix, f1_score

from roottwin.datasets import PROCESSED, cmapss
from roottwin.detection import MODELS, REPORTS
from roottwin.detection.temporal import LSTMNet, TCNNet, nasa_score, predict, train

import sys

SEED, WIN = 0, 30
EVAL_ONLY = "--eval-rul" in sys.argv   # reuse saved RUL weights, only recompute metrics
FIG = REPORTS / "figures"
torch.set_num_threads(8)


# ---------------------------------------------------------------- RUL on C-MAPSS
def rul_windows(df, feats, win, last_only=False):
    X, y, units = [], [], []
    for u, g in df.groupby("unit"):
        v = g[feats].to_numpy(np.float32)
        if len(v) < win:                         # pad short test engines with their first row
            v = np.vstack([np.repeat(v[:1], win - len(v), axis=0), v])
            r = np.r_[np.full(win - len(g), g["rul_capped"].iloc[0]), g["rul_capped"].to_numpy()]
        else:
            r = g["rul_capped"].to_numpy()
        if last_only:
            X.append(v[-win:]); y.append(r[-1]); units.append(u)
        else:
            w = np.lib.stride_tricks.sliding_window_view(v, (win, v.shape[1]))[:, 0]
            X.append(w); y.append(r[win - 1:]); units += [u] * len(w)
    if last_only:
        return np.stack(X), np.array(y, np.float32), np.array(units)
    return np.concatenate(X), np.concatenate(y).astype(np.float32), np.array(units)


def rul_experiment(results):
    print("[C-MAPSS FD001] RUL regression, window 30 cycles, RUL capped at 125")
    train_df, test_df = cmapss.load("FD001")
    feats = cmapss.informative_sensors(train_df)
    lo, hi = train_df[feats].min(), train_df[feats].max()
    norm = lambda d: d.assign(**{f: (d[f] - lo[f]) / (hi[f] - lo[f]) for f in feats})
    train_df, test_df = norm(train_df), norm(test_df)
    rng = np.random.default_rng(SEED)
    units = train_df["unit"].unique()
    val_units = rng.choice(units, size=20, replace=False)
    Xtr, ytr, _ = rul_windows(train_df[~train_df.unit.isin(val_units)], feats, WIN)
    Xva, yva, _ = rul_windows(train_df[train_df.unit.isin(val_units)], feats, WIN)
    Xte, yte, _ = rul_windows(test_df, feats, WIN, last_only=True)
    baseline = float(np.sqrt(((ytr.mean() - yte) ** 2).mean()))
    out = {"baseline_mean_rmse": baseline, "n_test_engines": len(yte)}
    preds = {}
    for name, net in (("lstm", LSTMNet(len(feats))), ("tcn", TCNNet(len(feats)))):
        path = MODELS / f"rul_{name}_fd001.pt"
        if EVAL_ONLY and path.exists():
            net.load_state_dict(torch.load(path)); net.eval(); hist = []
        else:
            hist = train(net, Xtr, ytr / 125, Xva, yva / 125, "regression", epochs=80, seed=SEED)
        p = np.clip(predict(net, Xte)[:, 0] * 125, 0, 125)
        rmse = float(np.sqrt(((p - yte) ** 2).mean()))
        out[name] = {"rmse": rmse, "nasa_score": nasa_score(yte, p), "epochs": len(hist),
                     "mae": float(np.abs(p - yte).mean())}
        preds[name] = p
        if hist:
            torch.save(net.state_dict(), path)
        print(f"  {name.upper():<5} RMSE {rmse:5.1f} cycles | MAE {out[name]['mae']:5.1f} | "
              f"NASA score {out[name]['nasa_score']:7.0f} | {len(hist) or 'saved'} epochs", flush=True)
    print(f"  baseline (predict mean) RMSE {baseline:.1f}")
    results["rul_cmapss_fd001"] = out

    order = np.argsort(yte)
    fig, ax = plt.subplots(figsize=(10, 3.8))
    ax.plot(yte[order], "k-", lw=2, label="true RUL")
    for name, p in preds.items():
        ax.plot(p[order], ".", ms=5, label=f"{name.upper()} (RMSE {out[name]['rmse']:.1f})")
    ax.set_xlabel("test engines (sorted by true RUL)"); ax.set_ylabel("RUL (cycles)")
    ax.set_title("C-MAPSS FD001 - predicted vs true remaining useful life"); ax.legend()
    fig.tight_layout(); fig.savefig(FIG / "rul_fd001.png", dpi=110); plt.close(fig)


# ---------------------------------------------------------------- fault type on simulated line
def fault_experiment(results):
    print("[Simulated line] fault-type classification from the last 30 min of 4 sensors")
    sim = pd.read_parquet(PROCESSED / "sim_v0.parquet").sort_values(["scenario_id", "machine_id", "t_min"])
    sensors = ["vibration", "temperature", "current", "cadence"]
    mu, sd = sim.loc[sim.label == 0, sensors].mean(), sim.loc[sim.label == 0, sensors].std()
    X, y, sid = [], [], []
    rng = np.random.default_rng(SEED)
    for (s, m), g in sim.groupby(["scenario_id", "machine_id"]):
        v = ((g[sensors] - mu) / sd).to_numpy(np.float32)
        lab = g["fault_code"].fillna("none").to_numpy()
        st = g["state"].to_numpy()
        # one sample every 10 min; faulty samples once the fault is visible (degraded/down)
        for t in range(WIN - 1, len(g), 10):
            if lab[t] != "none" and st[t] == "ok":
                continue
            if lab[t] == "none" and rng.random() > 0.03:      # subsample healthy windows
                continue
            X.append(v[t - WIN + 1:t + 1]); y.append(lab[t]); sid.append(s)
    X, y, sid = np.stack(X), np.array(y), np.array(sid)
    classes = sorted(set(y))
    yi = np.array([classes.index(c) for c in y])
    ids = sorted(set(sid)); rng.shuffle(ids)
    n = len(ids)
    tr, va, te = (np.isin(sid, ids[a:b]) for a, b in ((0, int(.6 * n)), (int(.6 * n), int(.8 * n)), (int(.8 * n), n)))
    counts = np.bincount(yi[tr], minlength=len(classes))
    w = (len(yi[tr]) / (len(classes) * np.maximum(counts, 1))).astype(np.float32)
    majority = classes[int(np.argmax(counts))]
    out = {"classes": classes, "n_train": int(tr.sum()), "n_test": int(te.sum()),
           "baseline_majority_macro_f1": float(f1_score(yi[te], np.full(te.sum(), classes.index(majority)),
                                                        average="macro"))}
    print(f"  {int(tr.sum())} train / {int(va.sum())} val / {int(te.sum())} test windows, {len(classes)} classes",
          flush=True)
    for name, net in (("lstm", LSTMNet(4, len(classes), hidden=48)), ("tcn", TCNNet(4, len(classes)))):
        hist = train(net, X[tr], yi[tr], X[va], yi[va], "classification", epochs=25, patience=5, seed=SEED,
                     class_weights=w, batch=512)
        p = predict(net, X[te]).argmax(1)
        f1m = float(f1_score(yi[te], p, average="macro"))
        rep = classification_report(yi[te], p, labels=range(len(classes)), target_names=classes,
                                    output_dict=True, zero_division=0)
        out[name] = {"macro_f1": f1m, "accuracy": rep["accuracy"], "epochs": len(hist),
                     "f1_by_class": {c: round(rep[c]["f1-score"], 2) for c in classes}}
        torch.save({"state": net.state_dict(), "classes": classes, "mu": mu.to_dict(), "sd": sd.to_dict()},
                   MODELS / f"faulttype_{name}_sim.pt")
        print(f"  {name.upper():<5} macro-F1 {f1m:.3f} | accuracy {rep['accuracy']:.3f} | {len(hist)} epochs")
        if name == "lstm":
            cm = confusion_matrix(yi[te], p, labels=range(len(classes)), normalize="true")
            fig, ax = plt.subplots(figsize=(8, 7))
            im = ax.imshow(cm, cmap="Blues", vmin=0, vmax=1)
            ax.set_xticks(range(len(classes)), classes, rotation=60, ha="right", fontsize=8)
            ax.set_yticks(range(len(classes)), classes, fontsize=8)
            for i in range(len(classes)):
                for j in range(len(classes)):
                    if cm[i, j] >= 0.05:
                        ax.text(j, i, f"{cm[i, j]:.2f}", ha="center", va="center", fontsize=7,
                                color="white" if cm[i, j] > .5 else "black")
            ax.set_xlabel("predicted"); ax.set_ylabel("true"); ax.set_title(f"LSTM fault type - macro-F1 {f1m:.2f}")
            fig.colorbar(im, fraction=.04); fig.tight_layout()
            fig.savefig(FIG / "faulttype_confusion_lstm.png", dpi=110); plt.close(fig)
    print(f"  baseline (majority '{majority}') macro-F1 {out['baseline_majority_macro_f1']:.3f}")
    results["fault_type_sim"] = out


def main():
    FIG.mkdir(parents=True, exist_ok=True)
    MODELS.mkdir(exist_ok=True)
    results = {"protocol": {"seed": SEED, "window": WIN}}
    rul_experiment(results)
    fault_experiment(results)
    (REPORTS / "temporal_models.json").write_text(json.dumps(results, indent=2), encoding="utf-8")
    print("-> reports/temporal_models.json")


if __name__ == "__main__":
    main()
