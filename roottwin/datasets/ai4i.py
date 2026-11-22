"""AI4I 2020 Predictive Maintenance Dataset (UCI #601, Matzka 2020).

10 000 synthetic-but-realistic machining records, 5 process variables, a
machine-failure label and 5 failure-mode flags:
TWF tool wear, HDF heat dissipation, PWF power, OSF overstrain, RNF random.
"""
from __future__ import annotations

from pathlib import Path

import pandas as pd

from roottwin.datasets import RAW

FAILURE_MODES = {
    "TWF": "tool wear failure",
    "HDF": "heat dissipation failure",
    "PWF": "power failure",
    "OSF": "overstrain failure",
    "RNF": "random failure",
}
# AI4I failure mode -> closest code of our fault catalogue (used to compare/transfer)
TO_CATALOG = {"TWF": "TOOL_WEAR", "HDF": "OVERHEATING", "PWF": "MOTOR_OVERCURRENT",
              "OSF": "MISALIGNMENT", "RNF": None}
SENSORS = {  # clean name -> (raw column, unit)
    "air_temp_k": ("Air temperature [K]", "K"),
    "process_temp_k": ("Process temperature [K]", "K"),
    "rpm": ("Rotational speed [rpm]", "rpm"),
    "torque_nm": ("Torque [Nm]", "Nm"),
    "tool_wear_min": ("Tool wear [min]", "min"),
}


def load(path: Path | None = None) -> pd.DataFrame:
    path = path or RAW / "ai4i" / "ai4i2020.csv"
    df = pd.read_csv(path, encoding="utf-8-sig")
    df = df.rename(columns={raw: clean for clean, (raw, _) in SENSORS.items()})
    df = df.rename(columns={"UDI": "udi", "Product ID": "product_id", "Type": "quality",
                            "Machine failure": "failure"})
    df["quality"] = df["quality"].astype("category")  # L / M / H product quality variant
    # derived physics features (power and temperature gap drive PWF / HDF)
    df["power_w"] = df["torque_nm"] * df["rpm"] * 2 * 3.141592653589793 / 60
    df["temp_diff_k"] = df["process_temp_k"] - df["air_temp_k"]
    df["failure_mode"] = df[list(FAILURE_MODES)].idxmax(axis=1).where(df[list(FAILURE_MODES)].any(axis=1), "none")
    return df.sort_values("udi").reset_index(drop=True)
