"""SimPy factory (T03, Person A): orders, tracked parts, machines, conveyors, buffers, commands.

    orders -> feeder -> [raw] M1 -> C1 -> [buf] M2 -> C2 -> ... -> M6 -> exit

The same Factory runs
- in real time (runner.LiveRunner on simpy.rt): driven by MQTT commands (T33), it
  publishes telemetry, events, production and the snapshot the 3D scene reads;
- as fast as possible (runner.simulate_scenario): fault scenarios -> labelled dataset (T12).

Faults come from B's catalogue (roottwin/faults/catalog.yaml) through ActiveFault: the
fault gives the sensor signature and the health state (ok / degraded / down). Here a
"down" machine really stops, so the machines downstream STARVE and the ones upstream
get BLOCKED once the buffers are full: the propagation that root-cause diagnosis (T15)
has to see through.
"""
from __future__ import annotations

import itertools
import math
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Callable

import numpy as np
import simpy

from roottwin.contracts import (LINE_TARGET, Command, ConveyorSnapshot, LineKpis, MachineSnapshot,
                                OrderSnapshot, PartOnConveyor, Snapshot)
from roottwin.faults.models import ActiveFault, FaultSpec, load_catalog, worst_state
from roottwin.sim.layout import LineLayout, LinkConfig, MachineConfig, build_graph, load_layout
from roottwin.sim.primitives import Buffer, Gate, Signal, TimeShare
from roottwin.sim.sensors import SensorModel, Wear
from roottwin.sim.sinks import NullSink, Recorder, Sink

SEVERITY = {"ok": 1, "maintenance": 2, "degraded": 3, "down": 5}
DEFAULT_REPAIR_MIN = 10.0     # repair asked on a machine with no active fault (check-up)
PM_MIN = 20.0                 # preventive maintenance duration
PM_COST_EUR = 80.0
INSPECT_MIN = 5.0
TRAVEL_MIN = 2.0              # worker travel for dispatch_worker (stand-in until T12 workers)
REPAIR_WEAR_KEEP = 0.5        # a repair keeps half of the natural wear, a replacement none
HALTS_CONVEYOR = {"CONVEYOR_JAM"}   # faults that also stop the machine's outgoing conveyor
CADENCE_WINDOW_S = 60.0
DEFAULT_START = datetime(2026, 1, 5, 6, 0, tzinfo=timezone.utc)   # Monday, morning shift
_EPS_S = 1e-3


@dataclass
class Part:
    part_id: str
    order_id: str
    product: str
    created_s: float
    defect_by: str | None = None          # machine that made the part defective
    route: list[str] = field(default_factory=list)


@dataclass
class Order:
    order_id: str
    product: str
    quantity: int
    created_s: float
    released: int = 0
    completed: int = 0
    scrap: int = 0
    started_s: float | None = None
    done_s: float | None = None

    @property
    def needs_parts(self) -> bool:
        """Scrapped parts are replaced: release until good-or-in-flight parts = quantity."""
        return self.done_s is None and self.released - self.scrap < self.quantity

    @property
    def status(self) -> str:
        if self.done_s is not None:
            return "done"
        return "in_progress" if self.released else "queued"

    def info(self) -> dict[str, Any]:
        return {"order_id": self.order_id, "product": self.product, "quantity": self.quantity,
                "completed": self.completed, "scrap": self.scrap}

    def snapshot(self) -> OrderSnapshot:
        return OrderSnapshot(order_id=self.order_id, product=self.product, quantity=self.quantity,
                             released=self.released, completed=self.completed, scrap=self.scrap,
                             status=self.status)


class Machine:
    """One workstation: takes a part from its input buffer, processes it, puts it on its conveyor."""

    def __init__(self, factory: "Factory", cfg: MachineConfig, inp: Buffer, index: int):
        self.f = factory
        self.env = factory.env
        self.cfg = cfg
        self.id = cfg.machine_id
        self.inp = inp
        self.out: Conveyor | LineExit | None = None
        self.rng = np.random.default_rng([factory.seed, index])
        self.speed = 1.0
        self.stopped = False                  # stop_machine / start_machine
        self.maintenance: str | None = None   # action in progress (repair, replace, preventive_maintenance)
        self._maintenance_pending = False     # worker on the way
        self.faults: list[ActiveFault] = []
        self.wear = Wear(cfg.wear, self.rng)
        self.sensors = SensorModel(cfg.sensors, cfg.wear, self.rng)
        self.gate = Gate(self.env, True)      # open = allowed to process
        self.state = "ok"                     # ok | degraded | down | maintenance
        self.proc_activity = "starved"        # what the process is doing when it is allowed to work
        self.current: Part | None = None
        self.processed = 0
        self.scrap_made = 0
        self.work_s = 0.0
        self.down_clock = TimeShare(self.env)
        self.last_sensors: dict[str, float] = {}
        self._cycle_total = 0.0
        self._cycle_left = 0.0
        self._seg_start: float | None = None
        self._finish_times: deque[float] = deque()
        self._last_sample = (self.env.now, 0.0)
        self._prod = [0, 0]                   # parts ok / scrap since the last production message
        self._start_s = self.env.now
        cv = cfg.cycle_cv
        self._sigma = math.sqrt(math.log1p(cv * cv)) if cv > 0 else 0.0
        self.env.process(self._run())

    # ------------------------------------------------------------------ process
    def _run(self):
        env = self.env
        while True:
            if not self.gate.is_open:
                yield self.gate.opened()
                continue
            self.proc_activity = "starved"
            part = yield self.inp.get()
            self.current = part
            ct = self._cycle_time()
            self._cycle_total = self._cycle_left = ct
            while self._cycle_left > 1e-9:
                if not self.gate.is_open:              # down, stopped, maintenance, line stopped
                    yield self.gate.opened()
                    continue
                self.proc_activity = "working"
                self._seg_start = env.now
                yield env.timeout(self._cycle_left) | self.gate.closed()
                elapsed = env.now - self._seg_start
                self._seg_start = None
                self.work_s += elapsed
                self._cycle_left = max(0.0, self._cycle_left - elapsed)
            self.wear.advance(ct, self.speed)
            if self._finish(part):
                self.proc_activity = "blocked"         # finished part waits for a free conveyor slot
                yield self.out.load(part)
            self.current = None

    def _cycle_time(self) -> float:
        mean = self.cfg.cycle_s / self.speed
        if self._sigma == 0:
            return mean
        return float(self.rng.lognormal(math.log(mean) - self._sigma ** 2 / 2, self._sigma))

    def _finish(self, part: Part) -> bool:
        """Count the part; returns False when it leaves the flow (scrapped at inspection)."""
        now = self.env.now
        self.processed += 1
        self._finish_times.append(now)
        part.route.append(self.id)
        rate = max((af.scrap_rate(now / 60.0) for af in self.faults), default=0.0)
        if rate > 0 and part.defect_by is None and self.rng.random() < rate:
            part.defect_by = self.id
            self.scrap_made += 1
            self._prod[1] += 1
        else:
            self._prod[0] += 1
        if self.cfg.machine_type == "inspection" and part.defect_by is not None:
            self.f._scrap(part)
            return False
        return True

    # ------------------------------------------------------------------ state
    @property
    def available(self) -> bool:
        return (self.f.status == "running" and not self.stopped and self.maintenance is None
                and self.state != "down")

    @property
    def activity(self) -> str:
        if self.maintenance:
            return "maintenance"
        if self.state == "down":
            return "down"
        if self.stopped or self.f.status != "running":
            return "stopped"
        return self.proc_activity

    @property
    def jammed(self) -> bool:
        return any(af.code in HALTS_CONVEYOR for af in self.faults)

    def refresh(self) -> None:
        self.gate.set(self.available)
        if isinstance(self.out, Conveyor):
            self.out.refresh()

    def fault_state(self) -> str:
        return worst_state([af.state(self.env.now / 60.0) for af in self.faults])

    def dominant_fault(self) -> str | None:
        """Code of the fault driving the state (the most severe; the latest on ties)."""
        rank = {"ok": 0, "degraded": 1, "down": 2}
        now_min = self.env.now / 60.0
        best = None
        for af in self.faults:
            if best is None or rank[af.state(now_min)] >= rank[best.state(now_min)]:
                best = af
        return best.code if best else None

    def update_state(self) -> None:
        new = "maintenance" if self.maintenance else self.fault_state()
        old = self.state
        if new != old:
            self.state = new
            self.down_clock.set(new in ("down", "maintenance"))
            code = self.dominant_fault()
            self.f.emit_event(self.id, "state_change", state=new, fault_code=code,
                              severity=SEVERITY[new], payload={"previous": old})
            if new == "down":
                self.f.emit_event(self.id, "failure", state="down", fault_code=code, severity=5)
                if self.f.auto_repair:
                    self.env.process(self._auto_repair())
        self.refresh()
        self.f._update_clocks()

    def _wake_at(self, t_s: float):
        yield self.env.timeout(max(0.0, t_s - self.env.now))
        self.update_state()

    # ------------------------------------------------------------------ faults
    def inject(self, code: str, ramp_min: float | None = None, severity: int | None = None,
               issued_by: str = "ui", command_id: str | None = None) -> str | None:
        spec = self.f.catalog.get(code)
        if spec is None:
            return f"unknown fault_code '{code}'"
        if any(af.code == code for af in self.faults):
            return f"{code} is already active on {self.id}"
        now_min = self.env.now / 60.0
        self.faults.append(ActiveFault(spec, self.id, start_min=now_min, ramp_min=ramp_min))
        ramp = ramp_min or spec.ramp_min
        self.f.emit_event(self.id, "fault_injected", fault_code=code, severity=severity or 3,
                          payload={"injected_by": issued_by, "ramp_min": ramp, "command_id": command_id})
        for frac in (spec.degraded_at, 1.0):               # exact state transition times
            t_s = (now_min + frac * ramp) * 60.0 + _EPS_S
            if t_s > self.env.now + _EPS_S:
                self.env.process(self._wake_at(t_s))
        self.update_state()
        return None

    def clear_faults(self, issued_by: str = "ui") -> str | None:
        if not self.faults:
            return f"no active fault on {self.id}"
        codes = [af.code for af in self.faults]
        self.faults.clear()
        self.f.emit_event(self.id, "fault_cleared", fault_code=codes[-1], severity=1,
                          payload={"fault_codes": codes, "decided_by": issued_by})
        self.update_state()
        return None

    def _spontaneous(self, per_h: float, rng: np.random.Generator):
        """Optional random faults; hazard grows with wear and speed (couples speed -> failures)."""
        codes = sorted(c for c, s in self.f.catalog.items() if s.onset == "gradual" and s.family != "sensor")
        while True:
            yield self.env.timeout(60.0)
            if self.faults or not self.available:
                continue
            hazard_s = per_h / 3600.0 * math.exp(3.0 * self.wear.value) * self.speed ** 2
            if rng.random() < -math.expm1(-hazard_s * 60.0):
                self.inject(str(rng.choice(codes)), issued_by="spontaneous")

    # ------------------------------------------------------------------ maintenance
    def start_maintenance(self, action: str, *, issued_by: str, command_id: str | None = None,
                          worker_id: str | None = None, travel_min: float = 0.0) -> str | None:
        if self.maintenance or self._maintenance_pending:
            return f"{self.id} is already in maintenance"
        self._maintenance_pending = True
        self.env.process(self._maintain(action, issued_by, command_id, worker_id, travel_min))
        return None

    def _maintain(self, action: str, issued_by: str, command_id: str | None, worker_id: str | None,
                  travel_min: float):
        if travel_min > 0:
            yield self.env.timeout(travel_min * 60.0)
        codes = [af.code for af in self.faults]
        specs = [af.spec.repair for af in self.faults]
        fault_min = max((r.minutes for r in specs), default=0.0)
        if action == "preventive_maintenance":
            minutes, cost, keep = max(PM_MIN, fault_min), PM_COST_EUR + sum(r.cost_eur for r in specs), 0.0
        else:
            minutes, cost = fault_min or DEFAULT_REPAIR_MIN, sum(r.cost_eur for r in specs)
            keep = 0.0 if action == "replace" or any(r.action == "replace" for r in specs) else REPAIR_WEAR_KEEP
        info = {"action": action, "minutes": minutes, "cost_eur": cost, "fault_codes": codes,
                "decided_by": issued_by, "worker_id": worker_id, "command_id": command_id}
        self._maintenance_pending = False
        self.maintenance = action
        self.f.emit_event(self.id, "repair_start", fault_code=codes[-1] if codes else None, severity=2,
                          payload=info)
        self.update_state()
        yield self.env.timeout(minutes * 60.0)
        self.faults.clear()
        self.wear.reset(keep=keep)
        self.maintenance = None
        self.f.emit_event(self.id, "repair_end", fault_code=codes[-1] if codes else None, severity=1,
                          payload=info)
        self.update_state()

    def _auto_repair(self):
        """Corrective policy for datasets: someone repairs a down machine after a response time."""
        yield self.env.timeout(self.f.repair_response_min * 60.0)
        if self.state == "down" and not self.maintenance and not self._maintenance_pending:
            self.start_maintenance("repair", issued_by="baseline")

    def _inspect(self, issued_by: str, command_id: str | None, worker_id: str | None):
        yield self.env.timeout((TRAVEL_MIN + INSPECT_MIN) * 60.0)
        now_min = self.env.now / 60.0
        found = [{"fault_code": af.code, "progress": round(af.progress(now_min), 3),
                  "state": af.state(now_min)} for af in self.faults]
        self.f.emit_event(self.id, "inspection", fault_code=self.dominant_fault(),
                          severity=3 if found else 1,
                          payload={"found": found, "health": round(self.wear.health, 3),
                                   "decided_by": issued_by, "worker_id": worker_id, "command_id": command_id})

    # ------------------------------------------------------------------ commands
    def apply(self, cmd: Command) -> str | None:
        c, p = cmd.command, cmd.params
        if c == "start_machine":
            self.stopped = False
        elif c == "stop_machine":
            self.stopped = True
        elif c == "set_speed":
            self.speed = float(p["factor"])
        elif c == "set_buffer":
            return self.f.set_buffer_after(self.id, int(p["capacity"]))
        elif c == "inject_fault":
            return self.inject(p["fault_code"], p.get("ramp_min"), p.get("severity"),
                               cmd.issued_by, cmd.command_id)
        elif c == "clear_fault":
            return self.clear_faults(cmd.issued_by)
        elif c in ("repair", "preventive_maintenance"):
            return self.start_maintenance(c, issued_by=cmd.issued_by, command_id=cmd.command_id)
        elif c == "dispatch_worker":
            action = p.get("action", "repair")
            if action == "inspect":
                self.env.process(self._inspect(cmd.issued_by, cmd.command_id, p.get("worker_id")))
                return None
            return self.start_maintenance(action, issued_by=cmd.issued_by, command_id=cmd.command_id,
                                          worker_id=p.get("worker_id"), travel_min=TRAVEL_MIN)
        else:
            return f"'{c}' is not a machine command"
        self.refresh()
        return None

    # ------------------------------------------------------------------ sensors / snapshot
    def work_time(self) -> float:
        return self.work_s + (self.env.now - self._seg_start if self._seg_start is not None else 0.0)

    def cadence(self) -> float:
        """Parts finished during the last minute (parts/min)."""
        now = self.env.now
        while self._finish_times and self._finish_times[0] < now - CADENCE_WINDOW_S:
            self._finish_times.popleft()
        window = max(min(CADENCE_WINDOW_S, now - self._start_s), 10.0)
        return len(self._finish_times) * 60.0 / window

    def sample(self) -> dict[str, float]:
        now = self.env.now
        t_prev, w_prev = self._last_sample
        work = self.work_time()
        dt = now - t_prev
        load = (work - w_prev) / dt if dt > 0 else 0.0
        self._last_sample = (now, work)
        vals = self.sensors.sample(dt, load, self.speed, self.wear.value, self.available, self.cadence())
        for af in self.faults:
            vals = af.apply(vals, now / 60.0, self.rng)
        self.last_sensors = {k: round(float(v), 3) for k, v in vals.items()}
        return self.last_sensors

    def snapshot(self) -> MachineSnapshot:
        progress = 0.0
        if self.current is not None and self._cycle_total > 0:
            left = self._cycle_left - (self.env.now - self._seg_start if self._seg_start is not None else 0.0)
            progress = min(max(1.0 - left / self._cycle_total, 0.0), 1.0)
        return MachineSnapshot(
            machine_id=self.id, name=self.cfg.name, machine_type=self.cfg.machine_type,
            position=self.cfg.position, state=self.state, activity=self.activity,
            speed_factor=self.speed, health=round(self.wear.health, 4), sensors=dict(self.last_sensors),
            active_faults=[af.code for af in self.faults],
            current_part=self.current.part_id if self.current else None, cycle_progress=round(progress, 4),
            buffer_in=len(self.inp), buffer_in_capacity=self.inp.capacity,
            parts_ok=self.processed - self.scrap_made, parts_scrap=self.scrap_made,
            downtime_s=round(self.down_clock.total(), 1))


class Conveyor:
    """Accumulating belt between two machines.

    Parts move together while the belt runs; the head waits at the end when the next
    buffer is full and the others queue behind it. `belt_time` only advances while
    the belt moves, so a halted belt (line stopped, jam) freezes the parts in place.
    """

    def __init__(self, factory: "Factory", cfg: LinkConfig, down: Buffer, upstream: Machine):
        self.f = factory
        self.env = factory.env
        self.cfg = cfg
        self.id = cfg.conveyor_id
        self.down = down
        self.upstream = upstream
        self.entries: deque[tuple[Part, float]] = deque()    # (part, belt time when loaded)
        self._waiting: deque[tuple[simpy.Event, Part]] = deque()
        self._belt = 0.0
        self._since = self.env.now
        self.moving = True
        self.gate = Gate(self.env, True)
        self._added = Signal(self.env)
        self.env.process(self._run())

    def belt_time(self) -> float:
        return self._belt + (self.env.now - self._since if self.moving else 0.0)

    def refresh(self) -> None:
        moving = self.f.status == "running" and not self.upstream.jammed
        if moving == self.moving:
            return
        self._belt = self.belt_time()
        self._since = self.env.now
        self.moving = moving
        self.gate.set(moving)

    def load(self, part: Part) -> simpy.Event:
        ev = self.env.event()
        if len(self.entries) < self.cfg.slots:
            self._enter(part)
            ev.succeed()
        else:
            self._waiting.append((ev, part))
        return ev

    def _enter(self, part: Part) -> None:
        self.entries.append((part, self.belt_time()))
        self._added.fire()

    def _run(self):
        while True:
            if not self.entries:
                yield self._added.wait()
                continue
            if not self.moving:
                yield self.gate.opened()
                continue
            part, loaded_at = self.entries[0]
            due = self.cfg.transit_s - (self.belt_time() - loaded_at)
            if due > 1e-9:
                yield self.env.timeout(due) | self.gate.closed()
                continue
            yield self.down.put(part)          # waits while the next buffer is full
            self.entries.popleft()
            if self._waiting:
                ev, nxt = self._waiting.popleft()
                self._enter(nxt)
                ev.succeed()

    def snapshot(self) -> ConveyorSnapshot:
        belt, pitch = self.belt_time(), 1.0 / self.cfg.slots
        parts, prev = [], None
        for part, loaded_at in self.entries:
            pos = min(1.0, (belt - loaded_at) / self.cfg.transit_s)
            if prev is not None:
                pos = min(pos, prev - pitch)   # parts cannot overlap when they accumulate
            pos = max(0.0, pos)
            prev = pos
            parts.append(PartOnConveyor(part_id=part.part_id, order_id=part.order_id, pos=round(pos, 4),
                                        defect=part.defect_by is not None))
        return ConveyorSnapshot(conveyor_id=self.id, from_id=self.cfg.from_id, to_id=self.cfg.to_id,
                                moving=self.moving, transit_s=self.cfg.transit_s, parts=parts)


class LineExit:
    """End of the line: finished parts leave the simulation."""

    def __init__(self, factory: "Factory"):
        self.f = factory

    def load(self, part: Part) -> simpy.Event:
        self.f._exit(part)
        ev = self.f.env.event()
        ev.succeed()
        return ev


class Factory:
    """The whole line. Build it on a simpy.Environment (fast) or a RealtimeEnvironment (live)."""

    def __init__(self, env: simpy.Environment | None = None, layout: LineLayout | None = None, *,
                 seed: int = 0, sink: Sink | None = None, recorder: Recorder | None = None,
                 scenario_id: str | None = None, start_ts: datetime | None = None,
                 wall_clock: bool = False, time_scale: float = 0.0,
                 telemetry_period_s: float | None = None, auto_repair: bool = False,
                 repair_response_min: float = 10.0, spontaneous_faults_per_h: float = 0.0,
                 catalog: dict[str, FaultSpec] | None = None):
        self.env = env or simpy.Environment()
        self.layout = layout or load_layout()
        self.line_id = self.layout.line_id
        self.graph = build_graph(self.layout)
        self.catalog = catalog or load_catalog()
        self.seed = seed
        self.sink: Sink = sink or NullSink()
        self.recorder = recorder
        self.scenario_id = scenario_id
        self.start_ts = start_ts or DEFAULT_START
        self.wall_clock = wall_clock               # live: ts = now; datasets: ts = start_ts + sim time
        self.time_scale = time_scale               # informative here; the live runner applies it
        self._fixed_period = telemetry_period_s
        self.auto_repair = auto_repair
        self.repair_response_min = repair_response_min
        self.spontaneous_faults_per_h = spontaneous_faults_per_h
        self.on_time_scale: Callable[[float], None] | None = None   # set by the live runner
        self.status = "running"                    # running | stopped | paused
        self.orders: dict[str, Order] = {}
        self.released = self.parts_ok = self.parts_scrap = 0
        self.t0 = self.env.now
        self._seq = 0
        self._part_seq = itertools.count(1)
        self._exit_times: deque[float] = deque()
        self._wakeup = Signal(self.env)            # new order, scrap to replace, line restarted
        self.running_clock = TimeShare(self.env, True)
        self.planned_clock = TimeShare(self.env, False)
        self.line_down_clock = TimeShare(self.env, False)

        order = self.layout.flow_order
        buffers = {mid: Buffer(self.env, self.layout.machine(mid).input_buffer) for mid in order}
        self.machines: dict[str, Machine] = {
            mid: Machine(self, self.layout.machine(mid), buffers[mid], i) for i, mid in enumerate(order)}
        self.conveyors: dict[str, Conveyor] = {}
        for link in sorted(self.layout.links, key=lambda l: order.index(l.from_id)):
            conv = Conveyor(self, link, buffers[link.to_id], self.machines[link.from_id])
            self.machines[link.from_id].out = conv
            self.conveyors[conv.id] = conv
        for m in self.machines.values():
            if m.out is None:
                m.out = LineExit(self)
        self.first = self.machines[order[0]]
        self.last = self.machines[order[-1]]
        self.ideal_cycle_s = max(m.cfg.cycle_s for m in self.machines.values())   # bottleneck

        self.env.process(self._feeder())
        self.env.process(self._telemetry())
        if spontaneous_faults_per_h > 0:
            for i, m in enumerate(self.machines.values()):
                self.env.process(m._spontaneous(spontaneous_faults_per_h,
                                                np.random.default_rng([seed, i, 1])))

    # ------------------------------------------------------------------ output
    def ts(self) -> datetime:
        if self.wall_clock:
            return datetime.now(timezone.utc)
        return self.start_ts + timedelta(seconds=self.env.now - self.t0)

    def emit(self, machine_id: str, kind: str, body: dict[str, Any], *, qos: int = 1,
             retain: bool = False) -> None:
        msg = {"ts": self.ts().isoformat(), "source": "sim", **body}
        if self.scenario_id:
            msg["scenario_id"] = self.scenario_id
        self.sink.publish(f"factory/{self.line_id}/{machine_id}/{kind}", msg, qos=qos, retain=retain)

    def emit_event(self, machine_id: str, event_type: str, *, state: str | None = None,
                   fault_code: str | None = None, severity: int | None = None,
                   payload: dict[str, Any] | None = None) -> None:
        body: dict[str, Any] = {"event_type": event_type,
                                "payload": {**(payload or {}), "sim_s": round(self.env.now, 3)}}
        if state:
            body["state"] = state
        if fault_code:
            body["fault_code"] = fault_code
        if severity:
            body["severity"] = severity
        self.emit(machine_id, "event", body)

    @property
    def telemetry_period_s(self) -> float:
        """Fixed if given; else about one message per machine per real second (1..60 sim s)."""
        if self._fixed_period:
            return self._fixed_period
        return min(60.0, max(1.0, self.time_scale)) if self.time_scale > 0 else 60.0

    def _telemetry(self):
        while True:
            yield self.env.timeout(self.telemetry_period_s)
            self.publish_telemetry()

    def publish_telemetry(self) -> None:
        now_min = self.env.now / 60.0
        for m in self.machines.values():
            vals = m.sample()
            self.emit(m.id, "telemetry", {"sensors": vals, "sim_s": round(self.env.now, 1)})
            ok, scrap = m._prod
            if ok or scrap:
                self.emit(m.id, "production", {"parts_ok": ok, "parts_scrap": scrap})
                m._prod = [0, 0]
            if self.recorder is not None:
                codes = [af.code for af in m.faults]
                self.recorder.record(scenario_id=self.scenario_id, t_min=round(now_min, 4), machine_id=m.id,
                                     **vals, state=m.state, fault_code=codes[-1] if codes else None,
                                     label=int(bool(codes)), activity=m.activity,
                                     health=round(m.wear.health, 4), speed_factor=m.speed)

    # ------------------------------------------------------------------ orders & parts
    @property
    def wip(self) -> int:
        return self.released - self.parts_ok - self.parts_scrap

    def create_order(self, quantity: int, product: str = "A", order_id: str | None = None) -> str | None:
        order_id = order_id or f"ORD-{len(self.orders) + 1:04d}"
        if order_id in self.orders:
            return f"order {order_id} already exists"
        if quantity < 1:
            return "quantity must be >= 1"
        self.orders[order_id] = Order(order_id, product, int(quantity), self.env.now)
        self._wakeup.fire()
        self._update_clocks()
        return None

    def _feeder(self):
        while True:
            if self.status != "running":
                yield self._wakeup.wait()
                continue
            order = next((o for o in self.orders.values() if o.needs_parts), None)
            if order is None:
                yield self._wakeup.wait()
                continue
            part = Part(f"P{next(self._part_seq):07d}", order.order_id, order.product, self.env.now)
            order.released += 1
            self.released += 1
            if order.started_s is None:
                order.started_s = self.env.now
                self.emit_event(self.first.id, "order_started", severity=1, payload=order.info())
            self._update_clocks()
            yield self.first.inp.put(part)

    def _scrap(self, part: Part) -> None:
        self.parts_scrap += 1
        self.orders[part.order_id].scrap += 1
        self._wakeup.fire()                       # the feeder releases a replacement
        self._update_clocks()

    def _exit(self, part: Part) -> None:
        if part.defect_by is not None:            # defect made after the inspection station
            self._scrap(part)
            return
        order = self.orders[part.order_id]
        self.parts_ok += 1
        order.completed += 1
        now = self.env.now
        self._exit_times.append(now)
        while self._exit_times and self._exit_times[0] < now - 3600.0:
            self._exit_times.popleft()
        if order.completed >= order.quantity and order.done_s is None:
            order.done_s = now
            started = order.started_s if order.started_s is not None else now
            self.emit_event(self.last.id, "order_completed", severity=1,
                            payload={**order.info(), "lead_time_s": round(now - started, 1)})
        self._update_clocks()

    # ------------------------------------------------------------------ line control
    def set_status(self, status: str) -> None:
        if status == self.status:
            return
        self.status = status
        for m in self.machines.values():
            m.refresh()
        self._wakeup.fire()
        self._update_clocks()

    def set_time_scale(self, scale: float) -> None:
        self.time_scale = float(scale)
        if self.on_time_scale:
            self.on_time_scale(self.time_scale)

    def set_buffer_after(self, machine_id: str, capacity: int) -> str | None:
        nxt = list(self.graph.successors(machine_id))
        if not nxt:
            return f"{machine_id} is the last machine: there is no buffer after it"
        self.machines[nxt[0]].inp.set_capacity(capacity)
        return None

    def _update_clocks(self) -> None:
        running = self.status == "running"
        planned = running and (self.wip > 0 or any(o.needs_parts for o in self.orders.values()))
        self.running_clock.set(running)
        self.planned_clock.set(planned)
        self.line_down_clock.set(planned and any(m.state in ("down", "maintenance")
                                                 for m in self.machines.values()))

    def apply_command(self, target: str, cmd: Command) -> str | None:
        """Apply one command (T33 contract). Returns None if applied, else why it was rejected."""
        c, p = cmd.command, cmd.params
        if cmd.is_line_command:
            if target != LINE_TARGET:
                return f"'{c}' is a line command: target must be {LINE_TARGET}"
            if c in ("start_line", "stop_line", "pause_line"):
                self.set_status({"start_line": "running", "stop_line": "stopped", "pause_line": "paused"}[c])
                return None
            if c == "create_order":
                return self.create_order(p["quantity"], p.get("product", "A"), p.get("order_id"))
            if c == "set_time_scale":
                self.set_time_scale(p["scale"])
                return None
            return f"unsupported line command '{c}'"
        m = self.machines.get(target)
        if m is None:
            return f"unknown machine '{target}' (line has {', '.join(self.machines)})"
        err = m.apply(cmd)
        if err:
            self.emit_event(m.id, "command_rejected", severity=2,
                            payload={"command": c, "params": p, "reason": err, "command_id": cmd.command_id,
                                     "issued_by": cmd.issued_by})
        return err

    def schedule_scenario(self, scenario) -> None:
        """Inject a roottwin.faults.Scenario's faults at their times (relative to now)."""
        start = self.env.now
        for i, f in enumerate(scenario.faults):
            if f.machine_id not in self.machines:
                raise ValueError(f"scenario {scenario.scenario_id}: unknown machine {f.machine_id}")
            params: dict[str, Any] = {"fault_code": f.fault_code}
            if f.ramp_min:
                params["ramp_min"] = f.ramp_min
            if f.severity:
                params["severity"] = f.severity
            cmd = Command(command="inject_fault", params=params, issued_by="scenario",
                          scenario_id=scenario.scenario_id, command_id=f"{scenario.scenario_id}-F{i:02d}")
            self.env.process(self._at(start + f.at_min * 60.0, f.machine_id, cmd))

    def _at(self, t_s: float, target: str, cmd: Command):
        yield self.env.timeout(max(0.0, t_s - self.env.now))
        self.apply_command(target, cmd)

    # ------------------------------------------------------------------ KPIs & snapshot
    def kpis(self) -> LineKpis:
        ok, scrap = self.parts_ok, self.parts_scrap
        planned, down = self.planned_clock.total(), self.line_down_clock.total()
        availability = 1.0 if planned <= 0 else max(0.0, 1.0 - down / planned)
        ideal = max(planned - down, 0.0) / self.ideal_cycle_s
        performance = min(1.0, (ok + scrap) / ideal) if ideal > 0 else 0.0
        quality = ok / (ok + scrap) if ok + scrap else 1.0
        window = min(3600.0, self.env.now - self.t0)
        recent = sum(1 for t in self._exit_times if t >= self.env.now - 3600.0)
        return LineKpis(parts_ok=ok, parts_scrap=scrap, wip=self.wip,
                        throughput_per_h=round(recent * 3600.0 / window, 1) if window > 0 else 0.0,
                        availability=round(availability, 4), performance=round(performance, 4),
                        quality=round(quality, 4), oee=round(availability * performance * quality, 4),
                        line_downtime_s=round(down, 1))

    def snapshot(self) -> Snapshot:
        self._seq += 1
        open_orders = [o for o in self.orders.values() if o.done_s is None]
        done = [o for o in self.orders.values() if o.done_s is not None][-5:]
        return Snapshot(ts=self.ts(), scenario_id=self.scenario_id, line_id=self.line_id, seq=self._seq,
                        sim_time_s=round(self.env.now, 3), time_scale=self.time_scale, status=self.status,
                        machines=[m.snapshot() for m in self.machines.values()],
                        conveyors=[c.snapshot() for c in self.conveyors.values()],
                        orders=[o.snapshot() for o in open_orders + done], kpis=self.kpis())
