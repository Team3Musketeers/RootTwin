"""T15 - dependency graph + causal propagation: find the root cause among simultaneous alarms.

The line is a directed graph of material flow M1 -> M2 -> ... -> M6 (buffers between machines). A machine that
fails propagates two ways: it *starves* every machine downstream (no parts arrive) and, once the buffers fill,
*blocks* the machines upstream. Those machines look abnormal to a detector (cadence drops to 0) but are healthy.

For each alarmed candidate we compute which other alarms its failure explains along the graph, and rank:
    score = explained alarms + 2 if the candidate shows an intrinsic anomaly (vibration, heat, current), + 0.5 if only slow
            - 0.5 if the candidate is merely idle (idle machines are usually victims, not causes)
            - 0.01 * position (tie-break: upstream first, faults propagate faster downstream)
The best candidate is the root; the path is the chain of graph edges from the root to every explained alarm.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import networkx as nx

from roottwin.diagnosis.symptoms import abnormal


def intrinsic(s: dict[str, bool]) -> bool:
    """Physical anomaly of the machine itself; a cadence drop alone is what starved / blocked victims show too."""
    return s["vib_high"] or s["temp_high"] or s["current_high"]


def line_graph(machines: list[str]) -> nx.DiGraph:
    g = nx.DiGraph()
    g.add_nodes_from(machines)
    for a, b in zip(machines, machines[1:]):
        g.add_edge(a, b, kind="material")
    return g


@dataclass
class Diagnosis:
    root: str | None
    explained: list[str] = field(default_factory=list)            # alarms that are consequences of the root
    path: list[tuple[str, str]] = field(default_factory=list)     # graph edges the failure travels along
    ranking: list[tuple[str, float]] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {"root": self.root, "explained": self.explained, "path": [list(e) for e in self.path],
                "ranking": [[m, round(s, 2)] for m, s in self.ranking]}


def diagnose(g: nx.DiGraph, alarmed: set[str], symptoms: dict[str, dict[str, bool]]) -> Diagnosis:
    """alarmed: machines in alarm; symptoms: discretised symptoms per machine (roottwin.diagnosis.symptoms)."""
    if not alarmed:
        return Diagnosis(root=None)
    order = list(nx.topological_sort(g))
    scores, expl = {}, {}
    for c in alarmed:
        down, up = nx.descendants(g, c), nx.ancestors(g, c)
        # downstream alarms are explained if idle/slow (starved); upstream ones if idle (blocked)
        # downstream alarms are explained if starved (idle / slowing), upstream ones if blocked (idle / slowing)
        ex = [m for m in alarmed - {c} if (m in down or m in up) and (symptoms[m]["idle"] or symptoms[m]["slow"]) and not intrinsic(symptoms[m])]
        s = (len(ex) + (2.0 if intrinsic(symptoms[c]) else 0.5 if symptoms[c]["slow"] else 0.0)
             - (0.5 if symptoms[c]["idle"] and not abnormal(symptoms[c]) else 0.0) - 0.01 * order.index(c))
        scores[c], expl[c] = s, ex
    ranking = sorted(scores.items(), key=lambda kv: -kv[1])
    root = ranking[0][0]
    path = []
    for m in expl[root]:
        p = nx.shortest_path(g, root, m) if nx.has_path(g, root, m) else list(reversed(nx.shortest_path(g, m, root)))
        path += [(a, b) for a, b in zip(p, p[1:]) if (a, b) not in path]
    return Diagnosis(root=root, explained=sorted(expl[root], key=order.index), path=path, ranking=ranking)
