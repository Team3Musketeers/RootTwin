"""T20 - temporal deep models: RUL regression (C-MAPSS) and fault-type classification.

Two sequence encoders with the same interface (input: batch x time x features):
- LSTMNet: 2-layer LSTM, last hidden state -> head
- TCNNet : dilated causal 1D convolutions (temporal convolutional network) -> head
"""
from __future__ import annotations

import numpy as np
import torch
from torch import nn


class LSTMNet(nn.Module):
    def __init__(self, n_feat: int, n_out: int = 1, hidden: int = 64, layers: int = 2, dropout: float = 0.2):
        super().__init__()
        self.lstm = nn.LSTM(n_feat, hidden, num_layers=layers, batch_first=True, dropout=dropout)
        self.head = nn.Sequential(nn.Linear(hidden, 32), nn.ReLU(), nn.Dropout(dropout), nn.Linear(32, n_out))

    def forward(self, x):
        out, _ = self.lstm(x)
        return self.head(out[:, -1])


class _TCNBlock(nn.Module):
    def __init__(self, c_in, c_out, k, dilation, dropout):
        super().__init__()
        self.pad = (k - 1) * dilation  # left padding only -> causal
        self.conv1 = nn.Conv1d(c_in, c_out, k, dilation=dilation)
        self.conv2 = nn.Conv1d(c_out, c_out, k, dilation=dilation)
        self.drop = nn.Dropout(dropout)
        self.res = nn.Conv1d(c_in, c_out, 1) if c_in != c_out else nn.Identity()

    def forward(self, x):
        y = self.drop(torch.relu(self.conv1(nn.functional.pad(x, (self.pad, 0)))))
        y = self.drop(torch.relu(self.conv2(nn.functional.pad(y, (self.pad, 0)))))
        return torch.relu(y + self.res(x))


class TCNNet(nn.Module):
    def __init__(self, n_feat: int, n_out: int = 1, channels: int = 32, levels: int = 4, k: int = 3,
                 dropout: float = 0.2):
        super().__init__()
        blocks, c = [], n_feat
        for i in range(levels):
            blocks.append(_TCNBlock(c, channels, k, 2 ** i, dropout))
            c = channels
        self.tcn = nn.Sequential(*blocks)
        self.head = nn.Sequential(nn.Linear(channels, 32), nn.ReLU(), nn.Linear(32, n_out))

    def forward(self, x):                       # x: B x T x F
        return self.head(self.tcn(x.transpose(1, 2))[:, :, -1])


def train(model: nn.Module, Xtr, ytr, Xva, yva, task: str = "regression", epochs: int = 60, lr: float = 1e-3,
          batch: int = 256, patience: int = 10, seed: int = 0, class_weights=None, verbose: bool = False):
    torch.manual_seed(seed)
    Xtr, Xva = torch.tensor(Xtr, dtype=torch.float32), torch.tensor(Xva, dtype=torch.float32)
    if task == "regression":
        ytr, yva = torch.tensor(ytr, dtype=torch.float32)[:, None], torch.tensor(yva, dtype=torch.float32)[:, None]
        loss_fn = nn.MSELoss()
    else:
        ytr, yva = torch.tensor(ytr, dtype=torch.long), torch.tensor(yva, dtype=torch.long)
        w = torch.tensor(class_weights, dtype=torch.float32) if class_weights is not None else None
        loss_fn = nn.CrossEntropyLoss(weight=w)
    opt = torch.optim.Adam(model.parameters(), lr=lr)
    sched = torch.optim.lr_scheduler.ReduceLROnPlateau(opt, factor=0.5, patience=4)
    best, best_state, wait, hist = np.inf, None, 0, []
    for ep in range(epochs):
        model.train()
        perm = torch.randperm(len(Xtr))
        for i in range(0, len(Xtr), batch):
            b = perm[i:i + batch]
            opt.zero_grad()
            loss = loss_fn(model(Xtr[b]), ytr[b])
            loss.backward()
            nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            opt.step()
        model.eval()
        with torch.no_grad():
            v = float(loss_fn(model(Xva), yva))
        sched.step(v)
        hist.append(v)
        if verbose:
            print(f"    epoch {ep:3d} val loss {v:.4f}")
        if v < best - 1e-4:
            best, best_state, wait = v, {k: t.clone() for k, t in model.state_dict().items()}, 0
        else:
            wait += 1
            if wait >= patience:
                break
    model.load_state_dict(best_state)
    model.eval()
    return hist


def predict(model: nn.Module, X: np.ndarray, batch: int = 2048) -> np.ndarray:
    model.eval()
    outs = []
    with torch.no_grad():
        for i in range(0, len(X), batch):
            outs.append(model(torch.tensor(X[i:i + batch], dtype=torch.float32)).numpy())
    return np.concatenate(outs)


def nasa_score(y_true: np.ndarray, y_pred: np.ndarray) -> float:
    """PHM08 asymmetric score: late predictions (pred > true) are penalised more."""
    d = y_pred - y_true
    return float(np.sum(np.where(d < 0, np.exp(-d / 13) - 1, np.exp(d / 10) - 1)))
