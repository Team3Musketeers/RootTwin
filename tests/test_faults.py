from pathlib import Path

import numpy as np
import pytest

from roottwin.faults import (ActiveFault, Scenario, generate_scenarios, load_catalog, load_scenario,
                             run_scenario, worst_state)
from roottwin.faults.models import families

ROOT = Path(__file__).resolve().parents[1]
NOMINAL = {"vibration": 2.0, "temperature": 45.0, "current": 12.0, "cadence": 30.0}


def test_catalog_has_11_faults_in_5_families():
    cat = load_catalog()
    assert len(cat) == 11
    assert len({f.family for f in cat.values()}) == 5 == len(families())
    for f in cat.values():
        assert f.sensors <= set(NOMINAL), f.code   # only sensors the simulation publishes


def test_bearing_wear_progression():
    f = ActiveFault(load_catalog()["BEARING_WEAR"], "M3", start_min=10)
    assert f.state(5) == "ok" and f.apply(NOMINAL, 5) == NOMINAL
    assert f.state(10 + 120 * 0.5) == "degraded"
    assert f.state(10 + 120) == "down"
    s = f.apply(NOMINAL, 130)
    assert s["vibration"] == pytest.approx(2.0 * 3.95) and s["temperature"] == pytest.approx(45 * 1.3)   # T14: CWRU-calibrated amplitude
    half = f.apply(NOMINAL, 10 + 60)["vibration"] / 2.0 - 1                                                # T14: C-MAPSS shape u^3.25
    assert half == pytest.approx(2.95 * 0.5 ** 3.25, rel=1e-6)                                              # flat first, then accelerates
    assert s["cadence"] == NOMINAL["cadence"]


def test_jam_is_sudden_and_stops_cadence():
    f = ActiveFault(load_catalog()["CONVEYOR_JAM"], "M2", start_min=0)
    s = f.apply(NOMINAL, 0.5)
    assert s["cadence"] == 0.0 and s["current"] == pytest.approx(18.0)
    assert f.state(0.5) == "degraded" and f.state(1) == "down"


def test_sensor_faults_do_not_stop_machine():
    cat = load_catalog()
    drift = ActiveFault(cat["SENSOR_DRIFT"], "M4", 0)
    assert drift.apply(NOMINAL, 180)["temperature"] == pytest.approx(60.0)
    assert drift.state(10_000) == "degraded"
    stuck = ActiveFault(cat["SENSOR_STUCK"], "M1", 0)
    first = stuck.apply({**NOMINAL, "vibration": 2.2}, 1)["vibration"]
    assert stuck.apply({**NOMINAL, "vibration": 9.9}, 50)["vibration"] == first == 2.2


def test_noise_reproducible_with_seed():
    f = ActiveFault(load_catalog()["PHASE_IMBALANCE"], "M1", 0)
    a = f.apply(NOMINAL, 30, np.random.default_rng(1))
    b = f.apply(NOMINAL, 30, np.random.default_rng(1))
    assert a == b and a["current"] != NOMINAL["current"]


def test_tool_wear_scrap_and_worst_state():
    f = ActiveFault(load_catalog()["TOOL_WEAR"], "M2", 0)
    assert f.scrap_rate(240) == pytest.approx(0.3)
    assert worst_state(["ok", "down", "degraded"]) == "down" and worst_state([]) == "ok"


@pytest.mark.parametrize("path", sorted((ROOT / "scenarios").glob("*.yaml")))
def test_scenario_files_valid(path):
    sc = load_scenario(path)
    assert sc.faults and sc.scenario_id


def test_scenario_rejects_unknown_fault_and_machine():
    with pytest.raises(ValueError):
        Scenario(scenario_id="x", duration_min=60, faults=[{"at_min": 1, "machine_id": "M1", "fault_code": "NOPE"}])
    with pytest.raises(ValueError):
        Scenario(scenario_id="x", duration_min=60,
                 faults=[{"at_min": 1, "machine_id": "M9", "fault_code": "OVERHEATING"}])


def test_generator_reproducible_and_covers_catalog():
    a = generate_scenarios(200, seed=42)
    b = generate_scenarios(200, seed=42)
    assert [s.model_dump() for s in a] == [s.model_dump() for s in b]
    assert generate_scenarios(5, seed=1)[0].model_dump() != a[0].model_dump()
    assert any(not s.faults for s in a)                       # healthy runs for false-alarm rate
    assert {f.fault_code for s in a for f in s.faults} == set(load_catalog())


def test_runner_schedules_in_scaled_time():
    sc = load_scenario(ROOT / "scenarios" / "cascade_jam_overheat.yaml")
    clock = {"t": 0.0}
    sent = []
    run_scenario(sc, lambda line, m, cmd: sent.append((line, m, cmd, clock["t"])), time_scale=60,
                 sleep=lambda s: clock.__setitem__("t", clock["t"] + s), clock=lambda: clock["t"])
    assert [(m, c.params["fault_code"], t) for _, m, c, t in sent] == [
        ("M2", "CONVEYOR_JAM", 20.0), ("M5", "OVERHEATING", 150.0)]
    assert all(c.command == "inject_fault" and c.issued_by == "scenario"
               and c.scenario_id == sc.scenario_id for _, _, c, _ in sent)
