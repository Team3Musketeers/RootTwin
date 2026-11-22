"""NASA C-MAPSS turbofan engine degradation (Saxena et al., PHM 2008).

Each sub-dataset (FD001..FD004) has run-to-failure training engines and test
engines cut before failure, with the true remaining useful life (RUL) given
separately. FD001: 1 operating condition, 1 fault mode (HPC degradation).
"""
from __future__ import annotations

from pathlib import Path

import pandas as pd

from roottwin.datasets import RAW

OP_COLS = ["op1", "op2", "op3"]
SENSOR_COLS = [f"s{i}" for i in range(1, 22)]
COLS = ["unit", "cycle", *OP_COLS, *SENSOR_COLS]
RUL_CAP = 125  # common piecewise-linear cap: early life counted as "healthy"


def _dir() -> Path:
    hits = list((RAW / "cmapss").rglob("train_FD001.txt"))
    if not hits:
        raise FileNotFoundError("C-MAPSS not found: run python scripts/download_datasets.py cmapss")
    return hits[0].parent


def _read(path: Path) -> pd.DataFrame:
    df = pd.read_csv(path, sep=r"\s+", header=None)
    df = df.iloc[:, :len(COLS)]
    df.columns = COLS
    return df


def load(subset: str = "FD001", cap: int | None = RUL_CAP) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Return (train, test), both with a `rul` column (and `rul_capped` if cap)."""
    d = _dir()
    train = _read(d / f"train_{subset}.txt")
    test = _read(d / f"test_{subset}.txt")
    true_rul = pd.read_csv(d / f"RUL_{subset}.txt", header=None, names=["rul_end"])
    true_rul["unit"] = range(1, len(true_rul) + 1)

    train["rul"] = train.groupby("unit")["cycle"].transform("max") - train["cycle"]
    last = test.groupby("unit")["cycle"].transform("max")
    test = test.merge(true_rul, on="unit")
    test["rul"] = test["rul_end"] + (last - test["cycle"])
    test = test.drop(columns="rul_end")
    if cap:
        train["rul_capped"] = train["rul"].clip(upper=cap)
        test["rul_capped"] = test["rul"].clip(upper=cap)
    return train, test


def informative_sensors(train: pd.DataFrame, min_std: float = 1e-2) -> list[str]:
    """Sensors that actually vary (FD001: 14 of 21; s1, s5, s6, s10, s16, s18, s19 are flat)."""
    return [c for c in SENSOR_COLS if train[c].std() > min_std]


def last_cycles(test: pd.DataFrame) -> pd.DataFrame:
    """One row per test engine (the evaluation point for RUL RMSE)."""
    return test.loc[test.groupby("unit")["cycle"].idxmax()].reset_index(drop=True)
