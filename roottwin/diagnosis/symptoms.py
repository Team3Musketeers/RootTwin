"""Discretised symptoms shared by the propagation graph and the Bayesian network.

A reading is compared with the nominal operating point (roottwin.line.NOMINAL). Thresholds are deliberately coarse:
they turn noisy sensors into the yes/no evidence a technician reads on an HMI ("vibration high", "machine idle").
"""
from __future__ import annotations

from roottwin.line import NOMINAL

SYMPTOMS = ["vib_high", "temp_high", "current_high", "slow", "idle"]


def symptoms(s: dict[str, float]) -> dict[str, bool]:
    cad = s.get("cadence", NOMINAL["cadence"])
    return {
        "vib_high": s.get("vibration", 0) > 1.35 * NOMINAL["vibration"],
        "temp_high": s.get("temperature", 0) > 1.10 * NOMINAL["temperature"],
        "current_high": s.get("current", 0) > 1.25 * NOMINAL["current"],
        "slow": 1.0 <= cad < 0.8 * NOMINAL["cadence"],
        "idle": cad < 1.0,                                   # starved, blocked or down: no parts processed
    }


def abnormal(sym: dict[str, bool]) -> bool:
    """An intrinsic anomaly (not just waiting for parts)."""
    return sym["vib_high"] or sym["temp_high"] or sym["current_high"] or sym["slow"]
