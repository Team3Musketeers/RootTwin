"""T28 - run every strategy on the same shifts (same seeds) and compare."""
from __future__ import annotations

from functools import lru_cache

from roottwin.detection import MODELS
from roottwin.rl import policies as P
from roottwin.rl.env import MaintenanceEnv


@lru_cache(maxsize=1)
def _ppo():
    path = MODELS / "ppo_maintenance.zip"
    if not path.exists():
        return None
    try:
        from stable_baselines3 import PPO
    except ImportError:          # light API image without torch: PPO row skipped
        return None
    return PPO.load(path, device="cpu")


def strategies() -> dict:
    s = {"corrective": P.corrective, "preventive": P.preventive, "condition": P.condition,
         "ortools": P.ORToolsPlanner}
    if _ppo() is not None:
        s["ppo"] = _ppo
    return s


def run_policy(pol, seed: int) -> dict:
    """pol: a function obs->action, ORToolsPlanner class, or the _ppo loader."""
    env = MaintenanceEnv()
    obs, _ = env.reset(seed=seed)
    if pol is P.ORToolsPlanner:
        planner = P.ORToolsPlanner()
        act = planner
    elif pol is _ppo:
        model = _ppo()
        act = lambda o, step: int(model.predict(o, deterministic=True)[0])  # noqa: E731
    else:
        act = lambda o, step: pol(o)  # noqa: E731
    step, done = 0, False
    while not done:
        obs, _, done, _, info = env.step(act(obs, step))
        step += 1
    k = info["kpi"]
    return {"seed": seed, "downtime_min": k["line_down_min"], "parts_ok": k["parts_ok"],
            "parts_scrap": k["parts_scrap"], "total_cost": k["total_cost"], "profit": k["profit"],
            "interventions": k["interventions"], "invalid_actions": env.invalid_actions}
