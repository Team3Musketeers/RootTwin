"""T19 - Bayesian network diagnosis, machine level and factory level (exact inference, numpy only).

Machine level:  Family -> {vib_high, temp_high, current_high, slow}
    P(family | symptoms) for family in {none, mechanical, electrical, thermal, sensor, process}.
Factory level:  Root -> {abnormal_j, idle_j} for every machine j
    P(root | evidence) for root in {none, M1..M6}; the CPTs encode propagation learned from simulated
    scenarios (a failing M3 makes M4-M6 idle, M1-M2 blocked...), so the network learns what T15 hard-codes.

Both are discrete networks small enough for exact enumeration; CPTs are maximum-likelihood counts with
Laplace smoothing, learned by scripts/eval_diagnosis.py and saved in params.json next to this file.
shortcut: hand-written enumeration instead of pgmpy (pgmpy pulls in PyTorch); swap in pgmpy.BayesianNetwork
with the same CPTs if a richer structure (shared causes, sensor nodes) is needed.
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np

PARAMS = Path(__file__).with_name("params.json")
MACHINE_SYMPTOMS = ["vib_high", "temp_high", "current_high", "slow"]


class BayesNet:
    """Root -> independent binary children. P(root | e) ∝ P(root) Π_k P(e_k | root)."""

    def __init__(self, states: list[str], children: list[str], prior: np.ndarray, cpt: np.ndarray):
        self.states, self.children, self.prior, self.cpt = states, children, prior, cpt   # cpt[s, k] = P(child_k = 1 | s)

    @classmethod
    def fit(cls, states: list[str], children: list[str], rows: list[tuple[str, dict[str, bool]]], alpha: float = 1.0) -> "BayesNet":
        n = np.full(len(states), alpha)
        ones = np.full((len(states), len(children)), alpha)
        for s, ev in rows:
            i = states.index(s)
            n[i] += 1
            ones[i] += [bool(ev[c]) for c in children]
        return cls(states, children, n / n.sum(), ones / (n[:, None] + alpha))

    def posterior(self, evidence: dict[str, bool]) -> dict[str, float]:
        logp = np.log(self.prior).copy()
        for k, c in enumerate(self.children):
            if c in evidence:
                p = self.cpt[:, k]
                logp += np.log(p if evidence[c] else 1 - p)
        p = np.exp(logp - logp.max())
        p /= p.sum()
        return {s: float(v) for s, v in zip(self.states, p)}

    def to_dict(self) -> dict:
        return {"states": self.states, "children": self.children, "prior": self.prior.tolist(), "cpt": self.cpt.tolist()}

    @classmethod
    def from_dict(cls, d: dict) -> "BayesNet":
        return cls(d["states"], d["children"], np.array(d["prior"]), np.array(d["cpt"]))


def factory_evidence(symptoms: dict[str, dict[str, bool]]) -> dict[str, bool]:
    """Flatten per-machine symptoms into the factory network's children (abnormal_Mi, idle_Mi)."""
    from roottwin.diagnosis.symptoms import abnormal
    ev = {}
    for m, s in symptoms.items():
        ev[f"abnormal_{m}"] = abnormal(s)
        ev[f"idle_{m}"] = s["idle"]
    return ev


_cache: dict[str, BayesNet] | None = None


def load() -> dict[str, BayesNet] | None:
    """{"machine": BayesNet, "factory": BayesNet} from params.json, or None if not trained yet."""
    global _cache
    if _cache is None and PARAMS.exists():
        d = json.loads(PARAMS.read_text(encoding="utf-8"))
        _cache = {k: BayesNet.from_dict(v) for k, v in d.items()}
    return _cache
