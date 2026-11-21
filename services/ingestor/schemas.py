"""MQTT message contracts for the factory digital twin.

Topic layout:  factory/{line_id}/{machine_id}/{kind}
    kind = telemetry | event | production

See docs/DATA_CONTRACTS.md for examples. Any publisher (simulation, enterprise
connector, replayed dataset) must follow these schemas.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator

Source = Literal["sim", "cmapss", "cwru", "ai4i", "enterprise"]
MachineState = Literal["ok", "degraded", "down"]


def _utc(ts: datetime) -> datetime:
    return ts if ts.tzinfo else ts.replace(tzinfo=timezone.utc)


class _Base(BaseModel):
    ts: datetime = Field(default_factory=lambda: datetime.now(timezone.utc),
                         description="ISO-8601 or epoch seconds; UTC if no timezone")
    source: Source = "sim"
    scenario_id: str | None = None

    @field_validator("ts")
    @classmethod
    def _norm_ts(cls, v: datetime) -> datetime:
        return _utc(v)


class Telemetry(_Base):
    sensors: dict[str, float] = Field(min_length=1,
                                      description="sensor name -> value, e.g. {'vibration': 2.3}")


class Event(_Base):
    event_type: str = Field(min_length=1)
    state: MachineState | None = None
    fault_code: str | None = None
    severity: int | None = Field(default=None, ge=1, le=5)
    payload: dict[str, Any] = Field(default_factory=dict)


class Production(_Base):
    parts_ok: int = Field(default=0, ge=0)
    parts_scrap: int = Field(default=0, ge=0)


class Topic(BaseModel):
    line_id: str
    machine_id: str
    kind: Literal["telemetry", "event", "production"]

    @classmethod
    def parse(cls, topic: str) -> "Topic":
        parts = topic.split("/")
        if len(parts) != 4 or parts[0] != "factory":
            raise ValueError(f"unexpected topic '{topic}', expected factory/<line>/<machine>/<kind>")
        return cls(line_id=parts[1], machine_id=parts[2], kind=parts[3])


def to_rows(topic: str, raw: bytes | str) -> tuple[str, list[tuple], Topic]:
    """Validate one MQTT message and convert it to DB rows.

    Returns (table_name, rows, parsed_topic). Raises ValueError / ValidationError
    on bad input so the caller can log and drop it.
    """
    t = Topic.parse(topic)
    if t.kind == "telemetry":
        m = Telemetry.model_validate_json(raw)
        rows = [(m.ts, t.machine_id, name, float(val), m.source, m.scenario_id)
                for name, val in m.sensors.items()]
        return "sensor_readings", rows, t
    if t.kind == "event":
        m = Event.model_validate_json(raw)
        return "events", [(m.ts, t.machine_id, m.event_type, m.state, m.fault_code,
                           m.severity, m.source, m.scenario_id, m.payload)], t
    m = Production.model_validate_json(raw)
    return "production", [(m.ts, t.machine_id, m.parts_ok, m.parts_scrap,
                           m.source, m.scenario_id)], t


COLUMNS: dict[str, tuple[str, ...]] = {
    "sensor_readings": ("time", "machine_id", "sensor", "value", "source", "scenario_id"),
    "events": ("time", "machine_id", "event_type", "state", "fault_code", "severity",
               "source", "scenario_id", "payload"),
    "production": ("time", "machine_id", "parts_ok", "parts_scrap", "source", "scenario_id"),
}
