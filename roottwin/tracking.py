"""T25 - experiment tracking: every training / evaluation run is logged with its parameters and metrics.

MLflow when it is installed and MLFLOW_TRACKING_URI is set (docker compose --profile mlops up starts a server on
http://localhost:5000), otherwise an append-only reports/runs.jsonl so results stay comparable without extra infra.
"""
from __future__ import annotations

import json
import os
import time
from pathlib import Path

RUNS = Path(__file__).resolve().parents[1] / "reports" / "runs.jsonl"


def _flat(d: dict, prefix: str = "") -> dict:
    out = {}
    for k, v in d.items():
        key = f"{prefix}{k}"
        if isinstance(v, dict):
            out.update(_flat(v, f"{key}."))
        elif isinstance(v, (int, float)) and not isinstance(v, bool):
            out[key] = v
    return out


def log_run(experiment: str, params: dict, metrics: dict) -> str:
    """Log one run; returns where it went ("mlflow" or the jsonl path)."""
    flat = _flat(metrics)
    if os.getenv("MLFLOW_TRACKING_URI"):
        try:
            import mlflow
            mlflow.set_experiment(experiment)
            with mlflow.start_run():
                mlflow.log_params({k: str(v)[:250] for k, v in params.items()})
                mlflow.log_metrics(flat)
            return "mlflow"
        except ImportError:
            pass
    RUNS.parent.mkdir(exist_ok=True)
    with RUNS.open("a", encoding="utf-8") as f:
        f.write(json.dumps({"t": time.strftime("%Y-%m-%dT%H:%M:%S"), "experiment": experiment, "params": params, "metrics": flat}) + "\n")
    return str(RUNS)
