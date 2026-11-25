"""T12: dataset v1 — rows for TimescaleDB and the labelled frame (Person A). No database needed."""
import csv
import io
from datetime import timedelta
from pathlib import Path

from roottwin.contracts import COLUMNS
from roottwin.faults import generate_scenarios, load_scenario
from roottwin.sim.dataset import DATASET_T0, INTERVENTION_COLUMNS, run_one, scenario_start
from roottwin.sim.runner import simulate_many

ROOT = Path(__file__).resolve().parents[1]


def rows(text: str) -> list[list[str]]:
    return list(csv.reader(io.StringIO(text)))


def test_scenario_rows_for_every_table():
    sc = load_scenario(ROOT / "scenarios/cascade_jam_overheat.yaml")
    df, tables = run_one((sc, 3, {}))
    readings = rows(tables["sensor_readings"])
    assert len(readings) == 300 * 6 * 4 and all(len(r) == len(COLUMNS["sensor_readings"]) for r in readings)
    assert {r[2] for r in readings} == {"vibration", "temperature", "current", "cadence"}
    assert {r[5] for r in readings} == {sc.scenario_id}
    assert readings[0][0].startswith(scenario_start(3).date().isoformat())          # its own day
    events = rows(tables["events"])
    types = {r[2] for r in events}
    assert {"fault_injected", "failure", "worker_dispatched", "repair_start", "repair_end"} <= types
    production = rows(tables["production"])
    assert production and all(len(r) == len(COLUMNS["production"]) for r in production)
    # corrective repairs become interventions (MTTR): the jam on M2 (10 min) and the overheating on M5
    inter = rows(tables["interventions"])
    assert all(len(r) == len(INTERVENTION_COLUMNS) for r in inter)
    by_machine = {r[2]: r for r in inter}
    assert by_machine["M2"][4] == "repair" and by_machine["M2"][5] == "CONVEYOR_JAM"
    assert by_machine["M2"][6] == "corrective" and by_machine["M2"][3] == "W4"   # jam: the operator
    assert by_machine["M5"][3] == "W1"                                             # overheating: mechanic
    assert "time" in df.columns and df["time"].min() == scenario_start(3) + timedelta(minutes=1)


def test_each_scenario_gets_its_own_day_in_frames_too():
    df = simulate_many(generate_scenarios(2, seed=5, duration_min=30))
    days = df.groupby("scenario_id")["time"].min().sort_values()
    assert list(days.dt.date) == [DATASET_T0.date(), (DATASET_T0 + timedelta(days=1)).date()]
