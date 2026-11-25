"""T12: maintenance workers as agents — skills, walking, queues, dispatch (Person A)."""
import typing

import pytest
import simpy

from roottwin.contracts import Command
from roottwin.faults import load_catalog
from roottwin.faults.models import RepairSpec
from roottwin.sim import Factory, MemorySink, load_layout
from roottwin.sim.layout import Skill

BIG = 100_000


def make(layout=None, **kw):
    sink = MemorySink()
    f = Factory(simpy.Environment(), layout, seed=0, sink=sink, **kw)
    f.create_order(BIG)
    return f, sink


def cmd(name: str, **params) -> Command:
    return Command(command=name, params=params)


def run_for(f: Factory, seconds: float) -> None:
    f.env.run(until=f.env.now + seconds)


def workers(f: Factory) -> dict:
    return {w.worker_id: w for w in f.snapshot().workers}


def test_team_covers_every_skill_of_the_catalogue():
    assert set(typing.get_args(Skill)) == set(typing.get_args(RepairSpec.model_fields["skill"].annotation))
    team = load_layout().workers
    needed = {f.repair.skill for f in load_catalog().values()} | {"mechanic"}   # + preventive maintenance
    assert needed <= {s for w in team for s in w.skills}
    assert [w.worker_id for w in team] == ["W1", "W2", "W3", "W4"]


def test_workers_start_at_the_workshop_and_machines_have_positions():
    f, _ = make()
    snap = f.snapshot()
    assert [m.x_m for m in snap.machines] == [0, 10, 20, 30, 40, 50]
    assert all(w.state == "idle" and w.x_m == -15 for w in snap.workers)
    assert snap.interventions_queued == 0


def test_repair_sends_the_qualified_worker_via_the_workshop_for_a_spare_part():
    f, s = make()
    f.apply_command("M3", cmd("inject_fault", fault_code="BEARING_WEAR", ramp_min=5))   # mechanic, replace
    run_for(f, 6 * 60)
    assert f.apply_command("M3", cmd("repair")) is None
    run_for(f, 10)
    w1 = workers(f)["W1"]
    assert w1.state == "walking" and w1.target_machine == "M3" and -15 < w1.x_m < 20
    disp = s.events("worker_dispatched", "M3")[0]["payload"]
    assert disp["worker_id"] == "W1" and disp["spare_part"] is True and disp["distance_m"] == 35
    run_for(f, 30)                                                          # 35 m / 1.2 m/s = 29 s
    w1 = workers(f)["W1"]
    assert w1.state == "working" and w1.x_m == 20 and 0 < w1.job_progress < 0.05
    assert s.events("repair_start", "M3")[0]["payload"]["worker_id"] == "W1"
    assert s.events("repair_start", "M3")[0]["payload"]["loto_required"] is True


def test_least_skilled_then_nearest_free_worker_is_sent():
    f, s = make()
    f.apply_command("M2", cmd("inject_fault", fault_code="CONVEYOR_JAM"))             # operator job
    run_for(f, 90)
    f.apply_command("M2", cmd("repair"))
    run_for(f, 1)
    assert s.events("worker_dispatched", "M2")[-1]["payload"]["worker_id"] == "W4"     # specialists stay free
    run_for(f, 15 * 60)
    f.apply_command("M6", cmd("dispatch_worker", action="inspect", worker_id="W3"))    # W3 ends at M6
    run_for(f, 10 * 60)
    f.apply_command("M4", cmd("dispatch_worker", action="inspect", worker_id="W4"))    # W4 busy at M4
    f.apply_command("M6", cmd("inject_fault", fault_code="CONVEYOR_JAM"))
    run_for(f, 90)
    f.apply_command("M6", cmd("repair"))
    run_for(f, 1)
    disp = s.events("worker_dispatched", "M6")[-1]["payload"]
    assert disp["worker_id"] == "W3" and disp["distance_m"] == 0      # 2 skills like W1/W2, but on site


def test_one_mechanic_two_mechanical_failures_make_a_queue():
    f, s = make()
    f.apply_command("M3", cmd("inject_fault", fault_code="BEARING_WEAR", ramp_min=5))
    f.apply_command("M5", cmd("inject_fault", fault_code="OVERHEATING", ramp_min=5))
    run_for(f, 6 * 60)
    assert f.apply_command("M3", cmd("repair")) is None
    assert f.apply_command("M5", cmd("repair")) is None
    run_for(f, 60)
    snap = f.snapshot()
    assert snap.interventions_queued == 1
    assert {w.worker_id: w.state for w in snap.workers} == {"W1": "working", "W2": "idle", "W3": "idle",
                                                            "W4": "idle"}
    assert s.events("intervention_queued", "M5")[0]["payload"]["skill"] == "mechanic"
    run_for(f, 50 * 60)                                                    # 45 min on M3, then M5
    second = s.events("worker_dispatched", "M5")[0]["payload"]
    assert second["worker_id"] == "W1" and second["waited_s"] > 44 * 60
    assert f.machines["M5"].state == "maintenance"
    assert f.apply_command("M5", cmd("repair")) is not None                # already planned


def test_named_worker_takes_the_job_after_the_current_one():
    f, s = make()
    f.apply_command("M3", cmd("inject_fault", fault_code="BEARING_WEAR", ramp_min=5))
    run_for(f, 6 * 60)
    f.apply_command("M3", cmd("dispatch_worker", action="repair", worker_id="W1"))
    f.apply_command("M1", cmd("dispatch_worker", action="inspect", worker_id="W1"))
    run_for(f, 60)
    assert workers(f)["W1"].queue == 1
    run_for(f, 55 * 60)
    assert s.events("inspection", "M1")[0]["payload"]["worker_id"] == "W1"


def test_unqualified_or_unknown_workers_are_refused():
    f, s = make()
    f.apply_command("M3", cmd("inject_fault", fault_code="BEARING_WEAR", ramp_min=5))
    run_for(f, 6 * 60)
    err = f.apply_command("M3", cmd("dispatch_worker", action="repair", worker_id="W4"))
    assert "not qualified" in err and "mechanic" in err
    assert "unknown worker" in f.apply_command("M3", cmd("dispatch_worker", worker_id="W9"))
    assert len(s.events("command_rejected", "M3")) == 2
    assert f.apply_command("M3", cmd("dispatch_worker", action="inspect", worker_id="W4")) is None  # anyone


def test_line_without_workers_uses_an_instant_crew():
    layout = load_layout()
    layout.workers = []
    f, s = make(layout)
    f.apply_command("M3", cmd("inject_fault", fault_code="BEARING_WEAR", ramp_min=5))
    run_for(f, 6 * 60)
    assert f.apply_command("M3", cmd("repair")) is None
    run_for(f, 1)
    assert f.machines["M3"].state == "maintenance"                         # no walking
    assert f.snapshot().workers == []
    assert "no workers" in f.apply_command("M2", cmd("dispatch_worker", worker_id="W1"))


@pytest.mark.parametrize("action", ["repair", "replace", "preventive_maintenance"])
def test_every_repair_action_ends_with_the_machine_back_to_ok(action):
    f, s = make()
    f.apply_command("M2", cmd("inject_fault", fault_code="MOTOR_OVERCURRENT", ramp_min=5))   # electrician
    run_for(f, 6 * 60)
    assert f.apply_command("M2", cmd("dispatch_worker", action=action)) is None
    run_for(f, 1)
    sent = s.events("worker_dispatched", "M2")[0]["payload"]["worker_id"]
    assert sent == ("W1" if action == "preventive_maintenance" else "W2")  # PM: mechanic; fault: electrician
    run_for(f, 90 * 60)
    assert f.machines["M2"].state == "ok" and f.machines["M2"].faults == []
    assert s.events("repair_end", "M2")[0]["payload"]["action"] == action
