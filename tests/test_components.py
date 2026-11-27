"""Component catalogue: ids match the 3D CAD model, codes exist, faults are localised on the right part."""
import re
from pathlib import Path

from roottwin.components import component_for, load_components, machine_components, snapshot_components
from roottwin.faults.models import load_catalog
from roottwin.line import Line

FRONT = Path(__file__).resolve().parents[1] / "frontend" / "src" / "twin" / "machines"


def test_component_ids_exist_in_3d_model():
    src = "".join(p.read_text(encoding="utf-8") for p in FRONT.glob("*.ts"))
    for mid, m in load_components().items():
        for c in m["components"]:
            templated = re.sub(r"\.s\d\.", ".s${s.n}.", c["id"])          # conveyor segments are generated in a loop
            assert f'"{c["id"]}"' in src or templated in src, f"{mid}: {c['id']} not in the CAD model"


def test_fault_codes_exist():
    catalog = load_catalog()
    for m in load_components().values():
        for c in m["components"]:
            assert set(c["faults"]) <= set(catalog), c["id"]


def test_fault_is_localised_on_its_component():
    line = Line(seed=3)
    line.command("LINE", "start_line")
    line.command("M2", "inject_fault", {"fault_code": "BEARING_WEAR"})
    for _ in range(100):
        line.step(1.0)
    assert component_for("M2", "BEARING_WEAR") == "CNC.spbrg"
    m = line.machines[1]
    comps = {c["id"]: c for c in machine_components("M2", line.sensors(1), m.faults, m.wear, line.t)}
    assert comps["CNC.spbrg"]["fault"]["code"] == "BEARING_WEAR"
    assert min(comps.values(), key=lambda c: c["health"])["id"] == "CNC.spbrg"
    assert comps["CNC.spbrg"]["channels"]["vibration"]["value"] > 1.5 * 1.6          # nominal 1.6 mm/s
    assert all(c["fault"] is None for k, c in comps.items() if k != "CNC.spbrg")


def test_snapshot_components_cover_all_machines():
    line = Line(seed=0)
    line.step(1.0)
    snap = snapshot_components(line, {m.id: line.sensors(i) for i, m in enumerate(line.machines)})
    assert set(snap) == {m.id for m in line.machines}
    assert all(0 <= c["health"] <= 100 for cs in snap.values() for c in cs)
