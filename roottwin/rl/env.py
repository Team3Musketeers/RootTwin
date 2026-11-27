"""T17 - Gymnasium environment over the line engine.

Every step = 5 simulated minutes of an 8-hour shift (96 steps). Wear-driven random
faults happen; the agent decides who intervenes where, with the SAME commands
as the UI (dispatch_worker, preventive_maintenance, wait).

Observation (what a supervisor can see, no hidden fault labels), per machine:
  down, in_maintenance, worker_assigned, wear (operating-hours proxy),
  vibration / temperature / current / cadence as ratio of nominal (reading at the decision time)
+ free workers (3) + shift progress (1)  -> 52 floats.
Action: 0 = wait, 1..6 = dispatch a worker to machine i (repair or inspect),
        7..12 = preventive maintenance on machine i.
Reward: (good parts x value - line downtime x cost - repair/PM costs) / 1000.
"""
from __future__ import annotations

import gymnasium as gym
import numpy as np

from roottwin.line import DOWNTIME_COST_PER_MIN, NOMINAL, PART_VALUE, SENSORS, Line

STEP_MIN, SHIFT_MIN, N = 5, 480, 6
INVALID_PENALTY = 0.05


class MaintenanceEnv(gym.Env):
    metadata = {"render_modes": []}

    def __init__(self, hazard_per_min: float = 1.2e-3, shift_min: int = SHIFT_MIN, seed: int | None = None):
        super().__init__()
        self.hazard, self.shift = hazard_per_min, shift_min
        self.action_space = gym.spaces.Discrete(1 + 2 * N)
        self.observation_space = gym.spaces.Box(0.0, 5.0, shape=(N * 8 + 4,), dtype=np.float32)
        self.line: Line | None = None
        self._seed = seed
        self.invalid_actions = 0

    # ------------------------------------------------------------------ gym
    def reset(self, *, seed: int | None = None, options=None):
        super().reset(seed=seed)
        s = seed if seed is not None else int(self.np_random.integers(0, 2**31 - 1))
        self.line = Line(seed=s, random_faults=True, hazard_per_min=self.hazard)
        rng = np.random.default_rng(s + 1)
        for m in self.line.machines:
            m.wear = float(rng.uniform(0.0, 0.6))          # machines start the shift at different ages
        self.line.command("LINE", "start_line")
        self.invalid_actions = 0
        self._means = {i: dict(NOMINAL) for i in range(N)}
        return self._obs(), {}

    def step(self, action: int):
        before = dict(self.line.kpi)
        err = self.apply(int(action))
        self.line.step(float(STEP_MIN))
        self._means = {i: self.line.sensors(i) for i in range(N)}   # one reading per decision (cheap)
        k = self.line.kpi
        reward = ((k["parts_ok"] - before["parts_ok"]) * PART_VALUE
                  - (k["line_down_min"] - before["line_down_min"]) * DOWNTIME_COST_PER_MIN
                  - (k["repair_cost"] - before["repair_cost"]) - (k["pm_cost"] - before["pm_cost"])) / 1000
        if err:
            reward -= INVALID_PENALTY
            self.invalid_actions += 1
        done = self.line.t >= self.shift
        return self._obs(), float(reward), done, False, {"kpi": self.line.kpis(), "error": err}

    # ------------------------------------------------------------------ helpers
    def apply(self, action: int) -> str | None:
        if action == 0:
            return None
        i = (action - 1) % N
        kind = "dispatch_worker" if action <= N else "preventive_maintenance"
        return self.line.command(f"M{i + 1}", kind, {})

    def _obs(self) -> np.ndarray:
        o = []
        for i, m in enumerate(self.line.machines):
            mean = self._means[i]
            o += [float(m.status == "down"), float(m.status == "maintenance"), float(m.worker is not None), m.wear,
                  *[min(mean[s] / NOMINAL[s], 5.0) for s in SENSORS]]
        o += [float(w.task is None) for w in self.line.workers]
        o += [min(self.line.t / self.shift, 1.0)]
        return np.asarray(o, dtype=np.float32)

    @staticmethod
    def machine_view(obs: np.ndarray, i: int) -> dict:
        b = i * 8
        return {"down": obs[b] > .5, "maint": obs[b + 1] > .5, "worker": obs[b + 2] > .5, "wear": obs[b + 3],
                "vibration": obs[b + 4], "temperature": obs[b + 5], "current": obs[b + 6], "cadence": obs[b + 7]}

    @staticmethod
    def free_workers(obs: np.ndarray) -> int:
        return int(obs[N * 8:N * 8 + 3].sum())
