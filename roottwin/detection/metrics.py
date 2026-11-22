"""Detection metrics shared by every detector (see docs/KPI.md, section 2)."""
from __future__ import annotations

import numpy as np
from sklearn.metrics import (average_precision_score, confusion_matrix, f1_score, precision_recall_curve,
                             precision_score, recall_score, roc_auc_score)


def threshold_for_recall(y_true: np.ndarray, scores: np.ndarray, target_recall: float = 0.9) -> float:
    """Highest threshold whose recall >= target (i.e. best precision at that recall).

    Higher score = more anomalous; alarm when score >= threshold.
    """
    prec, rec, thr = precision_recall_curve(y_true, scores)
    ok = np.where(rec[:-1] >= target_recall)[0]
    if len(ok) == 0:
        return float(thr.min())
    return float(thr[ok].max())


def threshold_best_f1(y_true: np.ndarray, scores: np.ndarray) -> float:
    prec, rec, thr = precision_recall_curve(y_true, scores)
    f1 = 2 * prec[:-1] * rec[:-1] / np.clip(prec[:-1] + rec[:-1], 1e-12, None)
    return float(thr[int(np.argmax(f1))])


def report(y_true: np.ndarray, scores: np.ndarray, threshold: float,
           samples_per_day: float | None = None) -> dict:
    """Metrics at a threshold + threshold-free ROC-AUC / PR-AUC.

    samples_per_day: how many scored samples one day of operation produces;
    gives the false-alarm rate per day (KPI: <= 1 per day).
    """
    y_true = np.asarray(y_true).astype(int)
    pred = (np.asarray(scores) >= threshold).astype(int)
    tn, fp, fn, tp = confusion_matrix(y_true, pred, labels=[0, 1]).ravel()
    out = {
        "threshold": float(threshold),
        "precision": float(precision_score(y_true, pred, zero_division=0)),
        "recall": float(recall_score(y_true, pred, zero_division=0)),
        "f1": float(f1_score(y_true, pred, zero_division=0)),
        "roc_auc": float(roc_auc_score(y_true, scores)),
        "pr_auc": float(average_precision_score(y_true, scores)),
        "positives": int(y_true.sum()), "n": int(len(y_true)),
        "tp": int(tp), "fp": int(fp), "fn": int(fn), "tn": int(tn),
        "false_alarm_rate": float(fp / max(fp + tn, 1)),
    }
    if samples_per_day:
        out["false_alarms_per_day"] = float(out["false_alarm_rate"] * samples_per_day)
    return out
