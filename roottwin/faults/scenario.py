"""Reproducible fault scenarios (YAML) and the runner that injects them.

A scenario = seed + line + duration + list of faults scheduled in simulated
minutes. The runner turns each scheduled fault into an `inject_fault` command
on MQTT (the same channel the UI and the RL agent use), so every injection is
logged in `events` with the scenario_id.
"""
from __future__ import annotations

import time
from pathlib import Path
from typing import Callable

import numpy as np
import yaml
from pydantic import BaseModel, Field, model_validator

from roottwin.contracts import Command
from roottwin.faults.models import load_catalog

DEFAULT_MACHINES = ["M1", "M2", "M3", "M4", "M5", "M6"]


class ScheduledFault(BaseModel, extra="forbid"):
    at_min: float = Field(ge=0, description="simulated minutes after scenario start")
    machine_id: str
    fault_code: str
    ramp_min: float | None = Field(default=None, gt=0)
    severity: int | None = Field(default=None, ge=1, le=5)


class Scenario(BaseModel, extra="forbid"):
    scenario_id: str
    description: str = ""
    seed: int = 0
    line_id: str = "line1"
    duration_min: float = Field(gt=0)
    machines: list[str] = Field(default_factory=lambda: list(DEFAULT_MACHINES))
    faults: list[ScheduledFault] = Field(default_factory=list)

    @model_validator(mode="after")
    def _check(self) -> "Scenario":
        cat = load_catalog()
        for f in self.faults:
            if f.fault_code not in cat:
                raise ValueError(f"unknown fault_code '{f.fault_code}'")
            if f.machine_id not in self.machines:
                raise ValueError(f"machine '{f.machine_id}' not in scenario machines")
            if f.at_min > self.duration_min:
                raise ValueError(f"fault at {f.at_min} min is after the end ({self.duration_min} min)")
        self.faults.sort(key=lambda f: f.at_min)
        return self

    def to_yaml(self) -> str:
        return yaml.safe_dump(self.model_dump(exclude_none=True), sort_keys=False, allow_unicode=True)


def load_scenario(path: str | Path) -> Scenario:
    return Scenario.model_validate(yaml.safe_load(Path(path).read_text(encoding="utf-8")))


def generate_scenarios(n: int, seed: int = 42, duration_min: float = 480,
                       max_faults: int = 3, healthy_ratio: float = 0.1,
                       machines: list[str] | None = None) -> list[Scenario]:
    """Random but reproducible scenarios for dataset generation (T12, 200+).

    Same (n, seed) -> exactly the same scenarios. ~healthy_ratio have no fault
    (needed to measure false alarms). Faults on one machine never overlap.
    """
    machines = machines or list(DEFAULT_MACHINES)
    codes = sorted(load_catalog())
    master = np.random.default_rng(seed)
    out = []
    for i in range(n):
        s_seed = int(master.integers(0, 2**31 - 1))
        rng = np.random.default_rng(s_seed)
        k = 0 if rng.random() < healthy_ratio else int(rng.integers(1, max_faults + 1))
        faults, busy = [], {}
        for _ in range(k):
            m = str(rng.choice(machines))
            start = float(rng.uniform(15, duration_min * 0.7))
            if m in busy and abs(busy[m] - start) < 120:
                continue
            busy[m] = start
            faults.append(ScheduledFault(at_min=round(start, 1), machine_id=m,
                                         fault_code=str(rng.choice(codes))))
        out.append(Scenario(scenario_id=f"GEN-{seed}-{i:04d}", seed=s_seed, duration_min=duration_min,
                            machines=machines, faults=faults,
                            description=f"generated {i + 1}/{n} (seed {seed})"))
    return out


def run_scenario(sc: Scenario, send: Callable[[str, str, Command], object],
                 time_scale: float = 60.0, sleep: Callable[[float], None] = time.sleep,
                 clock: Callable[[], float] = time.monotonic) -> list[Command]:
    """Inject the scenario's faults in (scaled) real time.

    send(line_id, machine_id, command) publishes the command (MqttPublisher.send_command).
    time_scale = simulated seconds per real second (60 -> 1 sim minute per second);
    it must match the simulation's own time scale.
    """
    if time_scale <= 0:
        raise ValueError("time_scale must be > 0")
    sent = []
    t0 = clock()
    for f in sc.faults:
        due = f.at_min * 60.0 / time_scale
        wait = due - (clock() - t0)
        if wait > 0:
            sleep(wait)
        params = {"fault_code": f.fault_code}
        if f.ramp_min:
            params["ramp_min"] = f.ramp_min
        if f.severity:
            params["severity"] = f.severity
        cmd = Command(command="inject_fault", params=params, issued_by="scenario", scenario_id=sc.scenario_id)
        send(sc.line_id, f.machine_id, cmd)
        sent.append(cmd)
    return sent
