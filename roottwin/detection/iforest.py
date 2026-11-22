"""Baseline detectors (T13): per-feature thresholds and Isolation Forest.

Both are fitted on NORMAL data only (semi-supervised): in a factory we have
plenty of healthy data and very few labelled failures. The alarm threshold is
then tuned on a validation set to reach the recall target (KPI: recall >= 0.9).
"""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import IsolationForest
from sklearn.preprocessing import StandardScaler


@dataclass
class ZScoreDetector:
    """'Seuils' baseline: score = max |z-score| over features (fitted on normal data)."""
    features: list[str]
    mean_: pd.Series | None = None
    std_: pd.Series | None = None
    threshold: float = 3.0

    def fit(self, normal: pd.DataFrame) -> "ZScoreDetector":
        self.mean_ = normal[self.features].mean()
        self.std_ = normal[self.features].std().replace(0, 1e-9)
        return self

    def score(self, df: pd.DataFrame) -> np.ndarray:
        z = (df[self.features] - self.mean_) / self.std_
        return z.abs().max(axis=1).to_numpy()

    def explain(self, row: pd.Series) -> dict[str, float]:
        z = (row[self.features] - self.mean_) / self.std_
        return z.abs().sort_values(ascending=False).round(2).to_dict()

    def predict(self, df: pd.DataFrame) -> np.ndarray:
        return (self.score(df) >= self.threshold).astype(int)


@dataclass
class IForestDetector:
    features: list[str]
    n_estimators: int = 300
    max_samples: int | str = "auto"
    random_state: int = 0
    threshold: float = 0.0
    scaler_: StandardScaler = field(default_factory=StandardScaler)
    model_: IsolationForest | None = None

    def fit(self, normal: pd.DataFrame) -> "IForestDetector":
        X = self.scaler_.fit_transform(normal[self.features].to_numpy())
        self.model_ = IsolationForest(n_estimators=self.n_estimators, max_samples=self.max_samples,
                                      contamination="auto", random_state=self.random_state, n_jobs=-1).fit(X)
        return self

    def transform(self, df: pd.DataFrame) -> np.ndarray:
        return self.scaler_.transform(df[self.features].to_numpy())

    def score(self, df: pd.DataFrame) -> np.ndarray:
        """Higher = more anomalous."""
        return -self.model_.score_samples(self.transform(df))

    def predict(self, df: pd.DataFrame) -> np.ndarray:
        return (self.score(df) >= self.threshold).astype(int)

    def save(self, path: str | Path) -> None:
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        joblib.dump(self, path)

    @staticmethod
    def load(path: str | Path) -> "IForestDetector":
        return joblib.load(path)
