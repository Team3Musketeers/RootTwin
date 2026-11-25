"""Run the factory live (real time, MQTT commands) or offline (as fast as possible, labelled dataset)."""
from __future__ import annotations

import logging
import queue
import threading
import time
from datetime import datetime
from typing import Any, Callable

import simpy
import simpy.rt

from roottwin.contracts import Command, Topic, snapshot_topic
from roottwin.faults.scenario import Scenario
from roottwin.sim.factory import Factory
from roottwin.sim.layout import LineLayout
from roottwin.sim.sinks import NullSink, Recorder, Sink

log = logging.getLogger("roottwin.sim")


class ScalableRealtimeEnvironment(simpy.rt.RealtimeEnvironment):
    """simpy.rt environment whose speed can change while it runs (set_time_scale) and that can pause.

    time_scale = simulated seconds per real second (60 -> one simulated minute per second).
    """

    def __init__(self, time_scale: float = 1.0):
        if time_scale <= 0:
            raise ValueError("time_scale must be > 0")
        super().__init__(initial_time=0, factor=1.0 / time_scale, strict=False)

    @property
    def time_scale(self) -> float:
        return 1.0 / self._factor

    def resync(self) -> None:
        """Take the current simulated time as the new wall-clock reference (after a pause or a speed change)."""
        self.env_start = self.now
        self.real_start = time.monotonic()

    def set_time_scale(self, scale: float) -> None:
        if scale <= 0:
            raise ValueError("time_scale must be > 0")
        self.resync()
        self._factor = 1.0 / scale


class LiveRunner:
    """Real-time loop: applies queued commands, advances the clock, publishes the snapshot.

    Commands arrive on the MQTT thread and are only queued there; they are applied on the
    simulation thread every TICK_S real seconds (no locks inside the simulation).
    """

    TICK_S = 0.1

    def __init__(self, factory: Factory, env: ScalableRealtimeEnvironment, snapshot_hz: float = 2.0):
        if factory.env is not env:
            raise ValueError("the factory must be built on this environment")
        self.f = factory
        self.env = env
        factory.on_time_scale = env.set_time_scale
        factory.time_scale = env.time_scale
        self.commands: queue.Queue[tuple[str, Command]] = queue.Queue()
        self.snapshot_period = 1.0 / snapshot_hz if snapshot_hz > 0 else float("inf")
        self.applied: list[tuple[str, str, str | None]] = []   # (target, command, error)
        self._stop = threading.Event()

    def submit(self, target: str, cmd: Command) -> None:
        """Thread-safe: queue a command for the simulation thread."""
        self.commands.put((target, cmd))

    def on_mqtt_message(self, client: Any, userdata: Any, msg: Any) -> None:
        """paho on_message callback for factory/{line}/+/cmd."""
        try:
            topic = Topic.parse(msg.topic)
            cmd = Command.model_validate_json(msg.payload)
        except ValueError as exc:   # pydantic.ValidationError is a ValueError
            log.warning("ignored bad command on %s: %s", msg.topic, str(exc).splitlines()[0])
            return
        if topic.kind == "cmd" and topic.line_id == self.f.line_id:
            self.submit(topic.machine_id, cmd)

    def stop(self) -> None:
        self._stop.set()

    def _drain(self) -> None:
        while True:
            try:
                target, cmd = self.commands.get_nowait()
            except queue.Empty:
                return
            err = self.f.apply_command(target, cmd)
            self.applied.append((target, cmd.command, err))
            if err:
                log.warning("command %s -> %s rejected: %s", cmd.command, target, err)
            else:
                log.info("command %s %s -> %s (by %s)", cmd.command, cmd.params or "", target, cmd.issued_by)

    def publish_snapshot(self):
        snap = self.f.snapshot()
        self.f.sink.publish(snapshot_topic(self.f.line_id), snap.model_dump(mode="json"), qos=0, retain=True)
        return snap

    def run(self, seconds: float | None = None,
            on_tick: Callable[["LiveRunner"], None] | None = None) -> None:
        """Run until stop() or for `seconds` real seconds."""
        end = time.monotonic() + seconds if seconds else None
        self.env.resync()
        last_snapshot = float("-inf")
        paused = False
        while not self._stop.is_set() and (end is None or time.monotonic() < end):
            self._drain()
            if self.f.status == "paused":          # the simulated clock is frozen
                paused = True
                time.sleep(self.TICK_S)
            else:
                if paused:
                    self.env.resync()
                    paused = False
                self.env.run(until=self.env.now + self.env.time_scale * self.TICK_S)
            if time.monotonic() - last_snapshot >= self.snapshot_period:
                self.publish_snapshot()
                last_snapshot = time.monotonic()
            if on_tick:
                on_tick(self)


def simulate_scenario(scenario: Scenario, *, layout: LineLayout | None = None,
                      order_quantity: int = 1_000_000, auto_repair: bool = True,
                      repair_response_min: float = 10.0, telemetry_period_s: float = 60.0,
                      sink: Sink | None = None, start_ts: datetime | None = None):
    """Run one fault scenario as fast as possible -> labelled DataFrame, one row per (minute, machine).

    Same columns as roottwin.faults.offline.simulate (+ activity, health, speed_factor), so B's
    training scripts can switch to the real simulation as is. A down machine is repaired by a
    corrective policy (response time + catalogue repair time), like the offline stand-in.
    """
    recorder = Recorder()
    f = Factory(simpy.Environment(), layout, seed=scenario.seed, sink=sink or NullSink(), recorder=recorder,
                scenario_id=scenario.scenario_id, start_ts=start_ts, telemetry_period_s=telemetry_period_s,
                auto_repair=auto_repair, repair_response_min=repair_response_min)
    f.create_order(order_quantity, order_id=f"{scenario.scenario_id}-ORDER")
    f.schedule_scenario(scenario)
    f.env.run(until=scenario.duration_min * 60.0 + 1e-6)
    return recorder.to_frame()


def simulate_many(scenarios: list[Scenario], jobs: int = 1, **kw):
    """Several scenarios, optionally in parallel processes (each scenario has its own seed)."""
    import pandas as pd

    if jobs <= 1:
        frames = [simulate_scenario(s, **kw) for s in scenarios]
    else:
        from concurrent.futures import ProcessPoolExecutor
        from functools import partial

        with ProcessPoolExecutor(max_workers=jobs) as pool:
            frames = list(pool.map(partial(simulate_scenario, **kw), scenarios, chunksize=4))
    return pd.concat(frames, ignore_index=True)
