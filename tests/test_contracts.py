import json

import pytest
from pydantic import ValidationError

from roottwin.contracts import COLUMNS, Command, command_topic, to_rows


def test_telemetry_one_row_per_sensor():
    msg = json.dumps({"ts": "2026-11-24T10:00:00Z", "sensors": {"vibration": 2.1, "temperature": 47}})
    table, rows, t = to_rows("factory/line1/M2/telemetry", msg)
    assert table == "sensor_readings"
    assert t.machine_id == "M2" and t.line_id == "line1"
    assert {r[2] for r in rows} == {"vibration", "temperature"}
    assert all(len(r) == len(COLUMNS[table]) for r in rows)
    assert rows[0][0].tzinfo is not None


def test_epoch_and_naive_ts_become_utc():
    _, rows, _ = to_rows("factory/line1/M1/telemetry", '{"ts": 1795000000, "sensors": {"current": 1}}')
    assert rows[0][0].utcoffset().total_seconds() == 0
    _, rows, _ = to_rows("factory/line1/M1/telemetry", '{"ts": "2026-11-24T10:00:00", "sensors": {"current": 1}}')
    assert rows[0][0].utcoffset().total_seconds() == 0


def test_event_and_production():
    table, rows, _ = to_rows("factory/line1/M3/event",
                             '{"event_type": "state_change", "state": "down", "severity": 5}')
    assert table == "events" and rows[0][3] == "down" and rows[0][-1] == {}
    table, rows, _ = to_rows("factory/line1/M3/production", '{"parts_ok": 3}')
    assert table == "production" and rows[0][2:4] == (3, 0)


@pytest.mark.parametrize("topic,payload", [
    ("factory/line1/M1/unknown", '{"sensors": {"a": 1}}'),
    ("other/line1/M1/telemetry", '{"sensors": {"a": 1}}'),
    ("factory/M1/telemetry", '{"sensors": {"a": 1}}'),
    ("factory/line1//telemetry", '{"sensors": {"a": 1}}'),
    ("factory/line1/LINE/telemetry", '{"sensors": {"a": 1}}'),
    ("factory/line1/M1/telemetry", '{"sensors": {}}'),
    ("factory/line1/M1/telemetry", "not json"),
    ("factory/line1/M1/event", '{"event_type": "x", "severity": 9}'),
    ("factory/line1/M1/event", '{"event_type": "x", "state": "purple"}'),
    ("factory/line1/M1/production", '{"parts_ok": -1}'),
])
def test_invalid_messages_rejected(topic, payload):
    with pytest.raises((ValueError, ValidationError)):
        to_rows(topic, payload)


# ---- commands (T33) ----------------------------------------------------------

def test_command_logged_as_event():
    cmd = Command(command="inject_fault", params={"fault_code": "BEARING_WEAR"}, issued_by="scenario",
                  scenario_id="S1")
    table, rows, t = to_rows("factory/line1/M3/cmd", cmd.model_dump_json())
    assert table == "events"
    time, machine, etype, state, fault, sev, source, scen, payload = rows[0]
    assert (machine, etype, fault, source, scen) == ("M3", "command", "BEARING_WEAR", "scenario", "S1")
    assert payload["command"] == "inject_fault" and payload["command_id"] == cmd.command_id


def test_line_command_on_line_target():
    cmd = Command(command="create_order", params={"quantity": 500})
    assert cmd.params["product"] == "A" and cmd.params["order_id"].startswith("ORD-")
    assert command_topic("line1", "LINE", cmd) == "factory/line1/LINE/cmd"
    _, rows, t = to_rows("factory/line1/LINE/cmd", cmd.model_dump_json())
    assert t.is_line and rows[0][1] == "LINE"


@pytest.mark.parametrize("target,command,params", [
    ("M1", "start_line", {}),                       # line command on a machine
    ("LINE", "set_speed", {"factor": 1.2}),         # machine command on LINE
])
def test_command_level_mismatch(target, command, params):
    cmd = Command(command=command, params=params)
    with pytest.raises(ValueError):
        command_topic("line1", target, cmd)
    with pytest.raises(ValueError):
        to_rows(f"factory/line1/{target}/cmd", cmd.model_dump_json())


@pytest.mark.parametrize("command,params", [
    ("teleport", {}),
    ("set_speed", {"factor": 10}),
    ("set_speed", {}),
    ("start_line", {"unexpected": 1}),
    ("create_order", {"quantity": 0}),
    ("dispatch_worker", {"action": "dance"}),
    ("set_time_scale", {"scale": 0}),
])
def test_invalid_commands(command, params):
    with pytest.raises(ValidationError):
        Command(command=command, params=params)
