"""T16 - Autoencoder anomaly detector (PyTorch).

Trained on NORMAL data only: it learns to reconstruct healthy behaviour, so a
high reconstruction error means "this does not look like normal operation".

Two input views:
- CWRU vibration: log-magnitude spectrum of a 2048-sample window, pooled to 256 bins;
- simulated line: last `seq_len` minutes of the 4 sensors, flattened.
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pandas as pd
import torch
from torch import nn

SENSORS = ["vibration", "temperature", "current", "cadence"]


class DenseAE(nn.Module):
    def __init__(self, n_in: int, hidden: int = 64, latent: int = 8, dropout: float = 0.1):
        super().__init__()
        self.encoder = nn.Sequential(nn.Linear(n_in, hidden), nn.ReLU(), nn.Dropout(dropout),
                                     nn.Linear(hidden, latent))
        self.decoder = nn.Sequential(nn.Linear(latent, hidden), nn.ReLU(), nn.Linear(hidden, n_in))

    def forward(self, x):
        return self.decoder(self.encoder(x))


@dataclass
class AEDetector:
    """Standardise -> DenseAE -> score = mean squared reconstruction error."""
    hidden: int = 64
    latent: int = 8
    epochs: int = 200
    lr: float = 1e-3
    batch: int = 128
    patience: int = 15
    seed: int = 0
    threshold: float = 0.0

    def fit(self, X: np.ndarray, X_val: np.ndarray | None = None, verbose: bool = False) -> "AEDetector":
        torch.manual_seed(self.seed)
        np.random.seed(self.seed)
        self.mu_ = X.mean(axis=0)
        self.sd_ = X.std(axis=0) + 1e-6
        Xt = torch.tensor((X - self.mu_) / self.sd_, dtype=torch.float32)
        Xv = torch.tensor((X_val - self.mu_) / self.sd_, dtype=torch.float32) if X_val is not None else Xt
        self.model_ = DenseAE(X.shape[1], self.hidden, self.latent)
        opt = torch.optim.Adam(self.model_.parameters(), lr=self.lr, weight_decay=1e-5)
        loss_fn = nn.MSELoss()
        best, best_state, wait, self.history_ = np.inf, None, 0, []
        for epoch in range(self.epochs):
            self.model_.train()
            perm = torch.randperm(len(Xt))
            for i in range(0, len(Xt), self.batch):
                xb = Xt[perm[i:i + self.batch]]
                opt.zero_grad()
                loss = loss_fn(self.model_(xb), xb)
                loss.backward()
                opt.step()
            self.model_.eval()
            with torch.no_grad():
                v = float(loss_fn(self.model_(Xv), Xv))
            self.history_.append(v)
            if v < best - 1e-5:
                best, best_state, wait = v, {k: t.clone() for k, t in self.model_.state_dict().items()}, 0
            else:
                wait += 1
                if wait >= self.patience:
                    break
            if verbose and epoch % 20 == 0:
                print(f"    epoch {epoch:3d} val loss {v:.4f}")
        self.model_.load_state_dict(best_state)
        self.model_.eval()
        return self

    def score(self, X: np.ndarray) -> np.ndarray:
        x = torch.tensor((X - self.mu_) / self.sd_, dtype=torch.float32)
        with torch.no_grad():
            err = (self.model_(x) - x).pow(2).mean(dim=1)
        return err.numpy()

    def feature_errors(self, X: np.ndarray) -> np.ndarray:
        """Per-input reconstruction error (which inputs look abnormal) - used for explanations."""
        x = torch.tensor((X - self.mu_) / self.sd_, dtype=torch.float32)
        with torch.no_grad():
            return (self.model_(x) - x).pow(2).numpy()

    def save(self, path: str | Path) -> None:
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        torch.save({"cfg": {k: getattr(self, k) for k in ("hidden", "latent", "threshold")},
                    "mu": self.mu_, "sd": self.sd_, "n_in": len(self.mu_),
                    "state": self.model_.state_dict()}, path)

    @staticmethod
    def load(path: str | Path) -> "AEDetector":
        ck = torch.load(path, weights_only=False)
        det = AEDetector(**ck["cfg"])
        det.mu_, det.sd_ = ck["mu"], ck["sd"]
        det.model_ = DenseAE(ck["n_in"], det.hidden, det.latent)
        det.model_.load_state_dict(ck["state"])
        det.model_.eval()
        return det


# ---------------------------------------------------------------- input views
def spectrum(windows: np.ndarray, bins: int = 256) -> np.ndarray:
    """Log-magnitude FFT of each window, averaged into `bins` frequency bands."""
    w = windows * np.hanning(windows.shape[1])
    mag = np.abs(np.fft.rfft(w, axis=1))[:, 1:]
    mag = mag[:, : (mag.shape[1] // bins) * bins].reshape(len(mag), bins, -1).mean(axis=2)
    return np.log1p(mag).astype(np.float32)


def sequences(df: pd.DataFrame, seq_len: int = 30) -> tuple[np.ndarray, np.ndarray]:
    """Sliding windows of the last seq_len minutes per (scenario, machine).

    Returns (X, idx): X shape (n, seq_len * 4), idx = df index of each window's LAST row,
    so window scores align with rows (first seq_len-1 rows of each machine have no score).
    """
    X, idx = [], []
    for _, g in df.groupby(["scenario_id", "machine_id"], sort=False):
        v = g[SENSORS].to_numpy(np.float32)
        if len(v) < seq_len:
            continue
        win = np.lib.stride_tricks.sliding_window_view(v, (seq_len, v.shape[1]))[:, 0]
        X.append(win.reshape(len(win), -1))
        idx.append(g.index.to_numpy()[seq_len - 1:])
    return np.concatenate(X), np.concatenate(idx)
