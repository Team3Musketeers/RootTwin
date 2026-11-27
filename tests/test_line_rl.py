import numpy as np
import pytest

from roottwin.line import Line


def run(line, minutes):
    for _ in range(minutes):
        line.step(1.0)


def test_parts_flow_and_kpi():
    line = Line(seed=1)
    line.command("LINE", "create_order", {"quantity": 20})
    line.command("LINE", "start_line")
    run(line, 40)
    k = line.kpis()
    assert k["parts_ok"] == 20 and line.order_left == 0          # whole order produced, no more
    assert k["line_down_min"] == 0 and k["availability"] == 1.0


def test_jam_blocks_upstream_starves_downstream_and_repair():
    line = Line(seed=2)
    line.command("LINE", "start_line")
    run(line, 20)
    assert line.command("M3", "inject_fault", {"fault_code": "CONVEYOR_JAM"}) is None
    run(line, 10)
    st = [m.status for m in line.machines]
    assert st[2] == "down" and st[1] == "blocked" and st[3:] == ["starved"] * 3
    assert line.command("M3", "dispatch_worker", {}) is None
    assert line.command("M3", "dispatch_worker", {}) is not None   # already has a worker
    run(line, 30)
    assert all(m.status == "working" for m in line.machines) and not line.machines[2].faults
    assert line.kpi["repair_cost"] == 0 and line.kpi["interventions"] == 1


def test_skills_and_errors():
    line = Line(seed=3)
    line.command("M2", "inject_fault", {"fault_code": "MOTOR_OVERCURRENT"})   # electrician only
    assert line.required_skill(1) == "electrician"
    assert line.command("M2", "dispatch_worker", {"worker_id": "W1"}) is not None  # W1 is a mechanic
    assert line.command("M2", "dispatch_worker", {}) is None
    assert line.workers[1].task["machine"] == 1
    assert line.command("M9", "repair", {}) and line.command("M1", "inject_fault", {"fault_code": "NOPE"})


def test_snapshot_contract():
    line = Line(seed=4)
    line.command("LINE", "start_line")
    run(line, 5)
    s = line.snapshot()
    assert {"t_min", "machines", "buffers", "workers", "parts", "kpi", "order"} <= set(s)
    assert len(s["machines"]) == 6 and len(s["buffers"]) == 5 and s["parts"]


def test_env_check_and_determinism():
    pytest.importorskip("gymnasium")
    from gymnasium.utils.env_checker import check_env
    from roottwin.rl.env import MaintenanceEnv
    env = MaintenanceEnv()
    check_env(env, skip_render_check=True)
    a, _ = env.reset(seed=5)
    b, _ = MaintenanceEnv().reset(seed=5)
    assert np.allclose(a, b)


def test_baselines_and_ortools_plan():
    pytest.importorskip("ortools")
    from roottwin.rl import policies as P
    from roottwin.rl.benchmark import run_policy
    r1 = run_policy(P.corrective, 3)
    assert r1 == run_policy(P.corrective, 3)                      # same seed, same shift
    assert run_policy(P.condition, 3)["downtime_min"] >= 0
    from roottwin.rl.env import MaintenanceEnv
    obs, _ = MaintenanceEnv().reset(seed=3)
    plan = P.ORToolsPlanner().solve(obs)
    starts = sorted(plan.values())
    assert all(b - a >= 6 for a, b in zip(starts, starts[1:]))  # no two PMs overlap
