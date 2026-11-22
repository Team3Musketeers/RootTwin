"""Run fault scenarios (T09).

    # inject a YAML scenario in real time (time scale must match the simulation)
    python scripts/run_scenario.py scenarios/demo_bearing_M3.yaml --time-scale 60

    # print the schedule without sending anything
    python scripts/run_scenario.py scenarios/cascade_jam_overheat.yaml --dry-run

    # generate 200 reproducible scenarios for dataset v1 (T12)
    python scripts/run_scenario.py --generate 200 --seed 42 --out data/scenarios
"""
from __future__ import annotations

import argparse
from pathlib import Path

from roottwin.faults import generate_scenarios, load_scenario, run_scenario


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("scenario", nargs="?", help="YAML scenario file")
    p.add_argument("--time-scale", type=float, default=60.0, help="sim seconds per real second")
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--host", default=None)
    p.add_argument("--port", type=int, default=None)
    p.add_argument("--generate", type=int, metavar="N")
    p.add_argument("--seed", type=int, default=42)
    p.add_argument("--out", default="data/scenarios")
    a = p.parse_args()

    if a.generate:
        out = Path(a.out)
        out.mkdir(parents=True, exist_ok=True)
        scs = generate_scenarios(a.generate, seed=a.seed)
        for sc in scs:
            (out / f"{sc.scenario_id}.yaml").write_text(sc.to_yaml(), encoding="utf-8")
        n_faults = sum(len(s.faults) for s in scs)
        print(f"wrote {len(scs)} scenarios ({n_faults} faults) to {out}/")
        return

    if not a.scenario:
        p.error("give a scenario file or --generate N")
    sc = load_scenario(a.scenario)
    print(f"{sc.scenario_id}: {len(sc.faults)} fault(s), duration {sc.duration_min} sim-min, "
          f"x{a.time_scale} -> {sc.duration_min * 60 / a.time_scale:.0f} s real")
    for f in sc.faults:
        print(f"  t={f.at_min:>6.1f} min  {f.machine_id}  {f.fault_code}")
    if a.dry_run:
        return

    from roottwin.mqtt import MqttPublisher
    with MqttPublisher(a.host, a.port, client_id="roottwin-scenario") as pub:
        def send(line, machine, cmd):
            topic = pub.send_command(line, machine, cmd)
            print(f"  sent {cmd.params['fault_code']} -> {topic}")
        run_scenario(sc, send, time_scale=a.time_scale)


if __name__ == "__main__":
    main()
