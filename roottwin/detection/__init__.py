"""Anomaly / fault detection (T13 Isolation Forest, T16 autoencoder, T20 RUL, T22 SHAP)."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MODELS = ROOT / "models"
REPORTS = ROOT / "reports"
