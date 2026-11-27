import pytest

pytest.importorskip("shap")
from roottwin.line import Line  # noqa: E402
from roottwin.live_detector import LiveDetector, train  # noqa: E402


@pytest.fixture(scope="module")
def trained():
    return train(minutes=720)


def run(trained, fault, minutes=260):
    live = LiveDetector(*trained, [f"M{i}" for i in range(1, 7)])
    line = Line(seed=5)
    line.command("LINE", "start_line")
    out, down = [], None
    for t in range(minutes):
        if t == 100 and fault:
            line.command("M3", "inject_fault", {"fault_code": fault})
        line.step(1.0)
        if down is None and line.machines[2].status == "down":
            down = t
        for i, m in enumerate(line.machines):
            a = live.on_telemetry(m.id, line.sensors(i))
            if a:
                out.append((t, m.id, a))
    return out, down


def test_no_alarm_on_healthy_line_including_startup(trained):
    out, _ = run(trained, None)
    assert out == []


def test_bearing_wear_alarm_before_stop_with_root_cause(trained):
    out, down = run(trained, "BEARING_WEAR")
    first_t, first_m, a = out[0]
    assert first_m == "M3" and first_t < down
    assert all(x[2]["payload"]["root_cause"] == "M3" for x in out)
    assert a["payload"]["copilot"]["sources"] and a["payload"]["explanation"].startswith("Alert on M3")
