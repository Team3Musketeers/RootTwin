"""CWRU Bearing Data Center (Case Western Reserve University).

Drive-end accelerometer at 12 kHz, motor load 0 HP. We use 4 classes:
normal, inner race (IR007), ball (B007), outer race (OR007 @6:00).
Raw signals are split into fixed windows; each window gets time-domain
features (the "condition indicators" of the MathWorks workflow).
"""
from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd
import scipy.io
from scipy.stats import kurtosis, skew

from roottwin.datasets import RAW

FS = 12_000  # Hz
FILES = {"normal": "normal_0.mat", "inner_race": "IR007_0.mat",
         "ball": "B007_0.mat", "outer_race": "OR007_6_0.mat"}
# CWRU class -> closest fault code of our catalogue
TO_CATALOG = {"normal": None, "inner_race": "BEARING_WEAR", "ball": "BEARING_WEAR",
              "outer_race": "BEARING_WEAR"}
WINDOW = 2048  # samples (~0.17 s)


def load_signal(label: str, folder: Path | None = None) -> np.ndarray:
    m = scipy.io.loadmat((folder or RAW / "cwru") / FILES[label])
    key = next(k for k in m if k.endswith("_DE_time"))
    return m[key].ravel().astype(np.float32)


def windows(signal: np.ndarray, size: int = WINDOW, step: int | None = None) -> np.ndarray:
    step = step or size
    n = 1 + (len(signal) - size) // step
    idx = np.arange(size)[None, :] + step * np.arange(n)[:, None]
    return signal[idx]


def features(w: np.ndarray) -> pd.DataFrame:
    """Time-domain condition indicators per window (rows = windows)."""
    rms = np.sqrt((w ** 2).mean(axis=1))
    peak = np.abs(w).max(axis=1)
    return pd.DataFrame({
        "rms": rms,
        "peak": peak,
        "crest_factor": peak / rms,
        "kurtosis": kurtosis(w, axis=1, fisher=False),
        "skewness": skew(w, axis=1),
        "std": w.std(axis=1),
        "p2p": w.max(axis=1) - w.min(axis=1),
    })


def load_windows(size: int = WINDOW, step: int | None = None) -> tuple[np.ndarray, np.ndarray]:
    """(X, y): X shape (n_windows, size) raw vibration, y class labels. For the autoencoder (T16)."""
    xs, ys = [], []
    for label in FILES:
        w = windows(load_signal(label), size, step)
        xs.append(w)
        ys += [label] * len(w)
    return np.concatenate(xs), np.array(ys)


def load_features(size: int = WINDOW, step: int | None = None) -> pd.DataFrame:
    frames = []
    for label in FILES:
        w = windows(load_signal(label), size, step)
        f = features(w)
        f.insert(0, "window", np.arange(len(f)))
        f.insert(0, "label", label)
        frames.append(f)
    df = pd.concat(frames, ignore_index=True)
    df["label"] = df["label"].astype("category")
    df["is_fault"] = (df["label"] != "normal").astype(int)
    return df
