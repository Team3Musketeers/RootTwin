"""OPC UA server: the RootTwin line as an address space any OPC UA client can browse, read and write.

    python -m roottwin.enterprise.opcua_server            # opc.tcp://localhost:4840/roottwin/

Reads the live snapshot and telemetry from MQTT (same feed as the 3D twin) and updates the nodes; writes to the
writable nodes (SpeedFactor, Start, Stop, Running) become standard commands on the command channel, logged and
replayable like any UI or RL command.
shortcut: security policy None (demo network); enable Basic256Sha256 + certificates before connecting a real plant.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
from pathlib import Path

import yaml
from asyncua import Server, ua

from roottwin.contracts import Command

log = logging.getLogger("roottwin.opcua")
CONFIG = Path(__file__).resolve().parents[2] / "config" / "enterprise.yaml"
TWIN_NAME = {"M1": "VIS", "M2": "CNC", "M3": "PRS", "M4": "WLD", "M5": "PAL", "M6": "CNV"}
SENSORS = ["Vibration", "Temperature", "Current", "Cadence"]
NS_URI = "urn:roottwin:digital-twin"


class TwinAddressSpace:
    """Builds the node tree and keeps it in sync with snapshots; turns client writes into commands."""

    def __init__(self, server: Server, idx: int, line: str, send):
        self.server, self.idx, self.line, self.send = server, idx, line, send
        self.nodes: dict[str, ua.Node] = {}
        self.writable: dict[ua.NodeId, tuple[str, str]] = {}      # node id -> (target, kind)
        self.last_written: dict[ua.NodeId, object] = {}

    async def build(self, machines: list[str]) -> None:
        root = await self.server.nodes.objects.add_folder(self.idx, "RootTwin")
        line = await root.add_folder(self.idx, self.line)
        lf = await line.add_object(self.idx, "Line")
        for name, val in [("Running", False), ("PartsOk", 0), ("ThroughputPerH", 0.0), ("Availability", 0.0)]:
            self.nodes[f"Line.{name}"] = await lf.add_variable(self.idx, name, val)
        await self._writable(self.nodes["Line.Running"], "LINE", "running")
        for m in machines:
            mo = await line.add_object(self.idx, f"{m}_{TWIN_NAME.get(m, m)}")
            for name, val in [("Status", ""), ("State", ""), ("Faults", ""), ("Wear", 0.0), ("SpeedFactor", 1.0),
                              ("Start", False), ("Stop", False), *[(s, 0.0) for s in SENSORS]]:
                self.nodes[f"{m}.{name}"] = await mo.add_variable(self.idx, name, val)
            for kind in ("SpeedFactor", "Start", "Stop"):
                await self._writable(self.nodes[f"{m}.{kind}"], m, kind)

    async def _writable(self, node, target: str, kind: str) -> None:
        await node.set_writable()
        self.writable[node.nodeid] = (target, kind)

    async def set(self, key: str, value) -> None:
        node = self.nodes.get(key)
        if node is not None:
            await node.write_value(value)
            self.last_written[node.nodeid] = value

    async def apply_snapshot(self, snap: dict) -> None:
        await self.set("Line.Running", bool(snap.get("running")))
        k = snap.get("kpi", {})
        await self.set("Line.PartsOk", int(k.get("parts_ok", 0)))
        await self.set("Line.ThroughputPerH", float(k.get("throughput_per_h", 0.0)))
        await self.set("Line.Availability", float(k.get("availability", 0.0)))
        for m in snap.get("machines", []):
            await self.set(f"{m['id']}.Status", m.get("status", ""))
            await self.set(f"{m['id']}.State", m.get("state", ""))
            await self.set(f"{m['id']}.Faults", ",".join(m.get("faults", [])))
            await self.set(f"{m['id']}.Wear", float(m.get("wear", 0.0)))
            await self.set(f"{m['id']}.SpeedFactor", float(m.get("speed", 1.0)))
        for mid, sensors in (snap.get("sensors") or {}).items():
            for s in SENSORS:
                if s.lower() in sensors:
                    await self.set(f"{mid}.{s}", float(sensors[s.lower()]))

    def on_write(self, nodeid: ua.NodeId, value) -> Command | None:
        """A client wrote a writable node -> the matching command (None if it is our own update)."""
        if nodeid not in self.writable or self.last_written.get(nodeid) == value:
            return None
        target, kind = self.writable[nodeid]
        self.last_written[nodeid] = value
        if target == "LINE":
            return Command(command="start_line" if value else "stop_line", issued_by="enterprise")
        if kind == "SpeedFactor":
            return Command(command="set_speed", params={"factor": float(value)}, issued_by="enterprise")
        if kind in ("Start", "Stop") and value:
            return Command(command="start_machine" if kind == "Start" else "stop_machine", issued_by="enterprise")
        return None


class _WriteHandler:
    def __init__(self, space: TwinAddressSpace):
        self.space = space

    def datachange_notification(self, node, val, data):
        cmd = self.space.on_write(node.nodeid, val)
        if cmd:
            target, _ = self.space.writable[node.nodeid]
            self.space.send("LINE" if target == "LINE" else target, cmd)


async def serve(cfg: dict | None = None, stop: asyncio.Event | None = None) -> None:
    cfg = cfg or yaml.safe_load(CONFIG.read_text(encoding="utf-8"))
    line = cfg.get("line", "line1")
    server = Server()
    await server.init()
    server.set_endpoint(os.getenv("OPCUA_ENDPOINT", cfg["server"]["endpoint"]))
    server.set_server_name("RootTwin digital twin")
    server.set_security_policy([ua.SecurityPolicyType.NoSecurity])
    idx = await server.register_namespace(NS_URI)

    from roottwin.mqtt import MqttPublisher
    pub = MqttPublisher(client_id="roottwin-opcua").start()
    space = TwinAddressSpace(server, idx, line, lambda target, cmd: pub.send_command(line, target, cmd))
    await space.build(list(TWIN_NAME))

    loop, queue = asyncio.get_running_loop(), asyncio.Queue(maxsize=50)
    import paho.mqtt.client as mqtt
    sub = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id="roottwin-opcua-sub")
    sub.on_connect = lambda c, *_: c.subscribe(f"twin/{line}/snapshot")
    sub.on_message = lambda _c, _u, msg: loop.call_soon_threadsafe(lambda: queue.full() or queue.put_nowait(json.loads(msg.payload)))
    sub.connect(os.getenv("MQTT_HOST", "localhost"), int(os.getenv("MQTT_PORT", "1883")))
    sub.loop_start()

    async with server:
        subscription = await server.create_subscription(200, _WriteHandler(space))
        await subscription.subscribe_data_change([n for n in space.nodes.values() if n.nodeid in space.writable])
        log.info("OPC UA server on %s", cfg["server"]["endpoint"])
        stop = stop or asyncio.Event()
        while not stop.is_set():
            try:
                await space.apply_snapshot(await asyncio.wait_for(queue.get(), timeout=1.0))
            except asyncio.TimeoutError:
                pass
    sub.loop_stop()
    pub.stop()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    asyncio.run(serve())
