"""Component-level digital twin: locate each fault on the physical component that carries it.

The line engine measures 4 sensors per machine (vibration, temperature, current, cadence).
This module turns those readings into per-component channels using faults/components.yaml:
healthy components follow the machine's nominal behaviour, the faulted component gets the
full fault signature. The 3D twin reads `components` from the snapshot to colour the exact
part red and show live component telemetry; the dataset generator uses the same mapping
to label rows with the root-cause component.
"""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path

import numpy as np
import yaml

from roottwin.faults.models import ActiveFault

COMPONENTS_PATH = Path(__file__).parent / "faults" / "components.yaml"
NOMINAL = {"vibration": 2.0, "temperature": 45.0, "current": 12.0, "cadence": 30.0}   # same as roottwin.line.NOMINAL


@lru_cache(maxsize=2)
def load_components(path: str = str(COMPONENTS_PATH)) -> dict[str, dict]:
    """backend machine id -> {asset, type, name, components: [...]}"""
    data = yaml.safe_load(Path(path).read_text(encoding="utf-8"))["machines"]
    for mid, m in data.items():
        if not m.get("components"):
            raise ValueError(f"{mid}: no components")
        for c in m["components"]:
            for ch, spec in c["channels"].items():
                if len(spec) != 3 or spec[0] not in NOMINAL:
                    raise ValueError(f"{mid}/{c['id']}/{ch}: channel must be [machine sensor, nominal, unit]")
    return data


def component_for(machine_id: str, fault_code: str) -> str | None:
    """Component id that carries `fault_code` on this machine (first listed wins, else the first component)."""
    m = load_components().get(machine_id)
    if not m:
        return None
    return next((c["id"] for c in m["components"] if fault_code in c["faults"]), m["components"][0]["id"])


def _health(wear: float, faults: list[ActiveFault], t: float) -> float:
    p = max((f.progress(t) for f in faults), default=0.0)
    return round(max(0.0, 100.0 * (1 - 0.3 * wear) * (1 - 0.9 * p)), 1)


def machine_components(machine_id: str, sensors: dict[str, float], faults: list[ActiveFault],
                       wear: float, t: float, rng: np.random.Generator | None = None) -> list[dict]:
    """Per-component state for one machine. `sensors` are the machine readings (fault signatures included)."""
    m = load_components().get(machine_id)
    if not m:
        return []
    by_comp: dict[str, list[ActiveFault]] = {}
    for f in faults:
        by_comp.setdefault(component_for(machine_id, f.code), []).append(f)
    out = []
    for c in m["components"]:
        mine = by_comp.get(c["id"], [])
        # healthy components see the nominal level scaled by speed/load, not the other component's fault
        healthy = {s: NOMINAL[s] * (rng.normal(1, 0.03) if rng is not None else 1.0) for s in NOMINAL}
        if sensors:
            healthy["cadence"] = sensors.get("cadence", NOMINAL["cadence"])
        src = sensors if mine else healthy
        ch = {}
        for name, (sensor, nominal, unit) in c["channels"].items():
            ratio = (src.get(sensor, NOMINAL[sensor]) / NOMINAL[sensor]) if NOMINAL[sensor] else 1.0
            ch[name] = {"value": round(nominal * ratio, 3), "unit": unit}
        worst = max(mine, key=lambda f: f.progress(t), default=None)
        out.append({"id": c["id"], "name": c["name"], "kind": c["kind"], "channels": ch,
                    "health": _health(wear, mine, t),
                    "fault": None if worst is None else {"code": worst.code, "state": worst.state(t),
                                                         "progress": round(worst.progress(t), 3)}})
    return out


def snapshot_components(line, sensors: dict[str, dict]) -> dict[str, list[dict]]:
    """{machine id: [component state]} for every machine of a roottwin.line.Line."""
    return {m.id: machine_components(m.id, sensors.get(m.id, {}), m.faults, m.wear, line.t) for m in line.machines}
