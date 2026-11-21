import json
import sys
from pathlib import Path

import pytest
from pydantic import ValidationError

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "services" / "ingestor"))
from schemas import COLUMNS, to_rows  # noqa: E402


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
    ("factory/line1/M1/telemetry", '{"sensors": {}}'),
    ("factory/line1/M1/telemetry", "not json"),
    ("factory/line1/M1/event", '{"event_type": "x", "severity": 9}'),
    ("factory/line1/M1/event", '{"event_type": "x", "state": "purple"}'),
    ("factory/line1/M1/production", '{"parts_ok": -1}'),
])
def test_invalid_messages_rejected(topic, payload):
    with pytest.raises((ValueError, ValidationError)):
        to_rows(topic, payload)
