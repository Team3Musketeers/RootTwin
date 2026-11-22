"""Stand-in production line for testing the data pipeline, commands and faults.

NOT the real simulator (T03/T06, Person A). It publishes telemetry/production/
events following docs/DATA_CONTRACTS.md, listens to commands on
factory/<line>/+/cmd, and applies faults from roottwin/faults/catalog.yaml the
same way the real simulation should (ActiveFault.apply / .state).

    python scripts/publish_fake_data.py --seconds 20                    # healthy line
    python scripts/publish_fake_data.py --seconds 30 --fault M3:BEARING_WEAR
    python scripts/publish_fake_data.py --seconds 120 --time-scale 60   # then run_scenario.py
"""
from __future__ import annotations

import argparse
import json
import threading
import time
from datetime import datetime, timezone

import numpy as np
import paho.mqtt.client as mqtt

from roottwin.contracts import Command
from roottwin.faults import ActiveFault, load_catalog, worst_state

MACHINES = ["M1", "M2", "M3", "M4", "M5", "M6"]
NOMINAL = {"vibration": 2.0, "temperature": 45.0, "current": 12.0, "cadence": 30.0}


class FakeLine:
    def __init__(self, line: str, scenario: str, time_scale: float, seed: int):
        self.line, self.scenario, self.time_scale = line, scenario, time_scale
        self.rng = np.random.default_rng(seed)
        self.catalog = load_catalog()
        self.sim_min = 0.0
        self.running = True
        self.speed = {m: 1.0 for m in MACHINES}
        self.faults: dict[str, list[ActiveFault]] = {m: [] for m in MACHINES}
        self.state = {m: "ok" for m in MACHINES}
        self.lock = threading.Lock()

    def inject(self, machine: str, code: str, ramp_min: float | None = None) -> None:
        with self.lock:
            self.faults[machine].append(ActiveFault(self.catalog[code], machine, self.sim_min, ramp_min))

    def on_command(self, machine: str, cmd: Command) -> str | None:
        with self.lock:
            if cmd.command == "inject_fault":
                code = cmd.params["fault_code"]
                if code not in self.catalog:
                    return f"unknown fault {code}"
                self.faults[machine].append(ActiveFault(self.catalog[code], machine, self.sim_min,
                                                        cmd.params.get("ramp_min")))
            elif cmd.command in ("repair", "clear_fault", "preventive_maintenance"):
                self.faults[machine].clear()
            elif cmd.command == "dispatch_worker":
                self.faults[machine].clear()   # stand-in: instant repair
            elif cmd.command == "set_speed":
                self.speed[machine] = cmd.params["factor"]
            elif cmd.command in ("stop_line", "pause_line"):
                self.running = False
            elif cmd.command == "start_line":
                self.running = True
            elif cmd.command == "set_time_scale":
                self.time_scale = cmd.params["scale"]
        return None

    def sensors(self, m: str) -> dict[str, float]:
        base = {k: v * (self.speed[m] if k in ("cadence", "vibration") else 1.0) for k, v in NOMINAL.items()}
        noisy = {k: v * self.rng.normal(1, 0.03) for k, v in base.items()}
        for f in self.faults[m]:
            noisy = f.apply(noisy, self.sim_min, self.rng)
        if not self.running or self.state[m] == "down":
            noisy["cadence"] = 0.0
        return {k: round(v, 3) for k, v in noisy.items()}

    def machine_state(self, m: str) -> str:
        return worst_state([f.state(self.sim_min) for f in self.faults[m]])


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--host", default="localhost")
    p.add_argument("--port", type=int, default=1883)
    p.add_argument("--line", default="line1")
    p.add_argument("--seconds", type=int, default=10, help="real seconds to run")
    p.add_argument("--time-scale", type=float, default=60.0, help="sim seconds per real second")
    p.add_argument("--fault", action="append", default=[], help="MACHINE:FAULT_CODE injected at start")
    p.add_argument("--scenario", default=f"fake-{int(time.time())}")
    p.add_argument("--seed", type=int, default=0)
    a = p.parse_args()

    line = FakeLine(a.line, a.scenario, a.time_scale, a.seed)
    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=f"fake-line-{a.seed}")

    def pub(machine: str, kind: str, body: dict):
        body.setdefault("ts", now())
        body.setdefault("source", "sim")
        body.setdefault("scenario_id", a.scenario)
        client.publish(f"factory/{a.line}/{machine}/{kind}", json.dumps(body), qos=1)

    def on_message(_c, _u, msg):
        machine = msg.topic.split("/")[2]
        try:
            cmd = Command.model_validate_json(msg.payload)
        except ValueError as exc:
            print(f"  ignored bad command on {msg.topic}: {str(exc).splitlines()[0]}")
            return
        if machine != "LINE" and machine not in MACHINES:
            return
        err = line.on_command(machine, cmd)
        print(f"  cmd {cmd.command} {cmd.params} -> {machine}" + (f" ({err})" if err else ""))

    client.on_connect = lambda c, *_: c.subscribe(f"factory/{a.line}/+/cmd", qos=1)
    client.on_message = on_message
    client.connect(a.host, a.port)
    client.loop_start()

    for spec in a.fault:
        m, code = spec.split(":")
        line.inject(m, code)
        pub(m, "event", {"event_type": "fault_injected", "fault_code": code, "severity": 3})

    for _ in range(a.seconds):
        with line.lock:
            for m in MACHINES:
                pub(m, "telemetry", {"sensors": line.sensors(m)})
                new_state = line.machine_state(m)
                if line.running and new_state != "down":
                    scrap = max((f.scrap_rate(line.sim_min) for f in line.faults[m]), default=0.0)
                    n = int(line.rng.poisson(0.5 * line.speed[m]))
                    bad = int(line.rng.binomial(n, scrap)) if n else 0
                    pub(m, "production", {"parts_ok": n - bad, "parts_scrap": bad})
                if new_state != line.state[m]:
                    line.state[m] = new_state
                    codes = [f.code for f in line.faults[m]]
                    pub(m, "event", {"event_type": "state_change", "state": new_state,
                                     "fault_code": codes[-1] if codes else None,
                                     "severity": {"ok": 1, "degraded": 3, "down": 5}[new_state]})
                    print(f"  t={line.sim_min:6.1f} sim-min  {m} -> {new_state}")
            line.sim_min += line.time_scale / 60.0
        time.sleep(1.0)

    client.loop_stop()
    client.disconnect()
    print(f"ran {a.seconds}s real = {line.sim_min:.0f} sim-min, scenario_id={a.scenario}")


if __name__ == "__main__":
    main()
