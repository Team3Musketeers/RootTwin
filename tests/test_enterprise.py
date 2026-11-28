"""T26 enterprise mode: OPC UA server address space + commands, and the OPC UA connector against a simulated PLC."""
import asyncio
import socket

import pytest

pytest.importorskip("asyncua")
from asyncua import Client, Server, ua  # noqa: E402

from roottwin.enterprise.connector import Readings, run  # noqa: E402
from roottwin.enterprise.opcua_server import TWIN_NAME, TwinAddressSpace  # noqa: E402


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def test_server_exposes_snapshot_and_turns_writes_into_commands():
    sent = []

    async def main():
        port = free_port()
        server = Server()
        await server.init()
        server.set_endpoint(f"opc.tcp://127.0.0.1:{port}/rt/")
        idx = await server.register_namespace("urn:test")
        space = TwinAddressSpace(server, idx, "line1", lambda t, c: sent.append((t, c)))
        await space.build(list(TWIN_NAME))
        async with server:
            await space.apply_snapshot({"running": True, "kpi": {"parts_ok": 42, "throughput_per_h": 55.5, "availability": 0.9},
                                        "machines": [{"id": "M3", "status": "working", "state": "degraded", "faults": ["BEARING_WEAR"], "wear": 0.4, "speed": 1.0}],
                                        "sensors": {"M3": {"vibration": 4.2, "temperature": 51.0, "current": 12.5, "cadence": 29.0}}})
            async with Client(f"opc.tcp://127.0.0.1:{port}/rt/") as c:
                ns = await c.get_namespace_index("urn:test")
                base = ["0:Objects", f"{ns}:RootTwin", f"{ns}:line1"]
                vib = await c.nodes.root.get_child([*base, f"{ns}:M3_PRS", f"{ns}:Vibration"])
                faults = await c.nodes.root.get_child([*base, f"{ns}:M3_PRS", f"{ns}:Faults"])
                parts = await c.nodes.root.get_child([*base, f"{ns}:Line", f"{ns}:PartsOk"])
                assert await vib.read_value() == pytest.approx(4.2)
                assert await faults.read_value() == "BEARING_WEAR"
                assert await parts.read_value() == 42
                speed = await c.nodes.root.get_child([*base, f"{ns}:M3_PRS", f"{ns}:SpeedFactor"])
                await speed.write_value(ua.DataValue(ua.Variant(1.5, ua.VariantType.Double)))
                cmd = space.on_write(speed.nodeid, 1.5)            # what the subscription handler does
                assert cmd.command == "set_speed" and cmd.params == {"factor": 1.5} and cmd.issued_by == "enterprise"
                assert space.on_write(speed.nodeid, 1.5) is None   # same value again: no duplicate command

    asyncio.run(main())


def test_connector_reads_a_plc_and_publishes_twin_telemetry():
    published = []

    async def main():
        port = free_port()
        plc = Server()                                              # stands in for a real PLC / PLCSIM
        await plc.init()
        plc.set_endpoint(f"opc.tcp://127.0.0.1:{port}/plc/")
        idx = await plc.register_namespace("urn:plc")
        db = await plc.nodes.objects.add_object(idx, "DB_Press")
        cur = await db.add_variable(ua.NodeId("Press.MotorCurrent", idx), "MotorCurrent", 18.0)
        temp = await db.add_variable(ua.NodeId("Press.BearingTemp", idx), "BearingTemp", 300.0)   # 0.1 °C units
        async with plc:
            cfg = {"line": "line1", "sources": {"opcua": [{"endpoint": f"opc.tcp://127.0.0.1:{port}/plc/", "period_s": 0.1, "map": [
                {"node": cur.nodeid.to_string(), "machine": "M3", "sensor": "current"},
                {"node": temp.nodeid.to_string(), "machine": "M3", "sensor": "temperature", "scale": 0.1, "offset": 15.0}]}]}}
            stop = asyncio.Event()
            task = asyncio.create_task(run(cfg, publish=lambda t, b: published.append((t, b)), stop=stop, period=0.2))
            for _ in range(50):
                await asyncio.sleep(0.1)
                if any(b["sensors"].get("temperature") for _, b in published):
                    break
            stop.set()
            await task
    asyncio.run(main())
    topic, body = next((t, b) for t, b in published if "temperature" in b["sensors"])
    assert topic == "factory/line1/M3/telemetry" and body["source"] == "plc"
    assert body["sensors"] == {"current": 18.0, "temperature": pytest.approx(45.0)}


def test_readings_reject_garbage_and_unknown_sensors():
    r = Readings()
    assert not r.put({"machine": "M1", "sensor": "current"}, "n/a", "mqtt")
    assert r.put({"machine": "M1", "sensor": "current"}, {"value": "3.5"}, "mqtt") and r.values["M1"]["current"] == 3.5
    with pytest.raises(ValueError):
        r.put({"machine": "M1", "sensor": "pressure"}, 1, "mqtt")
