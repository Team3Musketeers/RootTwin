"""T25 - reproducible demo: start the product, wait until it is healthy, play the scripted fault scenario.

    python scripts/demo.py                 # docker compose up + scenario
    python scripts/demo.py --no-up         # stack already running

Scenario (what the jury sees, ~3 min at the default x60 time scale):
  1. line running, digital twin live at http://localhost:8000
  2. bearing wear injected on M3 (gearbox press): vibration rises slowly, nothing visible yet
  3. the AI detector alarms BEFORE the breakdown; graph + Bayesian network name M3 as root cause even though
     M4-M6 starve and M1-M2 block; the twin turns the input bearing red; copilot gives the repair procedure
  4. a technician is dispatched (LOTO, repair); the line recovers
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
import urllib.request

API = os.getenv("DEMO_API", "http://localhost:8000")
CMD = os.getenv("DEMO_COMMAND_API", "http://localhost:8001")


def get(url: str):
    with urllib.request.urlopen(url, timeout=5) as r:
        return json.loads(r.read())


def command(target: str, name: str, **params):
    req = urllib.request.Request(f"{CMD}/command/line1/{target}", method="POST", headers={"Content-Type": "application/json"},
                                 data=json.dumps({"command": name, "params": params, "issued_by": "script"}).encode())
    with urllib.request.urlopen(req, timeout=5) as r:
        return json.loads(r.read())


def wait(cond, what: str, timeout: float):
    t0 = time.time()
    while time.time() - t0 < timeout:
        try:
            if v := cond():
                return v
        except Exception:      # noqa: BLE001 - services still starting
            pass
        time.sleep(2)
    sys.exit(f"timeout waiting for {what}")


def main():
    a = argparse.ArgumentParser()
    a.add_argument("--no-up", action="store_true")
    args = a.parse_args()
    if not args.no_up:
        subprocess.run(["docker", "compose", "up", "-d", "--build"], check=True)
    wait(lambda: get(f"{API}/health")["snapshot"], "the line snapshot", 240)
    print(f"1. Twin live: {API}  (line running)")
    command("M3", "clear_fault")
    since = time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime())          # only alarms raised by this run
    command("M3", "inject_fault", fault_code="BEARING_WEAR")
    print("2. BEARING_WEAR injected on M3 - watch the press in the twin")
    ev = wait(lambda: next((e for e in get(f"{API}/events?limit=50&event_type=alarm") if e["time"][:19] >= since and e["machine_id"] == "M3"), None), "the AI alarm on M3", 600)
    p = ev.get("payload") or {}
    if isinstance(p, str):
        p = json.loads(p)
    d = p.get("diagnosis", {})
    print(f"3. AI alarm on {ev.get('machine_id')}: root cause {d.get('root')} (graph), consequences {d.get('explained')}, "
          f"Bayes {d.get('bayes_root')}, component {p.get('component')}")
    print("   Open the twin: Faults tab shows the propagation graph; Locate [F] explodes the press and shows the red bearing.")
    command("M3", "dispatch_worker", worker_id="W1")
    print("4. Mechanic W1 dispatched (LOTO + repair). Demo done.")


if __name__ == "__main__":
    main()
