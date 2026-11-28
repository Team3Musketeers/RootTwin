"""T15 + T19: learn the Bayesian networks and compare root-cause methods on held-out simulated scenarios.

    python scripts/eval_diagnosis.py            # -> roottwin/diagnosis/params.json + reports/diagnosis.json

Factory level: the line engine runs N scenarios (one fault injected on a random machine, or none); after the fault
develops, each machine's readings are discretised into symptoms. A detector would alarm on every abnormal or idle
machine, so propagation victims (starved / blocked machines) are in the alarm set too. Methods compared on the
test split: the old shortcut (most upstream non-idle alarm), the T15 propagation graph, the T19 Bayesian network.
Machine level: the fault family is inferred from the symptoms of one machine (sim_v0 dataset, split by scenario).
"""
from __future__ import annotations

import json
from collections import Counter
from pathlib import Path

import numpy as np
import pandas as pd

from roottwin.diagnosis.bayes import MACHINE_SYMPTOMS, PARAMS, BayesNet, factory_evidence
from roottwin.diagnosis.graph import diagnose, line_graph
from roottwin.diagnosis.symptoms import abnormal, symptoms
from roottwin.faults.models import load_catalog
from roottwin.line import Line
from roottwin.tracking import log_run

ROOT = Path(__file__).resolve().parents[1]
FAMILIES = ["none", "mechanical", "electrical", "thermal", "sensor", "process"]


def factory_scenarios(n: int, seed0: int = 0) -> list[tuple[str, dict[str, dict[str, bool]]]]:
    catalog = load_catalog()
    codes = sorted(catalog)
    out = []
    rng = np.random.default_rng(seed0)
    for k in range(n):
        line = Line(seed=seed0 + k)
        line.command("LINE", "start_line")
        for _ in range(25):                                           # fill the buffers
            line.step(1.0)
        root = "none"
        if rng.random() > 0.15:
            i = int(rng.integers(0, len(line.machines)))
            root = line.machines[i].id
            line.command(root, "inject_fault", {"fault_code": codes[int(rng.integers(0, len(codes)))], "ramp_min": 20})
        for _ in range(45):
            line.step(1.0)
        readings = {m.id: [] for m in line.machines}
        for _ in range(5):                                            # average 5 minutes, like the detector window
            line.step(1.0)
            for i, m in enumerate(line.machines):
                readings[m.id].append(line.sensors(i))
        sym = {m: symptoms({s: float(np.mean([r[s] for r in rs])) for s in rs[0]}) for m, rs in readings.items()}
        out.append((root, sym))
    return out


def shortcut(order: list[str], alarmed: set[str], sym: dict) -> str | None:
    causes = [m for m in order if m in alarmed and not sym[m]["idle"]]
    return causes[0] if causes else (min(alarmed, key=order.index) if alarmed else None)


def main():
    data = factory_scenarios(700)
    train, test = data[:500], data[500:]
    machines = [f"M{i + 1}" for i in range(6)]
    states = ["none", *machines]
    children = [f"{k}_{m}" for m in machines for k in ("abnormal", "idle")]
    factory = BayesNet.fit(states, children, [(r, factory_evidence(s)) for r, s in train])

    g = line_graph(machines)
    hits = Counter()
    for root, sym in test:
        alarmed = {m for m in machines if abnormal(sym[m]) or sym[m]["idle"]}
        truth = root if root != "none" else None
        post = factory.posterior(factory_evidence(sym))
        bayes = max(post, key=post.get)
        hits["shortcut"] += shortcut(machines, alarmed, sym) == truth
        hits["graph"] += diagnose(g, alarmed, sym).root == truth
        hits["bayes"] += (bayes if bayes != "none" else None) == truth
        hits["n"] += 1
        hits["multi_alarm"] += len(alarmed) > 1
    n = hits["n"]

    # machine level: fault family from one machine's symptoms (sim_v0, split by scenario)
    sim = pd.read_parquet(ROOT / "data" / "processed" / "sim_v0.parquet")
    catalog = load_catalog()
    sim["family"] = [catalog[c].family if isinstance(c, str) and lab else "none" for c, lab in zip(sim.fault_code, sim.label)]
    rows = sim[(sim.label == 1) | (sim.index % 20 == 0)]                 # every fault row + 5 % of healthy rows
    split = rows.scenario_id.isin(sorted(rows.scenario_id.unique())[:160])

    def ev(r):
        return {k: v for k, v in symptoms({"vibration": r.vibration_mean, "temperature": r.temperature_mean,
                                           "current": r.current_mean, "cadence": r.cadence_mean}).items() if k in MACHINE_SYMPTOMS}
    machine_net = BayesNet.fit(FAMILIES, MACHINE_SYMPTOMS, [(r.family, ev(r)) for r in rows[split].itertuples()])
    test_rows = rows[~split]
    pred = [max((p := machine_net.posterior(ev(r))), key=p.get) for r in test_rows.itertuples()]
    fam_acc = float(np.mean(np.array(pred) == test_rows.family.to_numpy()))
    majority = float((test_rows.family == test_rows.family.mode()[0]).mean())

    PARAMS.write_text(json.dumps({"machine": machine_net.to_dict(), "factory": factory.to_dict()}, indent=1), encoding="utf-8")
    report = {
        "factory_root_cause": {"test_scenarios": n, "with_several_alarms": hits["multi_alarm"],
                               "accuracy": {k: round(hits[k] / n, 3) for k in ("shortcut", "graph", "bayes")}},
        "machine_fault_family": {"test_rows": len(test_rows), "accuracy": round(fam_acc, 3), "majority_baseline": round(majority, 3)},
    }
    (ROOT / "reports" / "diagnosis.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    log_run("diagnosis", {"factory_scenarios": len(data), "train": len(train)}, report)
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
