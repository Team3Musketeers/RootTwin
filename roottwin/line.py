"""Production line engine: parts flow, buffers, workers, wear, faults, KPIs.

ONE model used everywhere so humans and AI are compared on the same physics:
- scripts/run_line.py    real time, publishes MQTT (stand-in for Person A's SimPy, T03/T06)
- roottwin/rl/env.py     fast, Gymnasium environment (T17)
- benchmark & Play mode  fast, same seeds (T27/T28)

Time unit = simulated minute. Machines M1..M6 in series, a buffer after each
machine except the last. A part spends `cycle_min / speed` on each machine.
shortcut: one line, deterministic routing; replace by A's SimPy model when it exists.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from roottwin.faults.models import ActiveFault, FaultSpec, load_catalog, worst_state

NOMINAL = {"vibration": 2.0, "temperature": 45.0, "current": 12.0, "cadence": 30.0}
SENSORS = list(NOMINAL)
WALK_MIN_PER_MACHINE = 1.0          # worker walking time between two neighbouring machines
LOTO_MIN = 5.0                      # lockout/tagout before and after an intervention
PM_MIN, PM_COST = 20.0, 100.0       # preventive maintenance duration / cost
INSPECT_MIN = 5.0
PLANNED_FACTOR = 0.6                # shortcut: assumed time/cost ratio planned vs breakdown repair, calibrate with plant data
DOWNTIME_COST_PER_MIN = 50.0        # shortcut: placeholder EUR/min of line stop, replace with plant figures
PART_VALUE = 20.0                   # EUR margin per good part (placeholder)
SKILLS_OK = {"mechanic": {"mechanic", "operator"}, "electrician": {"electrician", "operator"},
             "technician": {"technician", "operator"}}


@dataclass
class Machine:
    id: str
    cycle_min: float = 1.0
    speed: float = 1.0
    enabled: bool = True
    wear: float = 0.0               # 0 new .. 1 worn; drives random fault hazard
    faults: list[ActiveFault] = field(default_factory=list)
    part: int | None = None         # id of the part being processed
    progress: float = 0.0           # 0..1 on the current part
    status: str = "idle"            # idle|working|blocked|starved|down|maintenance|stopped
    worker: str | None = None
    down_min: float = 0.0
    frozen: dict = field(default_factory=dict)

    def state(self, t: float) -> str:
        return worst_state([f.state(t) for f in self.faults])


@dataclass
class Worker:
    id: str
    skill: str
    pos: float = 0.0                # position along the line, in machine index units
    task: dict | None = None        # {"machine": i, "kind": repair|pm|inspect, "phase": walk|loto|work, "left": min}


class Line:
    def __init__(self, n_machines: int = 6, buffer_cap: int = 5, seed: int = 0, random_faults: bool = False,
                 hazard_per_min: float = 6e-4, workers=(("W1", "mechanic"), ("W2", "electrician"),
                                                         ("W3", "technician"))):
        self.rng = np.random.default_rng(seed)
        self.catalog: dict[str, FaultSpec] = load_catalog()
        self.codes = sorted(self.catalog)
        self.machines = [Machine(f"M{i + 1}") for i in range(n_machines)]
        self.buffers: list[list[int]] = [[] for _ in range(n_machines - 1)]
        self.buffer_cap = [buffer_cap] * (n_machines - 1)
        self.workers = [Worker(w, s, pos=float(i * 2)) for i, (w, s) in enumerate(workers)]
        self.t = 0.0
        self.running = False
        self.order_left = 0
        self.order_id: str | None = None
        self.next_part = 1
        self.random_faults = random_faults
        self.hazard = hazard_per_min
        self.kpi = {"parts_ok": 0, "parts_scrap": 0, "line_down_min": 0.0, "repair_cost": 0.0,
                    "pm_cost": 0.0, "interventions": 0, "repair_min_total": 0.0}
        self.events: list[dict] = []          # drained by the runner (MQTT) or ignored (RL)
        self._offset = {m.id: {s: self.rng.normal(1, 0.02) for s in SENSORS} for m in self.machines}

    # ------------------------------------------------------------ commands
    def command(self, target: str, name: str, params: dict | None = None) -> str | None:
        """Apply a command (same names as roottwin.contracts). Returns an error string or None."""
        p = params or {}
        if name == "start_line":
            self.running = True
            if self.order_left <= 0:
                self.order_left, self.order_id = 10**9, "CONTINUOUS"
        elif name in ("stop_line", "pause_line"):
            self.running = False
        elif name == "create_order":
            self.order_left, self.order_id = int(p["quantity"]), p.get("order_id", "ORD")
        elif name == "set_time_scale":
            return None                        # handled by the real-time runner
        else:
            m = self._machine(target)
            if m is None:
                return f"unknown machine {target}"
            i = self.machines.index(m)
            if name == "start_machine":
                m.enabled = True
            elif name == "stop_machine":
                m.enabled = False
            elif name == "set_speed":
                m.speed = float(p["factor"])
            elif name == "set_buffer":
                if i < len(self.buffers):
                    self.buffer_cap[i] = int(p["capacity"])
            elif name == "inject_fault":
                code = p["fault_code"]
                if code not in self.catalog:
                    return f"unknown fault {code}"
                self._add_fault(m, code, p.get("ramp_min"))
            elif name == "clear_fault":
                m.faults.clear()
            elif name in ("dispatch_worker", "repair"):
                kind = "pm" if p.get("action") == "preventive_maintenance" else ("repair" if m.faults else "inspect")
                return self.dispatch(i, kind, p.get("worker_id"))
            elif name == "preventive_maintenance":
                return self.dispatch(i, "pm", p.get("worker_id"))
            else:
                return f"unsupported command {name}"
        return None

    def _machine(self, mid: str) -> Machine | None:
        return next((m for m in self.machines if m.id == mid), None)

    def _add_fault(self, m: Machine, code: str, ramp: float | None = None) -> None:
        m.faults.append(ActiveFault(self.catalog[code], m.id, self.t, ramp))
        self.events.append({"machine_id": m.id, "event_type": "fault_injected", "fault_code": code, "severity": 3})

    def required_skill(self, i: int) -> str:
        m = self.machines[i]
        return m.faults[-1].spec.repair.skill if m.faults else "operator"

    def can_do(self, w: Worker, skill: str) -> bool:
        return skill in SKILLS_OK[w.skill] or skill == w.skill

    def dispatch(self, i: int, kind: str, worker_id: str | None = None) -> str | None:
        m = self.machines[i]
        if m.worker:
            return f"{m.id} already has {m.worker}"
        skill = self.required_skill(i) if kind == "repair" else "operator"
        free = [w for w in self.workers if w.task is None and self.can_do(w, skill)
                and (worker_id is None or w.id == worker_id)]
        if not free:
            return f"no free worker with skill {skill}"
        w = min(free, key=lambda w: abs(w.pos - i))
        w.task = {"machine": i, "kind": kind, "phase": "walk", "left": abs(w.pos - i) * WALK_MIN_PER_MACHINE}
        m.worker = w.id
        self.kpi["interventions"] += 1
        self.events.append({"machine_id": m.id, "event_type": "worker_dispatched",
                            "payload": {"worker": w.id, "kind": kind}})
        return None

    # ------------------------------------------------------------ dynamics
    def step(self, dt: float = 1.0) -> None:
        n = max(1, int(np.ceil(dt / 1.0)))     # 1-min substeps: a part never skips a machine (cycle >= 1 min)
        for _ in range(n):
            self._substep(dt / n)

    def _substep(self, dt: float) -> None:
        t = self.t
        for i, m in enumerate(self.machines):
            if self.random_faults and not m.faults and m.status != "maintenance":
                m.wear = min(1.0, m.wear + dt * m.speed / 2400)          # ~40 h to full wear at nominal speed
                if self.rng.random() < self.hazard * dt * m.speed * (1 + 30 * m.wear ** 2):
                    self._add_fault(m, str(self.rng.choice(self.codes)))
        self._workers(dt)
        line_blocked = False
        # downstream first so a freed slot can be used in the same tick
        for i in reversed(range(len(self.machines))):
            m = self.machines[i]
            st = m.state(t)
            if m.status == "down" and st != "down":
                m.status = "idle"                      # fault cleared without a worker (clear_fault)
            if st == "down":
                if m.status != "down":
                    self.events.append({"machine_id": m.id, "event_type": "failure", "state": "down",
                                        "fault_code": m.faults[-1].code, "severity": 5})
                m.status = "down"
            if m.status in ("down", "maintenance") or st == "down":
                m.down_min += dt
                line_blocked = True
                continue
            if not self.running or not m.enabled:
                m.status = "stopped"
                continue
            if m.part is None:
                if i == 0:
                    if self.order_left > 0:
                        m.part, self.next_part = self.next_part, self.next_part + 1
                        self.order_left -= 1
                elif self.buffers[i - 1]:
                    m.part = self.buffers[i - 1].pop(0)
                if m.part is None:
                    m.status = "starved" if (i > 0 or self.order_left > 0) else "idle"
                    continue
                m.progress = 0.0
            if m.progress < 1.0:
                m.status = "working"
                m.progress = min(1.0, m.progress + dt * m.speed / m.cycle_min)
            if m.progress >= 1.0:
                if i == len(self.machines) - 1:
                    scrap = max((f.scrap_rate(t) for mm in self.machines for f in mm.faults), default=0.0)
                    self.kpi["parts_scrap" if self.rng.random() < scrap else "parts_ok"] += 1
                    m.part = None
                elif len(self.buffers[i]) < self.buffer_cap[i]:
                    self.buffers[i].append(m.part)
                    m.part = None
                else:
                    m.status = "blocked"
        if line_blocked and self.running:
            self.kpi["line_down_min"] += dt
        self.t += dt

    def _workers(self, dt: float) -> None:
        for w in self.workers:
            task = w.task
            if task is None:
                continue
            i, m = task["machine"], self.machines[task["machine"]]
            task["left"] -= dt
            if task["phase"] == "walk":
                w.pos += np.sign(i - w.pos) * min(abs(i - w.pos), dt / WALK_MIN_PER_MACHINE)
            if task["left"] > 0:
                continue
            if task["phase"] == "walk":
                w.pos = float(i)
                loto = (m.faults and m.faults[-1].spec.repair.loto_required) or task["kind"] == "pm"
                task.update(phase="loto", left=LOTO_MIN if loto else 0.0)
                m.status = "maintenance"
            elif task["phase"] == "loto":
                if task["kind"] == "repair" and m.faults:
                    # planned repair before failure is shorter and cheaper than a breakdown repair
                    task["planned"] = m.faults[-1].progress(self.t) < 1.0
                    dur = m.faults[-1].spec.repair.minutes * (PLANNED_FACTOR if task["planned"] else 1.0)
                elif task["kind"] == "pm":
                    dur = PM_MIN
                else:
                    dur = INSPECT_MIN
                task.update(phase="work", left=dur, started=self.t)
            else:
                if task["kind"] == "repair":
                    self.kpi["repair_cost"] += sum(f.spec.repair.cost_eur for f in m.faults) * (
                        PLANNED_FACTOR if task.get("planned") else 1.0)
                    self.kpi["repair_min_total"] += self.t - task.get("started", self.t)
                    m.faults.clear()
                    m.wear *= 0.5
                elif task["kind"] == "pm":
                    self.kpi["pm_cost"] += PM_COST
                    m.faults = [f for f in m.faults if f.progress(self.t) >= 1.0]  # PM catches incipient faults
                    m.wear = 0.0
                m.status, m.worker, w.task = "idle", None, None
                self.events.append({"machine_id": m.id, "event_type": "repair_end", "state": "ok",
                                    "payload": {"worker": w.id, "kind": task["kind"]}})

    # ------------------------------------------------------------ observation
    def sensors(self, i: int) -> dict[str, float]:
        m = self.machines[i]
        vals = {s: NOMINAL[s] * self._offset[m.id][s] * self.rng.normal(1, 0.03) for s in SENSORS}
        vals["vibration"] *= m.speed ** 0.5
        vals["cadence"] *= m.speed
        for f in m.faults:
            vals = f.apply(vals, self.t, self.rng)
        if m.status != "working":
            vals["cadence"] = 0.0
            vals["current"] *= 0.35 if m.status != "down" else 1.0
            vals["vibration"] *= 0.4 if m.status not in ("down",) else 1.0
        return {k: round(float(v), 3) for k, v in vals.items()}

    def kpis(self) -> dict:
        k = dict(self.kpi)
        hours = max(self.t / 60, 1e-9)
        k["sim_min"] = round(self.t, 1)
        k["throughput_per_h"] = round(k["parts_ok"] / hours, 1)
        k["availability"] = round(1 - k["line_down_min"] / max(self.t, 1e-9), 3)
        n_rep = max(k["interventions"], 1)
        k["mttr_min"] = round(k["repair_min_total"] / n_rep, 1)
        k["downtime_cost"] = round(k["line_down_min"] * DOWNTIME_COST_PER_MIN, 0)
        k["total_cost"] = round(k["downtime_cost"] + k["repair_cost"] + k["pm_cost"], 0)
        k["profit"] = round(k["parts_ok"] * PART_VALUE - k["total_cost"], 0)
        return k

    def snapshot(self) -> dict:
        """Full state for the 3D view (contract: docs/DATA_CONTRACTS.md, snapshot)."""
        parts = []
        for i, m in enumerate(self.machines):
            if m.part is not None:
                parts.append({"id": m.part, "where": "machine", "index": i, "progress": round(m.progress, 3)})
        for i, b in enumerate(self.buffers):
            for slot, pid in enumerate(b):
                parts.append({"id": pid, "where": "buffer", "index": i, "slot": slot})
        return {
            "t_min": round(self.t, 2), "running": self.running,
            "order": {"id": self.order_id, "left": self.order_left if self.order_left < 10**8 else None},
            "machines": [{"id": m.id, "status": m.status, "state": m.state(self.t), "speed": m.speed,
                          "enabled": m.enabled, "wear": round(m.wear, 3), "worker": m.worker,
                          "faults": [f.code for f in m.faults], "down_min": round(m.down_min, 1)}
                         for m in self.machines],
            "buffers": [{"index": i, "level": len(b), "capacity": self.buffer_cap[i]} for i, b in enumerate(self.buffers)],
            "workers": [{"id": w.id, "skill": w.skill, "pos": round(w.pos, 3),
                         "task": None if w.task is None else {k: (round(v, 2) if isinstance(v, float) else v)
                                                              for k, v in w.task.items()}}
                        for w in self.workers],
            "parts": parts,
            "kpi": self.kpis(),
        }
