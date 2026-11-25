"""Live runner (simpy.rt + commands) and offline dataset generation (Person A)."""
from pathlib import Path
from types import SimpleNamespace

import pandas as pd
import pytest

from roottwin.contracts import LINE_TARGET, Command
from roottwin.faults import generate_scenarios, load_scenario
from roottwin.faults.offline import simulate as offline_simulate
from roottwin.sim import Factory, LiveRunner, MemorySink, ScalableRealtimeEnvironment, simulate_many, \
    simulate_scenario

ROOT = Path(__file__).resolve().parents[1]


# ---------------------------------------------------------------- offline dataset
def test_dataset_is_a_drop_in_for_the_offline_stand_in():
    sc = load_scenario(ROOT / "scenarios/cascade_jam_overheat.yaml")
    df = simulate_scenario(sc)
    assert set(offline_simulate(sc).columns) <= set(df.columns)
    assert len(df) == 6 * 300 and df["scenario_id"].unique().tolist() == [sc.scenario_id]

    at = lambda t, m: df[(df.t_min == t) & (df.machine_id == m)].iloc[0]   # noqa: E731
    # jam on M2 at 20 min: M2 down, M3..M6 starved (cadence 0) but NOT faulty -> label 0
    assert at(25, "M2").state == "down" and at(25, "M2").label == 1
    for m in ("M3", "M4", "M5", "M6"):
        row = at(25, m)
        assert row.cadence == 0 and row.label == 0 and row.state == "ok" and row.activity == "starved"
    assert at(25, "M1").activity == "blocked"
    # corrective repair: 10 min response + 10 min jam repair -> back to ok, label back to 0
    assert at(35, "M2").state == "maintenance"
    assert at(45, "M2").state == "ok" and at(45, "M2").label == 0
    # independent overheating on M5 at 150 min
    assert at(149, "M5").label == 0 and at(151, "M5").label == 1 and at(151, "M5").fault_code == "OVERHEATING"


def test_generated_datasets_are_reproducible():
    scenarios = generate_scenarios(3, seed=1, duration_min=90)
    a = simulate_many(scenarios)
    b = simulate_many(scenarios)
    pd.testing.assert_frame_equal(a, b)
    assert a["scenario_id"].nunique() == 3


def test_parallel_generation_matches_serial():
    scenarios = generate_scenarios(2, seed=4, duration_min=60)
    pd.testing.assert_frame_equal(simulate_many(scenarios, jobs=2), simulate_many(scenarios))


# ---------------------------------------------------------------- live runner
def live(scale: float = 600.0):
    env = ScalableRealtimeEnvironment(scale)
    sink = MemorySink()
    f = Factory(env, seed=0, sink=sink, wall_clock=True)
    return LiveRunner(f, env, snapshot_hz=10), f, env, sink


def line_cmd(name: str, **params) -> Command:
    return Command(command=name, params=params)


def test_live_runner_runs_in_scaled_real_time():
    r, f, env, sink = live(600)
    r.submit(LINE_TARGET, line_cmd("create_order", quantity=50))
    r.run(seconds=0.5)
    assert 150 <= env.now <= 450                       # ~0.5 s x 600
    assert f.released > 0 and f.time_scale == 600
    snaps = sink.of_kind("snapshot", LINE_TARGET)
    assert len(snaps) >= 3 and [s["seq"] for s in snaps] == sorted(s["seq"] for s in snaps)
    assert r.applied == [(LINE_TARGET, "create_order", None)]


def test_pause_freezes_the_clock_and_time_scale_changes_speed():
    r, f, env, _ = live(600)
    r.submit(LINE_TARGET, line_cmd("pause_line"))
    r.run(seconds=0.2)
    frozen = env.now
    r.run(seconds=0.3)
    assert env.now == frozen and f.status == "paused"
    r.submit(LINE_TARGET, line_cmd("set_time_scale", scale=60))
    r.submit(LINE_TARGET, line_cmd("start_line"))
    r.run(seconds=0.5)
    assert env.time_scale == pytest.approx(60) and f.time_scale == 60
    assert 10 <= env.now - frozen <= 45                # ~0.5 s x 60, no catch-up burst after the pause


def test_mqtt_messages_are_parsed_and_queued():
    r, f, env, _ = live()
    msg = lambda topic, payload: SimpleNamespace(topic=topic, payload=payload)   # noqa: E731
    r.on_mqtt_message(None, None, msg("factory/line1/M3/cmd", line_cmd("stop_machine").model_dump_json()))
    r.on_mqtt_message(None, None, msg("factory/line1/M3/cmd", b'{"command": "fly"}'))          # invalid
    r.on_mqtt_message(None, None, msg("factory/line2/M3/cmd", line_cmd("stop_machine").model_dump_json()))
    assert r.commands.qsize() == 1
    r.run(seconds=0.15)
    assert f.machines["M3"].stopped and r.applied == [("M3", "stop_machine", None)]
