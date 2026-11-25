"""Maintenance workers as SimPy agents (T12, Person A).

Each worker walks along the line (one axis, metres: machines at `x_m`, the workshop at
`workshop_x_m`), has skills (the catalogue's `repair.skill`) and a personal FIFO of jobs.
Jobs come from the commands `repair`, `preventive_maintenance`, `dispatch_worker` and from
the corrective policy used to generate datasets:

    request -> worker named?  yes -> that worker's queue (even if busy: it waits its turn)
                              no  -> idle qualified worker with the fewest skills (keeps the
                                     specialists free), nearest first; else the shared queue,
                                     taken by the first qualified worker who becomes free
    worker  -> [workshop, if the job replaces a part] -> walk to the machine -> inspect / repair

Required skill: inspect = anyone; preventive maintenance = mechanic; repair / replace =
the skill of the fault driving the machine state (operator if there is no fault). A repair
clears every active fault of the machine.

Why it matters: there is one mechanic. Two mechanical failures at once make a queue, and a
replacement starts with a walk to the workshop, so who is sent where, and when, changes the
downtime. That is the decision the RL agent (T17/T21) and the player (T27) take.
"""
from __future__ import annotations

import itertools
from collections import deque
from dataclasses import dataclass
from typing import TYPE_CHECKING

from roottwin.contracts import WorkerSnapshot
from roottwin.sim.layout import LineLayout, WorkerConfig
from roottwin.sim.primitives import Signal, TimeShare

if TYPE_CHECKING:
    from roottwin.sim.factory import Factory, Machine

INSPECT_MIN = 5.0
REPAIR_ACTIONS = ("repair", "replace", "preventive_maintenance")


@dataclass
class Job:
    job_id: str
    machine_id: str
    action: str                       # inspect | repair | replace | preventive_maintenance
    skill: str | None                 # None = anyone
    issued_by: str
    command_id: str | None
    requested_worker: str | None
    created_s: float
    worker_id: str | None = None
    status: str = "queued"            # queued | walking | working | done


class Worker:
    def __init__(self, pool: "WorkerPool", cfg: WorkerConfig, x0: float):
        self.pool = pool
        self.f = pool.f
        self.env = pool.f.env
        self.cfg = cfg
        self.id = cfg.worker_id
        self.skills = set(cfg.skills)
        self.x = x0
        self.state = "idle"               # idle | walking | working
        self.job: Job | None = None
        self.jobs: deque[Job] = deque()   # jobs asked to this worker by name
        self.busy = TimeShare(self.env)
        self.done = 0
        self._wake = Signal(self.env)
        self._walk: tuple[float, float, float, float] | None = None   # x0, x1, t0, t1
        self._work: tuple[float, float] | None = None                 # t0, t1 at the machine
        self.env.process(self._run())

    def can(self, skill: str | None) -> bool:
        return skill is None or skill in self.skills

    @property
    def available(self) -> bool:
        return self.state == "idle" and self.job is None and not self.jobs

    def wake(self) -> None:
        self._wake.fire()

    def position(self) -> float:
        if self._walk is None:
            return self.x
        x0, x1, t0, t1 = self._walk
        r = 1.0 if t1 <= t0 else min(max((self.env.now - t0) / (t1 - t0), 0.0), 1.0)
        return x0 + (x1 - x0) * r

    def _walk_to(self, x: float):
        dist = abs(x - self.x)
        if dist < 1e-9:
            return
        duration = dist / self.cfg.speed_m_s
        self.state = "walking"
        self._walk = (self.x, x, self.env.now, self.env.now + duration)
        yield self.env.timeout(duration)
        self.x = x
        self._walk = None

    def _run(self):
        while True:
            job = self.jobs.popleft() if self.jobs else self.pool.take(self)
            if job is None:
                self.state = "idle"
                self.busy.set(False)
                yield self._wake.wait()
                continue
            self.job, job.worker_id = job, self.id
            self.busy.set(True)
            m = self.f.machines[job.machine_id]
            stops = ([self.pool.workshop_x] if self.pool.needs_spare_part(m, job.action) else []) + [m.x]
            distance = sum(abs(b - a) for a, b in zip([self.x] + stops[:-1], stops))
            self.f.emit_event(m.id, "worker_dispatched", severity=1, payload={
                "worker_id": self.id, "job_id": job.job_id, "action": job.action,
                "distance_m": round(distance, 1), "eta_s": round(distance / self.cfg.speed_m_s, 1),
                "waited_s": round(self.env.now - job.created_s, 1), "spare_part": len(stops) > 1,
                "decided_by": job.issued_by, "command_id": job.command_id})
            job.status = "walking"
            for x in stops:
                yield from self._walk_to(x)
            job.status, self.state = "working", "working"
            if job.action == "inspect":
                self._work = (self.env.now, self.env.now + INSPECT_MIN * 60.0)
                yield self.env.timeout(INSPECT_MIN * 60.0)
                m.report_inspection(job.issued_by, job.command_id, self.id)
            else:
                yield from m.maintain(job.action, issued_by=job.issued_by, command_id=job.command_id,
                                      worker_id=self.id, job_id=job.job_id)
            self._work = None
            job.status = "done"
            self.job = None
            self.done += 1

    def snapshot(self) -> WorkerSnapshot:
        progress = 0.0
        window = self._work
        if self.state == "working" and window is None and self.job is not None:
            window = self.f.machines[self.job.machine_id].maint_window
        if self.state == "working" and window is not None and window[1] > window[0]:
            progress = min(max((self.env.now - window[0]) / (window[1] - window[0]), 0.0), 1.0)
        return WorkerSnapshot(worker_id=self.id, name=self.cfg.name, skills=sorted(self.skills),
                              state=self.state, x_m=round(self.position(), 2),
                              target_machine=self.job.machine_id if self.job else None,
                              action=self.job.action if self.job else None, job_progress=round(progress, 4),
                              queue=len(self.jobs), busy_s=round(self.busy.total(), 1))


class WorkerPool:
    """The maintenance team and the shared intervention queue."""

    def __init__(self, factory: "Factory", layout: LineLayout):
        self.f = factory
        self.workshop_x = layout.workshop_x_m
        self.queue: deque[Job] = deque()
        self._seq = itertools.count(1)
        self.workers: dict[str, Worker] = {
            w.worker_id: Worker(self, w, layout.workshop_x_m if w.home_x_m is None else w.home_x_m)
            for w in layout.workers}

    def required_skill(self, m: "Machine", action: str) -> str | None:
        if action == "inspect":
            return None
        if action == "preventive_maintenance":
            return "mechanic"
        code = m.dominant_fault()
        return self.f.catalog[code].repair.skill if code else "operator"

    def needs_spare_part(self, m: "Machine", action: str) -> bool:
        if action == "replace":
            return True
        return action == "repair" and any(af.spec.repair.action == "replace" for af in m.faults)

    def request(self, m: "Machine", action: str, *, issued_by: str, command_id: str | None = None,
                worker_id: str | None = None) -> str | None:
        """Plan an intervention. Returns None if accepted, else why it was refused."""
        if action in REPAIR_ACTIONS and (m.maintenance or m.maintenance_pending):
            return f"{m.id} is already in maintenance or has a repair planned"
        skill = self.required_skill(m, action)
        named = None
        if worker_id is not None:
            named = self.workers.get(worker_id)
            if named is None:
                return f"unknown worker '{worker_id}' (team: {', '.join(self.workers)})"
            if not named.can(skill):
                return f"{worker_id} is not qualified for this job (needs {skill})"
        elif not any(w.can(skill) for w in self.workers.values()):
            return f"no worker has the skill '{skill}'"
        job = Job(f"J{next(self._seq):05d}", m.id, action, skill, issued_by, command_id, worker_id,
                  self.f.env.now)
        if action in REPAIR_ACTIONS:
            m.maintenance_pending = True
        if named is not None:
            named.jobs.append(job)
            named.wake()
            return None
        idle = [w for w in self.workers.values() if w.available and w.can(skill)]
        if idle:   # keep specialists free: fewest skills first, then nearest
            chosen = min(idle, key=lambda w: (len(w.skills), abs(w.x - m.x), w.id))
            chosen.jobs.append(job)
            chosen.wake()
        else:
            self.queue.append(job)
            self.f.emit_event(m.id, "intervention_queued", severity=2, payload={
                "job_id": job.job_id, "action": action, "skill": skill, "queue_length": len(self.queue),
                "decided_by": issued_by, "command_id": command_id})
        return None

    def take(self, worker: Worker) -> Job | None:
        """First job of the shared queue this worker is qualified for (FIFO)."""
        for job in self.queue:
            if worker.can(job.skill):
                self.queue.remove(job)
                return job
        return None

    def snapshot(self) -> list[WorkerSnapshot]:
        return [w.snapshot() for w in self.workers.values()]
