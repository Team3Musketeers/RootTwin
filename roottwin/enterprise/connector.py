"""Enterprise connector: real plant data into the twin (OPC UA PLC nodes and MQTT topics -> machine telemetry).

    python -m roottwin.enterprise.connector                 # uses config/enterprise.yaml `sources`

Each mapping turns one external value into one sensor of a line machine. Every `period_s` the connector publishes
the latest values per machine on factory/<line>/<machine>/telemetry with source=plc|mqtt - the same message the
simulator sends - so the AI detector, the diagnosis graph / Bayesian network and the 3D twin work on real data
unchanged. Sensors a source does not provide are left out (the detector keeps its last values for them).
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
from datetime import datetime, timezone
from pathlib import Path

import yaml

log = logging.getLogger("roottwin.connector")
CONFIG = Path(__file__).resolve().parents[2] / "config" / "enterprise.yaml"
SENSORS = {"vibration", "temperature", "current", "cadence"}


def external_machines(cfg: dict | None = None, path: Path = CONFIG) -> set[str]:
    """Machines fed by a real source in the config (the simulator must not publish sensors for them)."""
    if cfg is None:
        if not path.exists():
            return set()
        cfg = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    src = cfg.get("sources") or {}
    out = {m["machine"] for s in src.get("opcua") or [] for m in s.get("map") or []}
    return out | {s["machine"] for s in src.get("mqtt") or []}


class Readings:
    """Latest mapped values: machine -> sensor -> (value, source)."""

    def __init__(self):
        self.values: dict[str, dict[str, float]] = {}
        self.source: dict[str, str] = {}

    def put(self, m: dict, raw, source: str) -> bool:
        """Store one raw value through its mapping (scale / offset); False if it is not a number."""
        try:
            v = float(raw["value"] if isinstance(raw, dict) else raw)
        except (TypeError, ValueError, KeyError):
            return False
        if m["sensor"] not in SENSORS:
            raise ValueError(f"unknown sensor {m['sensor']} (use {sorted(SENSORS)})")
        self.values.setdefault(m["machine"], {})[m["sensor"]] = v * m.get("scale", 1.0) + m.get("offset", 0.0)
        self.source[m["machine"]] = source
        return True

    def messages(self, line: str) -> list[tuple[str, dict]]:
        ts = datetime.now(timezone.utc).isoformat()
        return [(f"factory/{line}/{mid}/telemetry", {"sensors": dict(s), "ts": ts, "source": self.source[mid]})
                for mid, s in self.values.items() if s]


async def poll_opcua(src: dict, readings: Readings, stop: asyncio.Event) -> None:
    """Poll the mapped nodes of one OPC UA server (PLC, PLCSIM, Codesys, Factory I/O...) and keep reconnecting."""
    from asyncua import Client
    while not stop.is_set():
        try:
            async with Client(url=src["endpoint"], timeout=4) as client:
                nodes = [(m, client.get_node(m["node"])) for m in src["map"]]
                log.info("connected to %s (%d nodes)", src["endpoint"], len(nodes))
                while not stop.is_set():
                    for m, node in nodes:
                        readings.put(m, await node.read_value(), "plc")
                    await asyncio.sleep(src.get("period_s", 1.0))
        except (OSError, asyncio.TimeoutError, Exception) as e:      # noqa: BLE001 - a plant link must survive anything
            log.warning("OPC UA %s: %s - retrying in 5 s", src["endpoint"], e)
            await asyncio.sleep(5)


def subscribe_mqtt(sources: list[dict], readings: Readings):
    """Subscribe to the mapped MQTT topics of the plant broker (default: the twin's own broker)."""
    import paho.mqtt.client as mqtt
    by_topic = {s["topic"]: s for s in sources}
    c = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id="roottwin-connector-sub")
    c.on_connect = lambda cl, *_: [cl.subscribe(t) for t in by_topic]

    def on_message(_c, _u, msg):
        try:
            raw = json.loads(msg.payload)
        except ValueError:
            raw = msg.payload.decode(errors="replace")
        readings.put(by_topic[msg.topic], raw, "mqtt")
    c.on_message = on_message
    c.connect(os.getenv("PLANT_MQTT_HOST", os.getenv("MQTT_HOST", "localhost")), int(os.getenv("PLANT_MQTT_PORT", os.getenv("MQTT_PORT", "1883"))))
    c.loop_start()
    return c


async def run(cfg: dict | None = None, publish=None, stop: asyncio.Event | None = None, period: float = 1.0) -> None:
    cfg = cfg or yaml.safe_load(CONFIG.read_text(encoding="utf-8"))
    line, src = cfg.get("line", "line1"), cfg.get("sources") or {}
    stop = stop or asyncio.Event()
    readings = Readings()
    if publish is None:
        from roottwin.mqtt import MqttPublisher
        pub = MqttPublisher(client_id="roottwin-connector").start()
        publish = pub.publish_json
    tasks = [asyncio.create_task(poll_opcua(s, readings, stop)) for s in src.get("opcua") or []]
    mq = subscribe_mqtt(src["mqtt"], readings) if src.get("mqtt") else None
    if not tasks and not mq:
        log.warning("no sources configured in %s - nothing to forward", CONFIG)
    while not stop.is_set():
        for topic, body in readings.messages(line):
            publish(topic, body)
        try:
            await asyncio.wait_for(stop.wait(), timeout=period)
        except asyncio.TimeoutError:
            pass
    for t in tasks:
        t.cancel()
    if mq:
        mq.loop_stop()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    logging.getLogger("asyncua").setLevel(logging.WARNING)       # its INFO logs every publish cycle
    asyncio.run(run())
