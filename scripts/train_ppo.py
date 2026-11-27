"""T21 - train a PPO agent (Stable-Baselines3) on the maintenance environment.

    python scripts/train_ppo.py --steps 400000     # ~15-30 min on CPU
-> models/ppo_maintenance.zip (best on validation seeds), reports/ppo_training.json, reports/figures/ppo_learning_curve.png

Seeds: training uses random seeds >= 10_000; validation 1_000-1_011; the T28
benchmark uses 0-99, never seen during training or model selection.
"""
from __future__ import annotations

import argparse
import json

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from stable_baselines3 import PPO
from stable_baselines3.common.callbacks import BaseCallback
from stable_baselines3.common.vec_env import SubprocVecEnv

from roottwin.detection import MODELS, REPORTS
from roottwin.rl.env import MaintenanceEnv

VAL_SEEDS = range(1000, 1012)


def evaluate(model, seeds=VAL_SEEDS) -> dict:
    env = MaintenanceEnv()
    rewards, down = [], []
    for s in seeds:
        o, _ = env.reset(seed=s)
        tot, done = 0.0, False
        while not done:
            a, _ = model.predict(o, deterministic=True)
            o, r, done, _, info = env.step(int(a))
            tot += r
        rewards.append(tot)
        down.append(info["kpi"]["line_down_min"])
    return {"reward": float(np.mean(rewards)), "downtime_min": float(np.mean(down))}


class ValCallback(BaseCallback):
    def __init__(self, every: int):
        super().__init__()
        self.every, self.best, self.curve = every, -np.inf, []

    _offset = 0

    def _on_step(self) -> bool:
        # with --resume, num_timesteps continues from the saved model: compare against points made in THIS run
        if self.num_timesteps // self.every > len([c for c in self.curve if c["steps"] > self._offset]) + \
                self._offset // self.every:
            r = evaluate(self.model)
            self.curve.append({"steps": self.num_timesteps, **r})
            print(f"  {self.num_timesteps:>8} steps  val reward {r['reward']:7.2f}  downtime {r['downtime_min']:6.1f} min",
                  flush=True)
            if r["reward"] > self.best:
                self.best = r["reward"]
                self.model.save(MODELS / "ppo_maintenance")
        return True


def make_env(rank: int):
    def f():
        env = MaintenanceEnv()
        env.reset(seed=10_000 + rank * 100_000)
        return env
    return f


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--steps", type=int, default=400_000)
    p.add_argument("--envs", type=int, default=8)
    p.add_argument("--resume", action="store_true", help="continue training models/ppo_maintenance.zip")
    a = p.parse_args()
    MODELS.mkdir(exist_ok=True)
    venv = SubprocVecEnv([make_env(i) for i in range(a.envs)])
    path = MODELS / "ppo_maintenance.zip"
    if a.resume and path.exists():
        model = PPO.load(path, env=venv, device="cpu")
    else:
        model = PPO("MlpPolicy", venv, n_steps=384, batch_size=768, n_epochs=10, learning_rate=3e-4, gamma=0.995,
                    gae_lambda=0.95, ent_coef=0.01, policy_kwargs={"net_arch": [128, 128]}, seed=0, verbose=0)
    cb = ValCallback(every=max(a.steps // 10, 10_000))
    if a.resume and path.exists():
        cb.best = evaluate(model)["reward"]          # only overwrite the saved model if training improves it
        cb.curve = json.loads((REPORTS / "ppo_training.json").read_text())["curve"] \
            if (REPORTS / "ppo_training.json").exists() else []
        offset = cb.curve[-1]["steps"] if cb.curve else 0
        cb.every, cb._offset = cb.every, offset
    model.learn(total_timesteps=a.steps, callback=cb, reset_num_timesteps=not a.resume)
    venv.close()
    (REPORTS / "ppo_training.json").write_text(json.dumps({"curve": cb.curve, "best_val_reward": cb.best},
                                                          indent=1), encoding="utf-8")
    fig, ax = plt.subplots(figsize=(7, 3.5))
    ax.plot([c["steps"] for c in cb.curve], [c["reward"] for c in cb.curve], marker="o")
    ax.set_xlabel("training steps"); ax.set_ylabel("mean validation reward (k EUR / shift)")
    ax.set_title("PPO learning curve (12 validation shifts)")
    fig.tight_layout(); fig.savefig(REPORTS / "figures" / "ppo_learning_curve.png", dpi=110)
    print(f"best validation reward {cb.best:.2f} -> {MODELS / 'ppo_maintenance.zip'}")


if __name__ == "__main__":
    main()
