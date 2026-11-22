"""Fault catalogue models and sensor effects."""
from __future__ import annotations

from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Literal

import numpy as np
import yaml
from pydantic import BaseModel, Field, model_validator

CATALOG_PATH = Path(__file__).with_name("catalog.yaml")
State = Literal["ok", "degraded", "down"]
_STATE_RANK = {"ok": 0, "degraded": 1, "down": 2}


class SensorEffect(BaseModel, extra="forbid"):
    sensor: str
    kind: Literal["ramp", "step", "offset", "noise", "stuck"]
    magnitude: float


class RepairSpec(BaseModel, extra="forbid"):
    skill: Literal["mechanic", "electrician", "technician", "operator"]
    minutes: float = Field(gt=0)
    cost_eur: float = Field(ge=0)
    action: Literal["repair", "replace"]
    loto_required: bool


class FaultSpec(BaseModel, extra="forbid"):
    code: str
    family: str
    description: str
    onset: Literal["gradual", "sudden"]
    ramp_min: float = Field(gt=0, description="minutes from injection to full effect / failure")
    degraded_at: float = Field(ge=0, le=1)
    stops_machine: bool
    scrap_rate_max: float = Field(default=0.0, ge=0, le=1)
    effects: list[SensorEffect] = Field(min_length=1)
    repair: RepairSpec

    @property
    def sensors(self) -> set[str]:
        return {e.sensor for e in self.effects}


class Catalog(BaseModel):
    families: dict[str, str]
    faults: dict[str, FaultSpec]

    @model_validator(mode="before")
    @classmethod
    def _inject_codes(cls, data: dict) -> dict:
        for code, spec in data.get("faults", {}).items():
            spec.setdefault("code", code)
        return data

    @model_validator(mode="after")
    def _families_exist(self) -> "Catalog":
        for f in self.faults.values():
            if f.family not in self.families:
                raise ValueError(f"{f.code}: unknown family '{f.family}'")
        return self


@lru_cache(maxsize=4)
def _load(path: str) -> Catalog:
    return Catalog.model_validate(yaml.safe_load(Path(path).read_text(encoding="utf-8")))


def load_catalog(path: str | Path = CATALOG_PATH) -> dict[str, FaultSpec]:
    return _load(str(path)).faults


def families(path: str | Path = CATALOG_PATH) -> dict[str, str]:
    return _load(str(path)).families


@dataclass
class ActiveFault:
    """A fault injected on one machine at simulated time start_min (minutes)."""
    spec: FaultSpec
    machine_id: str
    start_min: float
    ramp_min: float | None = None          # override spec.ramp_min
    _frozen: dict[str, float] = field(default_factory=dict, repr=False)

    @property
    def code(self) -> str:
        return self.spec.code

    def progress(self, now_min: float) -> float:
        ramp = self.ramp_min or self.spec.ramp_min
        return float(np.clip((now_min - self.start_min) / ramp, 0.0, 1.0))

    def state(self, now_min: float) -> State:
        p = self.progress(now_min)
        if now_min < self.start_min:
            return "ok"
        if p >= 1.0 and self.spec.stops_machine:
            return "down"
        return "degraded" if p >= self.spec.degraded_at else "ok"

    def scrap_rate(self, now_min: float) -> float:
        return self.spec.scrap_rate_max * self.progress(now_min)

    def apply(self, sensors: dict[str, float], now_min: float,
              rng: np.random.Generator | None = None) -> dict[str, float]:
        """Return a copy of `sensors` with this fault's signature applied."""
        out = dict(sensors)
        if now_min < self.start_min:
            return out
        p = self.progress(now_min)
        rng = rng or np.random.default_rng()
        for e in self.spec.effects:
            if e.sensor not in out:
                continue
            v = out[e.sensor]
            if e.kind == "ramp":
                v = v * (1 + e.magnitude * p)
            elif e.kind == "step":
                v = v * (1 + e.magnitude)
            elif e.kind == "offset":
                v = v + e.magnitude * p
            elif e.kind == "noise":
                v = v + rng.normal(0.0, e.magnitude * abs(v) * p) if p > 0 else v
            elif e.kind == "stuck":
                v = self._frozen.setdefault(e.sensor, v)
            out[e.sensor] = max(v, 0.0)
        return out


def worst_state(states: list[State]) -> State:
    return max(states, key=_STATE_RANK.__getitem__, default="ok")
