"""T27 - Play mode: the user runs the maintenance of a shift; score compared to the AI.

Same environment, same seed, same commands as the PPO agent and the baselines.
Safety: an intervention on a machine whose procedure needs lockout/tagout is
refused unless the player confirms the LOTO checklist (and is counted).

    POST /play/new {"seed": 7}                 -> session id + state
    POST /play/{sid}/step {"action": 3, "loto_confirmed": true}
    GET  /play/{sid}                           -> state (with AI scores once the shift is over)
"""
from __future__ import annotations

import uuid
from functools import lru_cache

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from roottwin.rl.env import N, MaintenanceEnv

router = APIRouter(prefix="/play", tags=["play"])
SAFETY_PENALTY = 500.0          # EUR deducted from the score per skipped LOTO attempt
MAX_SESSIONS = 200
_sessions: dict[str, dict] = {}


class NewGame(BaseModel):
    seed: int = Field(default=7, ge=0, le=10_000)


class Step(BaseModel):
    action: int = Field(ge=0, le=2 * N)
    loto_confirmed: bool = False


def _needs_loto(env: MaintenanceEnv, action: int) -> bool:
    if action == 0:
        return False
    m = env.line.machines[(action - 1) % N]
    if action > N:
        return True                                     # preventive maintenance: always locked out
    return bool(m.faults) and m.faults[-1].spec.repair.loto_required


def _state(sid: str) -> dict:
    g = _sessions[sid]
    env: MaintenanceEnv = g["env"]
    k = env.line.kpis()
    snap = env.line.snapshot()
    if not g["done"]:                    # the player sees what the AI sees: no hidden fault labels
        for m in snap["machines"]:
            m["faults"], m["state"] = [], "ok"
    out = {"session": sid, "seed": g["seed"], "step": g["step"], "done": g["done"], "snapshot": snap,
           "sensors": [{s: round(v, 2) for s, v in env._means[i].items()} for i in range(N)],
           "score": round(k["profit"] - SAFETY_PENALTY * g["safety_violations"], 0),
           "safety_violations": g["safety_violations"], "last_message": g["msg"],
           "loto_required": [_needs_loto(env, a) for a in range(2 * N + 1)]}
    if g["done"]:
        out["ai"] = ai_scores(g["seed"])
    return out


@lru_cache(maxsize=64)
def ai_scores(seed: int) -> dict:
    """Profit of each strategy on the same shift (PPO if a trained model exists)."""
    from roottwin.rl.benchmark import run_policy, strategies
    return {name: run_policy(pol, seed)["profit"] for name, pol in strategies().items()}


@router.post("/new")
def new(req: NewGame) -> dict:
    if len(_sessions) >= MAX_SESSIONS:
        _sessions.pop(next(iter(_sessions)))
    env = MaintenanceEnv()
    env.reset(seed=req.seed)
    sid = uuid.uuid4().hex[:12]
    _sessions[sid] = {"env": env, "seed": req.seed, "step": 0, "done": False, "safety_violations": 0, "msg": ""}
    return _state(sid)


@router.post("/{sid}/step")
def step(sid: str, req: Step) -> dict:
    g = _sessions.get(sid)
    if g is None:
        raise HTTPException(404, "unknown session")
    if g["done"]:
        return _state(sid)
    env: MaintenanceEnv = g["env"]
    action, msg = req.action, ""
    if _needs_loto(env, action) and not req.loto_confirmed:
        g["safety_violations"] += 1
        action, msg = 0, "Refused: lockout/tagout not confirmed. Lock the machine out before working on it."
    _, _, done, _, info = env.step(action)
    if info["error"] and not msg:
        msg = info["error"]
    g.update(step=g["step"] + 1, done=done, msg=msg)
    return _state(sid)


@router.get("/{sid}")
def get(sid: str) -> dict:
    if sid not in _sessions:
        raise HTTPException(404, "unknown session")
    return _state(sid)
