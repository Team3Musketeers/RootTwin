"""Publish fake telemetry / events / production to MQTT to test the data pipeline.

This is NOT the simulator (that is T03/T06, Person A). It only checks that
MQTT -> ingestor -> TimescaleDB works end to end, following docs/DATA_CONTRACTS.md.

Usage:
    pip install paho-mqtt
    python scripts/publish_fake_data.py --seconds 10
    python scripts/publish_fake_data.py --seconds 30 --fault M3   # M3 degrades then goes down
"""
from __future__ import annotations

import argparse
import json
import random
import time
from datetime import datetime, timezone

import paho.mqtt.client as mqtt

MACHINES = ["M1", "M2", "M3", "M4", "M5", "M6"]
NOMINAL = {"vibration": 2.0, "temperature": 45.0, "current": 12.0, "cadence": 30.0}


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--host", default="localhost")
    p.add_argument("--port", type=int, default=1883)
    p.add_argument("--line", default="line1")
    p.add_argument("--seconds", type=int, default=10)
    p.add_argument("--hz", type=float, default=1.0, help="messages per machine per second")
    p.add_argument("--fault", default=None, help="machine id that degrades (e.g. M3)")
    p.add_argument("--scenario", default=f"smoke-{int(time.time())}")
    a = p.parse_args()

    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id="fake-publisher")
    client.connect(a.host, a.port)
    client.loop_start()

    def pub(machine: str, kind: str, body: dict):
        body.setdefault("ts", now())
        body.setdefault("source", "sim")
        body.setdefault("scenario_id", a.scenario)
        client.publish(f"factory/{a.line}/{machine}/{kind}", json.dumps(body), qos=1).wait_for_publish()

    steps = int(a.seconds * a.hz)
    state = {m: "ok" for m in MACHINES}
    if a.fault:
        pub(a.fault, "event", {"event_type": "fault_injected", "fault_code": "BEARING_WEAR",
                               "severity": 3, "payload": {"note": "fake publisher"}})
    for i in range(steps):
        wear = i / max(steps - 1, 1)  # 0 -> 1 over the run
        for m in MACHINES:
            k = 1 + 2.5 * wear if m == a.fault else 1.0
            sensors = {s: round(v * (k if s in ("vibration", "temperature") else 1)
                                * random.gauss(1, 0.03), 3) for s, v in NOMINAL.items()}
            pub(m, "telemetry", {"sensors": sensors})
            pub(m, "production", {"parts_ok": random.randint(0, 1), "parts_scrap": 0})
            new_state = "down" if k > 3.0 else "degraded" if k > 2.0 else "ok"
            if new_state != state[m]:
                state[m] = new_state
                pub(m, "event", {"event_type": "state_change", "state": new_state,
                                 "severity": 5 if new_state == "down" else 3})
        time.sleep(1 / a.hz)

    client.loop_stop()
    client.disconnect()
    print(f"published {steps} ticks x {len(MACHINES)} machines, scenario_id={a.scenario}")


if __name__ == "__main__":
    main()
