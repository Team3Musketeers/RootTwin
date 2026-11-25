"""Where the simulation's output goes.

- Sink: outbound MQTT-style messages (topic + JSON body following roottwin.contracts).
  MqttSink for the live line, MemorySink for tests, NullSink to discard.
- Recorder: labelled dataset rows (sensor values + ground truth), one row per
  telemetry sample and machine, same columns as roottwin.faults.offline.simulate
  so B's training scripts can switch to the real simulation without changes.
"""
from __future__ import annotations

import json
from typing import Any, Protocol


class Sink(Protocol):
    def publish(self, topic: str, body: dict[str, Any], *, qos: int = 1, retain: bool = False) -> None: ...


class NullSink:
    def publish(self, topic: str, body: dict[str, Any], *, qos: int = 1, retain: bool = False) -> None:
        pass


class MemorySink:
    """Keeps every message (tests, debugging)."""

    def __init__(self) -> None:
        self.messages: list[tuple[str, dict[str, Any]]] = []

    def publish(self, topic: str, body: dict[str, Any], *, qos: int = 1, retain: bool = False) -> None:
        self.messages.append((topic, body))

    def of_kind(self, kind: str, machine_id: str | None = None) -> list[dict[str, Any]]:
        out = []
        for topic, body in self.messages:
            _, _, target, k = topic.split("/")
            if k == kind and (machine_id is None or target == machine_id):
                out.append(body)
        return out

    def events(self, event_type: str | None = None, machine_id: str | None = None) -> list[dict[str, Any]]:
        return [e for e in self.of_kind("event", machine_id) if event_type in (None, e["event_type"])]


class MqttSink:
    """Publishes on an already connected paho client (non-blocking: never stalls the simulation)."""

    def __init__(self, client: Any):
        self.client = client

    def publish(self, topic: str, body: dict[str, Any], *, qos: int = 1, retain: bool = False) -> None:
        self.client.publish(topic, json.dumps(body, default=str), qos=qos, retain=retain)


class Recorder:
    """Labelled rows for dataset generation (T12) and model training."""

    COLUMNS = ("scenario_id", "t_min", "machine_id", "vibration", "temperature", "current", "cadence",
               "state", "fault_code", "label", "activity", "health", "speed_factor")

    def __init__(self) -> None:
        self.rows: list[dict[str, Any]] = []

    def record(self, **row: Any) -> None:
        self.rows.append(row)

    def to_frame(self):
        import pandas as pd

        return pd.DataFrame(self.rows, columns=list(self.COLUMNS))
