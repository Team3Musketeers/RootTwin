"""T22 - explain every alert: SHAP on the Isolation Forest + fault-signature matching.

explain_alert(row) returns:
- the sensors driving the alert (SHAP contributions, in % of the anomaly),
- how far each one is from its normal level (ratio / delta),
- the faults of the catalogue whose signature matches best (candidates for the copilot),
- a one-paragraph text for the UI.
The root-cause propagation path (T15, Person A) can be passed in and is added to the text.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd
import shap

from roottwin.detection.iforest import IForestDetector
from roottwin.faults.models import load_catalog

SENSORS = ["vibration", "temperature", "current", "cadence"]
UNITS = {"vibration": "mm/s", "temperature": "°C", "current": "A", "cadence": "parts/min"}


def _sensor_of(feature: str) -> str:
    return feature.split("_")[0]


@dataclass
class Explanation:
    machine_id: str
    t_min: float | None
    score: float
    contributions: dict[str, float]          # sensor -> share of the anomaly (0..1)
    deviations: dict[str, dict]              # sensor -> {value, normal, ratio, direction}
    candidates: list[tuple[str, float]]      # (fault_code, match score 0..1), best first
    text: str

    def to_dict(self) -> dict:
        return {"machine_id": self.machine_id, "t_min": self.t_min, "score": round(self.score, 4),
                "contributions": self.contributions, "deviations": self.deviations,
                "candidates": [{"fault_code": c, "match": m} for c, m in self.candidates], "text": self.text}


class AlertExplainer:
    def __init__(self, detector: IForestDetector, normal: pd.DataFrame, min_rel_dev: float = 0.08):
        self.det = detector
        self.features = detector.features
        self.explainer = shap.TreeExplainer(detector.model_)
        self.normal_mean = normal[self.features].mean()
        self.normal_std = normal[self.features].std()
        self.min_rel_dev = min_rel_dev
        self.catalog = load_catalog()

    # -- SHAP -------------------------------------------------------------
    def shap_values(self, df: pd.DataFrame) -> np.ndarray:
        """Per-feature contribution to the ANOMALY (positive = pushes towards 'abnormal')."""
        # TreeExplainer explains the forest's path length (higher = more normal) -> negate
        return -np.asarray(self.explainer.shap_values(self.det.transform(df)))

    def sensor_contributions(self, sv_row: np.ndarray) -> dict[str, float]:
        pos = pd.Series(np.clip(sv_row, 0, None), index=self.features)
        per_sensor = pos.groupby([_sensor_of(f) for f in self.features]).sum()
        total = per_sensor.sum() or 1.0
        return (per_sensor / total).sort_values(ascending=False).round(3).to_dict()

    # -- deviations & signature matching ----------------------------------
    def deviations(self, row: pd.Series) -> dict[str, dict]:
        out = {}
        for s in SENSORS:
            f = f"{s}_mean"
            if f not in self.features:
                continue
            normal, v = float(self.normal_mean[f]), float(row[f])
            rel = (v - normal) / normal if normal else 0.0
            std_now = float(row.get(f"{s}_std", np.nan))
            std_norm = float(self.normal_std.get(f"{s}_std", np.nan)) if f"{s}_std" in self.normal_std else np.nan
            noise_ratio = std_now / float(self.normal_mean[f"{s}_std"]) if f"{s}_std" in self.features else np.nan
            direction = "up" if rel > self.min_rel_dev else "down" if rel < -self.min_rel_dev else "normal"
            if not np.isnan(noise_ratio):
                if noise_ratio > 3:
                    direction += "+noisy"
                elif noise_ratio < 0.2:
                    direction += "+flat"
            out[s] = {"value": round(v, 2), "normal": round(normal, 2), "ratio": round(v / normal, 2) if normal else None,
                      "direction": direction}
        return out

    def match_faults(self, dev: dict[str, dict], top: int = 3) -> list[tuple[str, float]]:
        """Score each catalogue fault: does its signature (sensor + direction) match what we see?"""
        observed = {s: d["direction"] for s, d in dev.items()}
        scores = []
        for code, spec in self.catalog.items():
            expected = {}
            for e in spec.effects:
                if e.kind in ("ramp", "step", "offset"):
                    expected[e.sensor] = "up" if e.magnitude > 0 else "down"
                elif e.kind == "noise":
                    expected[e.sensor] = "noisy"
                elif e.kind == "stuck":
                    expected[e.sensor] = "flat"
            hits = sum(1 for s, d in expected.items() if d in observed.get(s, ""))
            # penalise sensors that deviate but are NOT part of the signature
            extra = sum(1 for s, d in observed.items() if d != "normal" and s not in expected)
            scores.append((code, round(max(hits - 0.5 * extra, 0) / len(expected), 2)))
        scores.sort(key=lambda x: -x[1])
        return scores[:top]

    @staticmethod
    def rerank(cands: list[tuple[str, float]], probs: dict[str, float], weight: float = 1.0,
               top: int = 3) -> list[tuple[str, float]]:
        """Combine signature match with a fault-type classifier's probabilities (T20).

        Signature matching is explainable but ties faults with the same signature
        (OVERHEATING vs COOLING_FAILURE vs SENSOR_DRIFT); the temporal classifier
        sees the SHAPE over time (sudden jump vs slow ramp) and breaks the tie.
        """
        codes = {c for c, _ in cands} | {c for c in probs if c != "none"}
        match = dict(cands)
        scored = [(c, round(match.get(c, 0.0) + weight * probs.get(c, 0.0), 2)) for c in codes]
        scored.sort(key=lambda x: -x[1])
        total = sum(s for _, s in scored[:top]) or 1.0
        return [(c, round(s / total, 2)) for c, s in scored[:top]]

    # -- full explanation -------------------------------------------------
    def explain(self, row: pd.Series, machine_id: str = "?", t_min: float | None = None,
                propagation_path: list[str] | None = None,
                fault_probs: dict[str, float] | None = None) -> Explanation:
        df = row[self.features].to_frame().T.astype(float)
        sv = self.shap_values(df)[0]
        contrib = self.sensor_contributions(sv)
        dev = self.deviations(row)
        cands = self.match_faults(dev, top=len(self.catalog))
        cands = self.rerank(cands, fault_probs) if fault_probs else cands[:3]
        parts = []
        for s, share in contrib.items():
            if share < 0.1:
                continue
            d = dev.get(s, {})
            what = d.get("direction", "")
            if what.startswith("up"):
                desc = f"{s} is {d['ratio']:.2f}x its normal level ({d['value']} vs {d['normal']} {UNITS[s]})"
            elif what.startswith("down"):
                desc = f"{s} dropped to {d['ratio']:.0%} of normal ({d['value']} vs {d['normal']} {UNITS[s]})"
            elif "noisy" in what:
                desc = f"{s} became unstable (much noisier than usual)"
            elif "flat" in what:
                desc = f"{s} signal is frozen (no variation: possible sensor fault)"
            else:
                desc = f"{s} pattern is unusual"
            parts.append(f"{desc} — {share:.0%} of the anomaly")
        text = f"Alert on {machine_id}: " + ("; ".join(parts) or "combination of small deviations") + "."
        if cands and cands[0][1] > 0:
            label = "likelihood" if fault_probs else "match"
            text += " Most consistent with " + ", ".join(f"{c} ({m:.0%} {label})" for c, m in cands if m > 0) + "."
        if propagation_path:
            text += " Propagation path: " + " → ".join(propagation_path) + "."
        return Explanation(machine_id, t_min, float(self.det.score(df)[0]), contrib, dev, cands, text)
