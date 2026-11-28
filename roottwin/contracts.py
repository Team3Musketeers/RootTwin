"""MQTT message contracts for the factory digital twin.

Topic layout:  factory/{line_id}/{target}/{kind}
    target = a machine id (M1..M6) or LINE for line-level commands
    kind   = telemetry | event | production | cmd

See docs/DATA_CONTRACTS.md for examples. Every publisher (simulation, UI/API,
RL agent, scenario runner, enterprise connector, replayed dataset) follows
these schemas; the ingestor validates them before anything reaches the DB.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Literal
from uuid import uuid4

from pydantic import BaseModel, Field, field_validator, model_validator

Source = Literal["sim", "cmapss", "cwru", "ai4i", "enterprise", "ui", "rl", "scenario", "script"]
MachineState = Literal["ok", "degraded", "down", "maintenance"]
LINE_TARGET = "LINE"  # topic target for line-level commands


def _utc(ts: datetime) -> datetime:
    return ts if ts.tzinfo else ts.replace(tzinfo=timezone.utc)


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class _Base(BaseModel):
    ts: datetime = Field(default_factory=utcnow,
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


# --------------------------------------------------------------------------
# Commands (T33): the UI, the RL agent and the scenario runner all drive the
# simulation through these, so humans and AI are comparable and replayable.
# --------------------------------------------------------------------------

class _NoParams(BaseModel, extra="forbid"):
    pass


class SetSpeedParams(BaseModel, extra="forbid"):
    factor: float = Field(ge=0.1, le=3.0, description="1.0 = nominal cadence; higher = faster wear")


class SetBufferParams(BaseModel, extra="forbid"):
    capacity: int = Field(ge=0, le=200, description="buffer size downstream of the machine (parts)")


class CreateOrderParams(BaseModel, extra="forbid"):
    product: str = Field(default="A", min_length=1)
    quantity: int = Field(ge=1, le=100_000)
    order_id: str = Field(default_factory=lambda: f"ORD-{uuid4().hex[:8]}")


class InjectFaultParams(BaseModel, extra="forbid"):
    fault_code: str = Field(min_length=1, description="code from roottwin/faults/catalog.yaml")
    ramp_min: float | None = Field(default=None, gt=0, description="override the fault's default onset")
    severity: int | None = Field(default=None, ge=1, le=5)


class DispatchWorkerParams(BaseModel, extra="forbid"):
    worker_id: str | None = Field(default=None, description="None = nearest qualified worker")
    action: Literal["inspect", "repair", "replace", "preventive_maintenance"] = "repair"


class SetTimeScaleParams(BaseModel, extra="forbid"):
    scale: float = Field(ge=0.1, le=600, description="simulated seconds per real second")


LINE_COMMANDS: dict[str, type[BaseModel]] = {
    "start_line": _NoParams,
    "stop_line": _NoParams,
    "pause_line": _NoParams,
    "create_order": CreateOrderParams,
    "set_time_scale": SetTimeScaleParams,
}
MACHINE_COMMANDS: dict[str, type[BaseModel]] = {
    "start_machine": _NoParams,
    "stop_machine": _NoParams,
    "set_speed": SetSpeedParams,
    "set_buffer": SetBufferParams,
    "inject_fault": InjectFaultParams,
    "clear_fault": _NoParams,
    "dispatch_worker": DispatchWorkerParams,
    "repair": _NoParams,
    "preventive_maintenance": _NoParams,
}
COMMAND_PARAMS = {**LINE_COMMANDS, **MACHINE_COMMANDS}
CommandName = Literal[tuple(COMMAND_PARAMS)]  # type: ignore[valid-type]
IssuedBy = Literal["ui", "rl", "scenario", "script", "human", "baseline", "enterprise"]


class Command(BaseModel):
    command_id: str = Field(default_factory=lambda: uuid4().hex)
    ts: datetime = Field(default_factory=utcnow)
    command: CommandName
    params: dict[str, Any] = Field(default_factory=dict)
    issued_by: IssuedBy = "ui"
    scenario_id: str | None = None

    @field_validator("ts")
    @classmethod
    def _norm_ts(cls, v: datetime) -> datetime:
        return _utc(v)

    @model_validator(mode="after")
    def _check_params(self) -> "Command":
        model = COMMAND_PARAMS[self.command]
        self.params = model.model_validate(self.params).model_dump(mode="json")
        return self

    @property
    def is_line_command(self) -> bool:
        return self.command in LINE_COMMANDS


def command_topic(line_id: str, target: str, cmd: Command) -> str:
    """Topic for a command; validates that the target fits the command level."""
    if cmd.is_line_command and target != LINE_TARGET:
        raise ValueError(f"'{cmd.command}' is a line command: target must be {LINE_TARGET}")
    if not cmd.is_line_command and target == LINE_TARGET:
        raise ValueError(f"'{cmd.command}' needs a machine target, not {LINE_TARGET}")
    return f"factory/{line_id}/{target}/cmd"


# --------------------------------------------------------------------------
# Topic parsing and DB rows (used by the ingestor)
# --------------------------------------------------------------------------

class Topic(BaseModel):
    line_id: str
    machine_id: str
    kind: Literal["telemetry", "event", "production", "cmd"]

    @classmethod
    def parse(cls, topic: str) -> "Topic":
        parts = topic.split("/")
        if len(parts) != 4 or parts[0] != "factory" or not all(parts):
            raise ValueError(f"unexpected topic '{topic}', expected factory/<line>/<target>/<kind>")
        return cls(line_id=parts[1], machine_id=parts[2], kind=parts[3])

    @property
    def is_line(self) -> bool:
        return self.machine_id == LINE_TARGET


def to_rows(topic: str, raw: bytes | str) -> tuple[str, list[tuple], Topic]:
    """Validate one MQTT message and convert it to DB rows.

    Returns (table_name, rows, parsed_topic). Raises ValueError / ValidationError
    on bad input so the caller can log and drop it.
    """
    t = Topic.parse(topic)
    if t.kind != "cmd" and t.is_line:
        raise ValueError(f"{LINE_TARGET} is only valid for commands")
    if t.kind == "telemetry":
        m = Telemetry.model_validate_json(raw)
        rows = [(m.ts, t.machine_id, name, float(val), m.source, m.scenario_id)
                for name, val in m.sensors.items()]
        return "sensor_readings", rows, t
    if t.kind == "event":
        m = Event.model_validate_json(raw)
        return "events", [(m.ts, t.machine_id, m.event_type, m.state, m.fault_code,
                           m.severity, m.source, m.scenario_id, m.payload)], t
    if t.kind == "cmd":
        c = Command.model_validate_json(raw)
        command_topic(t.line_id, t.machine_id, c)  # level check
        payload = {"command": c.command, "params": c.params, "issued_by": c.issued_by,
                   "command_id": c.command_id, "line_id": t.line_id}
        source = c.issued_by if c.issued_by in ("ui", "rl", "scenario", "script") else "ui"
        return "events", [(c.ts, t.machine_id, "command", None, c.params.get("fault_code"),
                           None, source, c.scenario_id, payload)], t
    m = Production.model_validate_json(raw)
    return "production", [(m.ts, t.machine_id, m.parts_ok, m.parts_scrap,
                           m.source, m.scenario_id)], t


COLUMNS: dict[str, tuple[str, ...]] = {
    "sensor_readings": ("time", "machine_id", "sensor", "value", "source", "scenario_id"),
    "events": ("time", "machine_id", "event_type", "state", "fault_code", "severity",
               "source", "scenario_id", "payload"),
    "production": ("time", "machine_id", "parts_ok", "parts_scrap", "source", "scenario_id"),
}
