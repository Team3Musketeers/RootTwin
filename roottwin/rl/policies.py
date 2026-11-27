"""T18 - baseline maintenance policies + OR-Tools planner (for the T28 benchmark).

All policies see the same observation as the RL agent: f(obs) -> action.
"""
from __future__ import annotations

import numpy as np

from roottwin.rl.env import N, STEP_MIN, MaintenanceEnv

view = MaintenanceEnv.machine_view


def _dispatch(i: int) -> int:
    return 1 + i


def _pm(i: int) -> int:
    return 1 + N + i


def corrective(obs: np.ndarray) -> int:
    """Repair only after the machine has stopped."""
    for i in range(N):
        v = view(obs, i)
        if v["down"] and not v["worker"]:
            return _dispatch(i)
    return 0


def preventive(obs: np.ndarray, wear_limit: float = 0.5) -> int:
    """Corrective + calendar maintenance when operating time (wear) passes a limit."""
    a = corrective(obs)
    if a or MaintenanceEnv.free_workers(obs) < 2:      # keep one worker for breakdowns
        return a
    for i in range(N):
        v = view(obs, i)
        if v["wear"] >= wear_limit and not v["worker"] and not v["maint"]:
            return _pm(i)
    return 0


def anomalous(v: dict) -> bool:
    """Sensor thresholds (the 'seuils' of T13, on 5-min means)."""
    return (v["vibration"] > 1.35 or v["temperature"] > 1.12 or v["current"] > 1.2) and not v["down"]


def condition(obs: np.ndarray) -> int:
    """Corrective + intervene as soon as sensors leave their normal band."""
    a = corrective(obs)
    if a:
        return a
    for i in range(N):
        v = view(obs, i)
        if anomalous(v) and not v["worker"] and not v["maint"]:
            return _dispatch(i)
    return 0


class ORToolsPlanner:
    """Condition-based + preventive maintenance PLANNED by a CP-SAT solver.

    At the start of the shift it schedules at most one PM per machine so that the
    expected cost of wear-driven failures plus the PM stops is minimal, with at most
    one PM at a time (each PM stops the serial line). During the shift it follows the
    plan and reacts to breakdowns / anomalies like `condition`.
    """

    def __init__(self, hazard_per_min: float = 1.2e-3, slots: int = 96, pm_slots: int = 6,
                 fault_cost: float = 1500.0, pm_cost: float = 1500.0):   # fault_cost tuned on seeds 0-19 (train seeds)
        self.h, self.slots, self.pm_slots = hazard_per_min, slots, pm_slots
        self.fault_cost, self.pm_cost = fault_cost, pm_cost
        self.plan: dict[int, int] = {}

    def _risk(self, wear0: float, start: int, end: int) -> float:
        """Expected number of faults between slots [start, end) given starting wear."""
        t = np.arange(start, end) * STEP_MIN
        wear = np.minimum(1.0, wear0 + t / 2400)
        return float((self.h * STEP_MIN * (1 + 30 * wear ** 2)).sum())

    def solve(self, obs: np.ndarray) -> dict[int, int]:
        from ortools.sat.python import cp_model
        m = cp_model.CpModel()
        choices, intervals, objective = {}, [], []
        for i in range(N):
            w0 = float(view(obs, i)["wear"])
            none = m.NewBoolVar(f"none_{i}")
            opts = [none]
            objective.append(int(self.fault_cost * self._risk(w0, 0, self.slots)) * none)
            for s in range(0, self.slots - self.pm_slots, 4):
                b = m.NewBoolVar(f"pm_{i}_{s}")
                opts.append(b)
                # faults before the PM at the old wear, after it from a fresh machine
                risk = self._risk(w0, 0, s) + self._risk(0.0, 0, self.slots - s)
                objective.append(int(self.fault_cost * risk + self.pm_cost) * b)
                intervals.append(m.NewOptionalIntervalVar(s, self.pm_slots, s + self.pm_slots, b, f"iv_{i}_{s}"))
                choices[(i, s)] = b
            m.AddExactlyOne(opts)
        m.AddNoOverlap(intervals)       # one PM at a time: each PM stops the serial line
        m.Minimize(sum(objective))
        solver = cp_model.CpSolver()
        solver.parameters.max_time_in_seconds = 2.0
        solver.parameters.num_workers = 4
        solver.Solve(m)
        return {i: s for (i, s), b in choices.items() if solver.Value(b)}

    def __call__(self, obs: np.ndarray, step: int) -> int:
        if step == 0:
            self.plan = self.solve(obs)
        a = condition(obs)
        if a:
            return a
        for i, s in self.plan.items():
            v = view(obs, i)
            if step >= s and not v["worker"] and not v["maint"]:
                del self.plan[i]
                return _pm(i)
        return 0
