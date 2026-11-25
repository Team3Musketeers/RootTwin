"""Command line for the factory simulation (Person A).

Live line (needs `docker compose up -d` for the MQTT broker):
    python -m roottwin.sim live --time-scale 60 --order 500
    python -m roottwin.sim live --scenario scenarios/demo_bearing_M3.yaml --order 5000
    python -m roottwin.sim live --no-mqtt --seconds 20 --order 200        # no broker: prints the state

Labelled dataset (no broker needed; --db loads it into TimescaleDB too):
    python -m roottwin.sim dataset --scenario scenarios/cascade_jam_overheat.yaml --out data/processed/cascade.parquet
    python -m roottwin.sim dataset --generate 200 --seed 42 --jobs 4 --db         # dataset v1 (T12)
"""
from __future__ import annotations

import argparse
import logging
import os
import sys
import time
from pathlib import Path

from roottwin.faults.scenario import generate_scenarios, load_scenario
from roottwin.sim.factory import Factory
from roottwin.sim.layout import LAYOUT_PATH, load_layout
from roottwin.sim.runner import LiveRunner, ScalableRealtimeEnvironment, simulate_many
from roottwin.sim.sinks import MqttSink, NullSink

log = logging.getLogger("roottwin.sim")


def status_line(f: Factory) -> str:
    k = f.kpis()
    open_orders = sum(1 for o in f.orders.values() if o.done_s is None)
    machines = " ".join(f"{m.id}:{m.state}/{m.activity}" for m in f.machines.values())
    return (f"t={f.env.now / 60:8.1f} sim-min  {f.status:<7} x{f.time_scale:g}  orders open={open_orders}  "
            f"ok={k.parts_ok} scrap={k.parts_scrap} wip={k.wip} {k.throughput_per_h:.0f}/h  {machines}")


def cmd_live(a: argparse.Namespace) -> None:
    env = ScalableRealtimeEnvironment(a.time_scale)
    client = None
    sink = NullSink()
    if not a.no_mqtt:
        import paho.mqtt.client as mqtt

        client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=f"roottwin-sim-{a.line}-{os.getpid()}")
        client.reconnect_delay_set(min_delay=1, max_delay=10)
        sink = MqttSink(client)
    scenario = load_scenario(a.scenario) if a.scenario else None
    factory = Factory(env, load_layout(a.layout), seed=a.seed, sink=sink,
                      scenario_id=scenario.scenario_id if scenario else a.scenario_id, wall_clock=True,
                      time_scale=a.time_scale, auto_repair=a.auto_repair, repair_response_min=a.response_min,
                      spontaneous_faults_per_h=a.spontaneous_faults)
    if factory.line_id != a.line:
        sys.exit(f"layout line_id is {factory.line_id}, not {a.line}")
    runner = LiveRunner(factory, env, snapshot_hz=a.snapshot_hz)

    if client is not None:
        cmd_topic = f"factory/{a.line}/+/cmd"

        def on_connect(c, userdata, flags, reason_code, properties):
            if reason_code.is_failure:
                log.error("MQTT connection refused: %s", reason_code)
                return
            c.subscribe(cmd_topic, qos=1)
            log.info("connected to MQTT %s:%s, listening on %s", a.host, a.port, cmd_topic)

        client.on_connect = on_connect
        client.on_message = runner.on_mqtt_message
        try:
            client.connect(a.host, a.port, keepalive=30)
        except OSError as exc:
            sys.exit(f"cannot reach the MQTT broker at {a.host}:{a.port} ({exc}).\n"
                     "Start it with `docker compose up -d`, or run with --no-mqtt.")
        client.loop_start()

    if a.order:
        factory.create_order(a.order, product=a.product)
    if scenario:
        factory.schedule_scenario(scenario)
        log.info("scenario %s: %d fault(s) scheduled", scenario.scenario_id, len(scenario.faults))

    last = [0.0]

    def printer(r: LiveRunner) -> None:
        if time.monotonic() - last[0] >= a.print_every:
            print(status_line(r.f), flush=True)
            last[0] = time.monotonic()

    print(f"simulation {a.line} x{a.time_scale:g} (Ctrl+C to stop)"
          + ("" if client is None else f", MQTT {a.host}:{a.port}"), flush=True)
    try:
        runner.run(seconds=a.seconds or None, on_tick=printer)
    except KeyboardInterrupt:
        pass
    finally:
        runner.publish_snapshot()
        if client is not None:
            time.sleep(0.3)        # let paho flush the last messages
            client.loop_stop()
            client.disconnect()
    print(status_line(factory))


def cmd_dataset(a: argparse.Namespace) -> None:
    if a.scenario:
        scenarios = [load_scenario(p) for p in a.scenario]
    else:
        scenarios = generate_scenarios(a.generate, seed=a.seed, duration_min=a.duration_min)
    t0 = time.perf_counter()
    kw = dict(layout=load_layout(a.layout), auto_repair=not a.no_auto_repair, repair_response_min=a.response_min)
    if a.db:
        from roottwin.sim.dataset import connect, generate_dataset

        try:
            conn = connect(a.db_url)
        except Exception as exc:   # psycopg2.OperationalError
            sys.exit(f"cannot reach TimescaleDB ({str(exc).strip()}). Start it with `docker compose up -d`.")

        def progress(i: int, n: int) -> None:
            if i % 10 == 0 or i == n:
                print(f"  {i}/{n} scenarios loaded ({time.perf_counter() - t0:.0f}s)", flush=True)

        try:
            df = generate_dataset(scenarios, jobs=a.jobs, conn=conn, progress=progress, **kw)
        finally:
            conn.close()
    else:
        df = simulate_many(scenarios, jobs=a.jobs, **kw)
    out = Path(a.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    if out.suffix == ".csv":
        df.to_csv(out, index=False)
    else:
        df.to_parquet(out, index=False)
    print(f"{len(scenarios)} scenario(s), {len(df):,} rows in {time.perf_counter() - t0:.1f}s -> {out}"
          + (" + TimescaleDB" if a.db else ""))
    print(f"label=1: {df['label'].mean():.1%} of rows · states: {df['state'].value_counts().to_dict()}")


def main(argv: list[str] | None = None) -> None:
    p = argparse.ArgumentParser(prog="python -m roottwin.sim", description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--layout", default=str(LAYOUT_PATH), help="line layout YAML")
    p.add_argument("--log-level", default="INFO")
    sub = p.add_subparsers(dest="mode", required=True)

    live = sub.add_parser("live", help="real-time line on MQTT")
    live.add_argument("--host", default=os.getenv("MQTT_HOST", "localhost"))
    live.add_argument("--port", type=int, default=int(os.getenv("MQTT_PORT", "1883")))
    live.add_argument("--line", default="line1")
    live.add_argument("--time-scale", type=float, default=60.0, help="simulated seconds per real second")
    live.add_argument("--order", type=int, default=0, help="create an order of N parts at start (0 = wait)")
    live.add_argument("--product", default="A")
    live.add_argument("--scenario", help="fault scenario YAML, injected at its simulated times")
    live.add_argument("--scenario-id", default=None, help="label for the published data")
    live.add_argument("--seconds", type=float, default=0, help="real seconds to run (0 = until Ctrl+C)")
    live.add_argument("--seed", type=int, default=0)
    live.add_argument("--auto-repair", action="store_true", help="repair down machines automatically")
    live.add_argument("--response-min", type=float, default=10.0, help="auto-repair response time")
    live.add_argument("--spontaneous-faults", type=float, default=0.0, metavar="PER_H",
                      help="random faults per machine-hour (grows with wear and speed); 0 = off")
    live.add_argument("--snapshot-hz", type=float, default=2.0)
    live.add_argument("--print-every", type=float, default=5.0, help="real seconds between status lines")
    live.add_argument("--no-mqtt", action="store_true", help="run without a broker")
    live.set_defaults(func=cmd_live)

    ds = sub.add_parser("dataset", help="labelled dataset from fault scenarios (fast, no MQTT)")
    ds.add_argument("--scenario", action="append", help="scenario YAML (repeatable)")
    ds.add_argument("--generate", type=int, default=200, help="number of generated scenarios")
    ds.add_argument("--seed", type=int, default=42)
    ds.add_argument("--duration-min", type=float, default=480)
    ds.add_argument("--jobs", type=int, default=1, help="parallel processes")
    ds.add_argument("--no-auto-repair", action="store_true")
    ds.add_argument("--response-min", type=float, default=10.0)
    ds.add_argument("--out", default="data/processed/sim_v1.parquet")
    ds.add_argument("--db", action="store_true", help="also load into TimescaleDB (idempotent)")
    ds.add_argument("--db-url", default=None, help="default: $DATABASE_URL or the docker compose DB")
    ds.set_defaults(func=cmd_dataset)

    a = p.parse_args(argv)
    logging.basicConfig(level=a.log_level, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    a.func(a)


if __name__ == "__main__":
    main()
