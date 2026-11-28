"""T14 - calibrate the fault simulator on real data to reduce the simulation / reality gap.

    python scripts/calibrate.py        # -> roottwin/faults/calibration.json + reports/calibration.json

1. Degradation shape (NASA C-MAPSS FD001, 100 run-to-failure engines): a health index (HI) per engine = mean of the
   informative sensors, standardised and signed so they rise with wear, rescaled to 0 at the start of life and 1 at
   failure. We fit HI(u) = u^k with u = fraction of life. Real degradation is flat, then accelerates (k > 1); the
   simulator's gradual faults used a straight line (k = 1). k becomes the `shape` of every gradual ramp effect.
2. Bearing vibration amplitude (CWRU bearing data, 12 kHz drive end): RMS of faulty windows / RMS of normal windows.
   The median ratio over ball, inner-race and outer-race faults sets the BEARING_WEAR vibration magnitude
   (value at failure = nominal x ratio).
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd

from roottwin.tracking import log_run

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "roottwin" / "faults" / "calibration.json"


def degradation_shape(train: pd.DataFrame) -> tuple[float, float]:
    sensors = [c for c in train.columns if c.startswith("s") and train[c].std() > 1e-2]
    z = (train[sensors] - train[sensors].mean()) / train[sensors].std()
    sign = np.sign([np.corrcoef(train[c], -train["rul"])[0, 1] for c in sensors])   # +1: rises with wear
    train = train.assign(hi=(z * sign).mean(axis=1))
    us, his = [], []
    for _, e in train.groupby("unit"):
        hi = e["hi"].rolling(10, min_periods=1).mean().to_numpy()                      # smooth sensor noise
        lo, hi_end = hi[:10].mean(), hi[-5:].mean()
        if hi_end - lo < 1e-6:
            continue
        us.append(np.linspace(0, 1, len(hi)))
        his.append(np.clip((hi - lo) / (hi_end - lo), 0, 1.2))
    u, h = np.concatenate(us), np.concatenate(his)
    ks = np.linspace(0.5, 8, 151)
    err = [np.mean((u ** k - h) ** 2) for k in ks]
    k = float(ks[int(np.argmin(err))])
    return round(k, 2), round(float(min(err)), 4)


def bearing_ratio(cwru: pd.DataFrame) -> tuple[float, dict]:
    normal = cwru.loc[cwru.label == "normal", "rms"].median()
    per = {str(l): round(float(g.rms.median() / normal), 2) for l, g in cwru[cwru.label != "normal"].groupby("label", observed=True)}
    return round(float(np.median(list(per.values()))), 2), per


def main():
    train = pd.read_parquet(ROOT / "data" / "processed" / "cmapss_fd001_train.parquet")
    cwru = pd.read_parquet(ROOT / "data" / "processed" / "cwru_features.parquet")
    k, mse = degradation_shape(train)
    ratio, per = bearing_ratio(cwru)
    cal = {"degradation_shape": k, "overrides": {"BEARING_WEAR": {"vibration": round(ratio - 1, 2)}},
           "source": "scripts/calibrate.py on C-MAPSS FD001 (shape) and CWRU 12k drive end (bearing RMS ratio)"}
    OUT.write_text(json.dumps(cal, indent=2), encoding="utf-8")
    report = {"cmapss_health_index_fit": {"model": "HI = u^k", "k": k, "mse": mse, "before": "linear ramp (k = 1)"},
              "cwru_rms_ratio_fault_over_normal": per, "bearing_wear_vibration_at_failure": f"x{ratio} (was x3.0)"}
    (ROOT / "reports" / "calibration.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    log_run("calibration", {"cmapss": "FD001", "cwru": "12k drive end"}, {"k": k, "mse": mse, "bearing_ratio": ratio})
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
