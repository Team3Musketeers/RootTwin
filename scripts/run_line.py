"""Run the production line in real time over MQTT (stand-in for Person A's simulation).

Publishes (docs/DATA_CONTRACTS.md):
  factory/<line>/<M>/telemetry   every simulated minute
  factory/<line>/<M>/production  every simulated minute
  factory/<line>/<M>/event       state changes, failures, repairs, faults injected
  twin/<line>/snapshot           full state for the 3D view, ~5 times per real second
Listens to factory/<line>/+/cmd (UI, RL agent, scenarios).

    python scripts/run_line.py                         # runs until Ctrl+C, x60 (1 sim-min per second)
    python scripts/run_line.py --seconds 60 --start --random-faults
"""
from __future__ import annotations

import argparse
import json
import os
import threading
import time
from datetime import datetime, timezone

import paho.mqtt.client as mqtt

from roottwin.components import snapshot_components
from roottwin.contracts import Command
from roottwin.enterprise.connector import external_machines
from roottwin.line import Line

TICK_S = 0.2


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--host", default=os.getenv("MQTT_HOST", "localhost"))
    p.add_argument("--port", type=int, default=int(os.getenv("MQTT_PORT", "1883")))
    p.add_argument("--line", default="line1")
    p.add_argument("--seconds", type=float, default=0, help="0 = run forever")
    p.add_argument("--time-scale", type=float, default=60.0, help="sim seconds per real second")
    p.add_argument("--start", action="store_true", help="start the line immediately (continuous order)")
    p.add_argument("--random-faults", action="store_true", help="wear-driven random faults")
    p.add_argument("--seed", type=int, default=0)
    p.add_argument("--scenario", default=None, help="scenario_id stamped on messages")
    p.add_argument("--external", default=None,
                   help="comma-separated machines fed by real data (default: those mapped in config/enterprise.yaml)")
    a = p.parse_args()
    # T26: machines with a real source keep running in the line model (flow, faults, workers) but their sensor
    # telemetry comes from the plant only; the snapshot shows the latest real readings for them
    external = set(a.external.split(",")) - {""} if a.external is not None else external_machines()
    if external:
        print(f"real data for {sorted(external)}: simulated telemetry off for them", flush=True)

    line = Line(seed=a.seed, random_faults=a.random_faults)
    state = {"scale": a.time_scale, "scenario": a.scenario}
    lock = threading.Lock()
    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=f"roottwin-line-{a.line}")

    def pub(machine, kind, body):
        body.setdefault("ts", datetime.now(timezone.utc).isoformat())
        body.setdefault("source", "sim")
        if state["scenario"]:
            body.setdefault("scenario_id", state["scenario"])
        client.publish(f"factory/{a.line}/{machine}/{kind}", json.dumps(body, default=str), qos=0)

    last_sensors: dict[str, dict] = {}              # latest readings per machine (simulated or real) for the snapshot

    def on_message(_c, _u, msg):
        target = msg.topic.split("/")[2]
        if msg.topic.endswith("/telemetry"):         # real plant readings for an external machine -> snapshot
            body = json.loads(msg.payload)
            if body.get("source") != "sim" and target in external:
                with lock:
                    last_sensors[target] = {**last_sensors.get(target, {}), **body.get("sensors", {})}
            return
        try:
            cmd = Command.model_validate_json(msg.payload)
        except ValueError:
            return                                  # the ingestor logs invalid commands
        with lock:
            if cmd.command == "set_time_scale":
                state["scale"] = cmd.params["scale"]
            if cmd.scenario_id:
                state["scenario"] = cmd.scenario_id
            err = line.command(target, cmd.command, cmd.params)
        print(f"  t={line.t:7.1f}  {cmd.command} {cmd.params or ''} -> {target}" + (f"  ({err})" if err else ""),
              flush=True)

    client.on_connect = lambda c, *_: (c.subscribe(f"factory/{a.line}/+/cmd", qos=1),
                                       *[c.subscribe(f"factory/{a.line}/{m}/telemetry") for m in external])
    client.on_message = on_message
    client.connect(a.host, a.port)
    client.loop_start()
    if a.start:
        line.command("LINE", "start_line")

    last_state = {m.id: "ok" for m in line.machines}
    last_prod = {"ok": 0, "scrap": 0}
    next_minute = 0.0
    t_end = time.monotonic() + a.seconds if a.seconds else float("inf")
    print(f"line {a.line} running x{state['scale']} - Ctrl+C to stop", flush=True)
    try:
        while time.monotonic() < t_end:
            t0 = time.monotonic()
            with lock:
                line.step(state["scale"] * TICK_S / 60)
                while line.t >= next_minute:              # telemetry once per simulated minute
                    for i, m in enumerate(line.machines):
                        if m.id in external:
                            continue                          # the plant publishes these
                        last_sensors[m.id] = line.sensors(i)
                        pub(m.id, "telemetry", {"sensors": last_sensors[m.id]})
                    k = line.kpi
                    pub("M6", "production", {"parts_ok": k["parts_ok"] - last_prod["ok"],
                                             "parts_scrap": k["parts_scrap"] - last_prod["scrap"]})
                    last_prod.update(ok=k["parts_ok"], scrap=k["parts_scrap"])
                    next_minute += 1.0
                for m in line.machines:
                    st = "maintenance" if m.status == "maintenance" else m.state(line.t)
                    if st != last_state[m.id]:
                        last_state[m.id] = st
                        pub(m.id, "event", {"event_type": "state_change", "state": st,
                                            "fault_code": m.faults[-1].code if m.faults else None,
                                            "severity": {"ok": 1, "degraded": 3, "maintenance": 2, "down": 5}[st]})
                for ev in line.events:
                    pub(ev.pop("machine_id"), "event", ev)
                line.events.clear()
                snap = line.snapshot()
                snap["time_scale"] = state["scale"]
                snap["sensors"] = last_sensors
                snap["components"] = snapshot_components(line, last_sensors)   # per-part health/telemetry for the 3D twin
            client.publish(f"twin/{a.line}/snapshot", json.dumps(snap), qos=0)
            time.sleep(max(0.0, TICK_S - (time.monotonic() - t0)))
    except KeyboardInterrupt:
        pass
    client.loop_stop()
    client.disconnect()
    print(f"stopped at t={line.t:.0f} sim-min, KPI {line.kpis()}")


if __name__ == "__main__":
    main()
