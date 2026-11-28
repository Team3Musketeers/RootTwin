// Factory runtime: material flow, station cycles, robot programs, AGV fleet, faults, E-stop, KPIs.
// Pure TypeScript, frame-rate independent (fixed sub-steps); the 3D scene only reads it.
import { armIK } from "./kinematics";
import { AGV_PATH, AGV_STOPS, BELT_Y, LINE_X0, ST, STOPS } from "./layout";
import { PAL_BASE, PAL_PALLET, PAL_PICK, PAL_SCALE, WELD_BASE } from "./machines/cells";
import { SEGMENTS } from "./machines/line";
import { AGV_IDS, MACHINE, MACHINES, allParts, partById } from "./registry";
import type { Fault, LineState, MachineRuntime, TwinEvent, V3 } from "./types";

export type WpKind = "raw" | "machined" | "pressed" | "welded";
export interface Workpiece { id: number; x: number; kind: WpKind; where: "line" | "robot" | "pallet"; slot: number; done: Set<string>; reject: boolean }
export interface AgvState { id: string; s: number; wait: number; stop: number; carrying: "raw" | "pallet" | null; pos: V3; yaw: number }

const SPACING = 0.85;
const PALLET_SLOTS = 9;
export const palletSlot = (i: number): V3 => [PAL_PALLET[0] + ((i % 3) - 1) * 0.52, PAL_PALLET[1] + 0.25, PAL_PALLET[2] + (Math.floor(i / 3) - 1) * 0.52];
const approach = (v: number, t: number, step: number) => (Math.abs(t - v) <= step ? t : v + Math.sign(t - v) * step);

// ------------------------------------------------------------------ AGV path geometry
const PATH = AGV_PATH.map(([x, z]) => [x, z] as [number, number]);
const SEG_LEN = PATH.map((p, i) => { const q = PATH[(i + 1) % PATH.length]; return Math.hypot(q[0] - p[0], q[1] - p[1]); });
export const PATH_LEN = SEG_LEN.reduce((a, b) => a + b, 0);
export function pathPoint(s: number): { x: number; z: number; yaw: number } {
  let r = ((s % PATH_LEN) + PATH_LEN) % PATH_LEN;
  for (let i = 0; i < PATH.length; i++) {
    if (r <= SEG_LEN[i]) {
      const p = PATH[i], q = PATH[(i + 1) % PATH.length], f = r / SEG_LEN[i];
      return { x: p[0] + (q[0] - p[0]) * f, z: p[1] + (q[1] - p[1]) * f, yaw: Math.atan2(-(q[1] - p[1]), q[0] - p[0]) };
    }
    r -= SEG_LEN[i];
  }
  return { x: PATH[0][0], z: PATH[0][1], yaw: 0 };
}
function pathS(x: number, z: number) {                     // arc length of the closest point on the loop
  let best = 0, bestD = Infinity, acc = 0;
  for (let i = 0; i < PATH.length; i++) {
    const p = PATH[i], q = PATH[(i + 1) % PATH.length];
    const dx = q[0] - p[0], dz = q[1] - p[1], L = SEG_LEN[i];
    const f = Math.max(0, Math.min(1, ((x - p[0]) * dx + (z - p[1]) * dz) / (L * L)));
    const d = Math.hypot(p[0] + dx * f - x, p[1] + dz * f - z);
    if (d < bestD) { bestD = d; best = acc + f * L; }
    acc += L;
  }
  return best;
}
const STOP_S = AGV_STOPS.map((st) => pathS(st.at[0], st.at[1]));

// ------------------------------------------------------------------ robot programs
type Pose = Record<string, number>;
const weldPose = (robot: "A" | "B", x: number, lift = 0): Pose => {
  const b = WELD_BASE[robot];
  const z = robot === "A" ? -0.3 : 0.3;                      // seam on the near side of the part
  const ik = armIK([x - b[0], BELT_Y + 0.55 + lift, z - b[2]]);
  return Object.fromEntries(Object.entries(ik).map(([k, v]) => [`${robot}_${k}`, v]));
};
const palPose = (p: V3, lift = 0): Pose => armIK([p[0] - PAL_BASE[0], p[1] + lift, p[2] - PAL_BASE[2]], undefined, PAL_SCALE);

// which component an overloaded setpoint damages (first matching fault code of that machine)
const OVERLOAD: Record<string, RegExp> = {
  rpm: /SPBRG|INBRG|J1/, temp: /SPMOT|MOTOR|PSU|FAN|J2|J3/, current: /MOTOR|DRIVE|OC|J3|J2/, force: /GEAR|SEAL/, pressure: /SEAL|LEAK|COOL|PSENS/,
  speed: /DRIVE|MOTOR|OC|DIVERT|PUSH/, load: /DRIVE|MOTOR|J2|J1|PUSH/, voltage: /PSU|BATT|VFD/, toolSpeed: /J2|J3|J1/, power: /TIP|PSU/,
};
const partOf = (partId: string) => partById(partId)?.name ?? partId;

export class TwinSim {
  t = 0;
  line = { state: "RUNNING" as LineState, speedPct: 100, spawnInterval: 7, ghost: 0.08, lighting: 1 };
  rt: Record<string, MachineRuntime> = {};
  wps: Workpiece[] = [];
  agvs: AgvState[] = [];
  faults: Fault[] = [];
  events: TwinEvent[] = [];
  stock = 12;                    // raw carriers in the dispenser magazine
  pallet: (number | null)[] = Array(PALLET_SLOTS).fill(null);
  stats = { good: 0, rejects: 0, pallets: 0, runTime: 0, started: 0 };
  version = 0;
  private nextId = 1;
  private spawnT = 0;
  private stationWp: Record<string, number | null> = {};
  private stationT: Record<string, number> = {};
  private palStep = -1;
  private palWp: number | null = null;
  private faultSeq = 1;
  owner: Record<string, string> = {};             // machine id -> player who claimed it (unclaimed machines run their automatic cycle)
  repairs: Record<string, { by: string; left: number }> = {};   // fault id -> repair in progress

  constructor() {
    for (const m of MACHINES) {
      this.rt[m.id] = { id: m.id, status: "RUN", manual: false, set: { ...m.defaults }, act: { ...m.defaults }, phase: { door: 1 }, cycles: 0, busy: 0, stepOnce: false };
    }
    this.agvs = AGV_IDS.map((id, i) => {
      const s = (i * PATH_LEN) / AGV_IDS.length;
      return { id, s, wait: 0, stop: -1, carrying: i === 0 ? "raw" : null, pos: [0, 0, 0], yaw: 0 };
    });
    for (const a of this.agvs) this.placeAgv(a);
    this.log("info", "Line started - normal shift");
  }

  // ------------------------------------------------------------ commands
  log(level: TwinEvent["level"], text: string) { this.events.unshift({ t: this.t, level, text }); if (this.events.length > 150) this.events.pop(); }
  /** A critical fault caused by an operator mistake trips the line safety interlock until the part is repaired. */
  interlock() { return this.faults.find((f) => f.source === "player" && f.severity === "critical"); }
  setLine(state: LineState) {
    if (this.line.state === "ESTOP" && state !== "STOPPED") { this.log("warning", "Reset the E-stop first"); return; }
    const il = this.interlock();
    if (il && state === "RUNNING") { this.log("warning", `Wrong sequence: line interlock - repair ${partOf(il.partId)} on ${MACHINE[il.machineId].name} first`); return; }
    this.line.state = state;
    this.log(state === "ESTOP" ? "fault" : "info", state === "ESTOP" ? "EMERGENCY STOP pressed - all motion stopped" : `Line ${state.toLowerCase()}`);
  }
  resetEstop() { if (this.line.state === "ESTOP") { this.line.state = "PAUSED"; this.log("success", "E-stop reset - line paused, press Start"); } }
  setMachine(id: string, status: "RUN" | "HOLD" | "STOP") {
    const r = this.rt[id];
    if (r.status === "FAULT" && status === "RUN") { this.log("warning", `${MACHINE[id].name}: clear the fault first`); return; }
    r.status = status;
    if (status === "RUN") r.manual = false;
    this.log("info", `${MACHINE[id].name}: ${status}`);
  }
  home(id: string) {
    const r = this.rt[id];
    for (const [k, v] of Object.entries(MACHINE[id].defaults)) if (/J\d$/.test(k)) r.set[k] = v;
    r.manual = true;
    this.log("info", `${MACHINE[id].name}: homing axes`);
  }
  stepCycle(id?: string) {
    if (id) { this.rt[id].stepOnce = true; this.rt[id].status = "HOLD"; return; }
    this.update(0.5);
  }
  setValue(id: string, key: string, v: number) {
    const r = this.rt[id];
    r.set[key] = v;
    if (/J\d$/.test(key) || key === "grip") r.manual = true;     // operator takes the robot over
    if (id === "CNV" && key === "speed") this.log("info", `Conveyor speed set to ${v.toFixed(2)} m/s`);
  }
  setFleetSpeed(v: number) { for (const id of AGV_IDS) this.rt[id].set.speed = v; }
  scenario(name: "normal" | "peak" | "changeover" | "lockout" | "fault") {
    const s = { normal: [100, 0.6, 7], peak: [140, 0.9, 4.5], changeover: [50, 0.35, 12], lockout: [0, 0.6, 7], fault: [100, 0.6, 7] }[name];
    this.line.speedPct = s[0]; this.rt.CNV.set.speed = s[1]; this.line.spawnInterval = s[2];
    if (name === "lockout") { for (const m of MACHINES) if (m.type !== "agv") this.rt[m.id].status = "STOP"; this.line.state = "STOPPED"; }
    else { for (const m of MACHINES) if (this.rt[m.id].status === "STOP") this.rt[m.id].status = "RUN"; if (this.line.state !== "ESTOP") this.line.state = "RUNNING"; }
    if (name === "fault") this.injectFault("PRS", "PRS-INBRG");
    this.log("info", `Scenario: ${name}`);
  }

  /** Start a timed repair (LOTO, replace, test) of a faulty part; the fault clears when it is done. */
  startRepair(faultId: string, by = "technician", seconds = 4) {
    const f = this.faults.find((x) => x.id === faultId);
    if (!f || this.repairs[faultId]) return;
    this.repairs[faultId] = { by, left: seconds };
    this.log("info", `${by}: LOTO + repairing ${partOf(f.partId)} (${MACHINE[f.machineId].name})`);
  }
  claim(machineId: string, player: string | null) {
    if (player) this.owner[machineId] = player; else delete this.owner[machineId];
    this.log("info", player ? `${player} took control of ${MACHINE[machineId].name}` : `${MACHINE[machineId].name} back to automatic`);
  }

  injectFault(machineId: string, code: string, source: Fault["source"] = "local", label?: string): Fault | null {
    const spec = MACHINE[machineId]?.faults.find((f) => f.code === code);
    if (!spec || this.faults.some((f) => f.machineId === machineId && f.code === code)) return null;
    const f: Fault = { id: `F-${String(this.faultSeq++).padStart(4, "0")}`, machineId, partId: spec.partId, code, label: label ?? spec.label,
      severity: spec.severity, t: this.t, source, acknowledged: false };
    this.faults.unshift(f);
    if (f.severity === "critical") this.rt[machineId].status = "FAULT";
    if (source === "player" && f.severity === "critical" && this.line.state === "RUNNING") {
      this.line.state = "STOPPED";                              // safety interlock: the whole line stops (IEC 60204-1 stop cat. 1)
      this.log("fault", `LINE STOP - interlock tripped by ${MACHINE[machineId].name}`);
    }
    this.applyFaultEffects();
    this.log("fault", `${f.id} ${MACHINE[machineId].name}: ${f.label}`);
    return f;
  }
  clearFault(id: string) {
    const f = this.faults.find((x) => x.id === id);
    if (!f) return;
    this.faults = this.faults.filter((x) => x.id !== id);
    delete this.repairs[id];
    if (!this.faults.some((x) => x.machineId === f.machineId && x.severity === "critical")) {
      if (this.rt[f.machineId].status === "FAULT") this.rt[f.machineId].status = "RUN";
    }
    this.applyFaultEffects();
    this.log("success", `${f.id} cleared - ${f.label}`);
  }
  acknowledge(id: string) { const f = this.faults.find((x) => x.id === id); if (f) f.acknowledged = true; }
  partFault(partId: string) { return this.faults.find((f) => f.partId === partId); }
  machineFaults(machineId: string) { return this.faults.filter((f) => f.machineId === machineId); }

  private applyFaultEffects() {
    // telemetry side effects of active faults (read by part telemetry functions)
    for (const r of Object.values(this.rt)) for (const k of ["heat", "wear", "leak", "drift", "sag", "fanFail"]) r.phase[k] = 0;
    for (const f of this.faults) {
      const p = this.rt[f.machineId].phase;
      if (/BRG|OVERHEAT|PSU|J2|J3|SPMOT|MOTOR|DRIVE/.test(f.code)) p.heat = 1;
      if (/GEAR|TOOL|SPBRG|J1|TIP/.test(f.code)) p.wear = 1;
      if (/LEAK|SEAL|VAC/.test(f.code)) p.leak = 2.5;
      if (/PSENS|PE-|TENS|LENS/.test(f.code)) p.drift = 18;
      if (/TENS/.test(f.code)) p[`slip${f.code.slice(3, 4)}`] = 0.9;
      if (f.code === "PLC-PSU") p.sag = 1;
      if (f.code === "PLC-FAN") p.fanFail = 1;
    }
  }

  // ------------------------------------------------------------ health & KPIs
  health(): "RUNNING" | "WARNING" | "FAULT" | "PAUSED" {
    if (this.line.state === "ESTOP" || this.faults.some((f) => f.severity === "critical")) return "FAULT";
    if (this.faults.length) return "WARNING";
    return this.line.state === "RUNNING" ? "RUNNING" : "PAUSED";
  }
  kpis() {
    const elapsed = Math.max(this.t, 1e-6);
    const availability = this.stats.runTime / elapsed;
    const ideal = (this.stats.runTime / 6) || 1;                     // nominal takt 6 s
    const performance = Math.min(1, (this.stats.good + this.stats.rejects) / ideal);
    const quality = this.stats.good / Math.max(1, this.stats.good + this.stats.rejects);
    return { availability, performance, quality, oee: availability * performance * quality, throughput: this.stats.good / (elapsed / 3600),
      good: this.stats.good, rejects: this.stats.rejects, pallets: this.stats.pallets, wip: this.wps.filter((w) => w.where !== "pallet").length };
  }

  // ------------------------------------------------------------ main loop
  tick(dt: number) {
    const n = Math.max(1, Math.ceil(dt / 0.05));
    for (let i = 0; i < n; i++) this.update(dt / n);
  }

  private running(id: string) {
    const r = this.rt[id];
    return this.line.state === "RUNNING" && (r.status === "RUN" || r.stepOnce) && !this.plcDown();
  }
  private plcDown() { return this.faults.some((f) => f.machineId === "PLC" && f.severity === "critical"); }

  update(dt: number) {
    this.t += dt;
    const estop = this.line.state === "ESTOP";
    const k = this.line.speedPct / 100;
    if (this.line.state === "RUNNING" && !this.plcDown()) this.stats.runTime += dt * (this.faults.some((f) => f.severity === "critical") ? 0 : 1);
    this.actuals(dt, estop);
    this.operatorRules(dt);
    if (!estop) {
      this.dispense(dt, k);
      this.conveyor(dt, k);
      this.stations(dt, k);
      this.palletize();
      this.fleet(dt);
    }
    this.robots(dt, k, estop);
    this.version++;
  }

  // actual values smoothly follow setpoints; spinning parts integrate their angle
  /** Overload above 90 % of a setpoint range for 4 s damages the matching component; timed repairs progress. */
  private operatorRules(dt: number) {
    for (const m of MACHINES) {
      const r = this.rt[m.id];
      for (const c of m.controls) {
        const rule = OVERLOAD[c.key];
        if (!rule) continue;
        const over = this.running(m.id) && (r.set[c.key] ?? 0) >= c.min + 0.9 * (c.max - c.min);
        const k = `over_${c.key}`;
        r.phase[k] = over ? (r.phase[k] ?? 0) + dt : 0;
        if (r.phase[k] > 4) {
          r.phase[k] = 0;
          const free = m.faults.filter((f) => !this.faults.some((x) => x.machineId === m.id && x.code === f.code));
          const spec = free.find((f) => rule.test(f.code)) ?? free.find((f) => f.severity === "critical");   // every overload has a consequence
          if (spec) this.injectFault(m.id, spec.code, "player", `${spec.label} - ${c.label} over safe limit`);
        }
      }
    }
    for (const [id, rp] of Object.entries(this.repairs)) if ((rp.left -= dt) <= 0) this.clearFault(id);
  }

  private actuals(dt: number, estop: boolean) {
    for (const m of MACHINES) {
      const r = this.rt[m.id], on = !estop && this.running(m.id) || (m.type === "agv" && !estop && r.status === "RUN");
      for (const c of m.controls) {
        if (/J\d$/.test(c.key) || c.key === "grip") continue;           // robots: handled by programs
        const target = on ? (r.set[c.key] ?? 0) : (["rpm", "speed", "current", "force"].includes(c.key) ? 0 : r.set[c.key] ?? 0);
        r.act[c.key] = approach(r.act[c.key] ?? 0, target, (c.max - c.min) * 0.6 * dt);
      }
      const ph = r.phase;
      if (m.type === "cnc") { ph.spindle = (ph.spindle ?? 0) + (r.act.rpm / 60) * 0.06 * Math.PI * 2 * dt; ph.carousel = (ph.carousel ?? 0) + (r.busy > 0 && r.busy < 0.1 ? dt * 3 : 0); }
      if (m.type === "press") ph.motor = (ph.motor ?? 0) + (r.act.rpm / 60) * 0.25 * Math.PI * 2 * dt;
      if (m.type === "plc") ph.fan = (ph.fan ?? 0) + dt * 25;
      if (m.id === "CNV") ph.belt = (ph.belt ?? 0) + r.act.speed * dt;
    }
  }

  // ------------------------------------------------------------ 1. dispenser
  private dispense(dt: number, k: number) {
    const r = this.rt.DSP;
    if (!this.running("DSP")) return;
    this.spawnT += dt * k;
    r.phase.push = Math.max(0, (r.phase.push ?? 0) - dt * 1.5);
    const free = !this.wps.some((w) => w.where === "line" && w.x < LINE_X0 + SPACING);
    if (this.spawnT >= this.line.spawnInterval && free && this.stock > 0) {
      this.spawnT = 0; this.stock--;
      this.wps.push({ id: this.nextId++, x: LINE_X0, kind: "raw", where: "line", slot: -1, done: new Set(), reject: this.nextId % 23 === 0 });
      r.phase.push = 1; r.cycles++;
      if (this.stock === 0) this.log("warning", "Dispenser magazine empty - waiting for AGV delivery");
    }
  }

  // ------------------------------------------------------------ conveyors (accumulating, station stops, per-segment drive faults)
  private conveyor(dt: number, k: number) {
    const cnv = this.rt.CNV;
    if (!this.running("CNV")) return;
    const stoppedSeg = SEGMENTS.filter((s) => this.faults.some((f) => f.partId === `CNV.s${s.n}.motor` && f.severity === "critical"));
    const line = this.wps.filter((w) => w.where === "line").sort((a, b) => b.x - a.x);
    let limit = ST.lineEnd;
    for (const w of line) {
      let target = Math.min(limit, w.x + cnv.act.speed * k * dt);
      if (stoppedSeg.some((s) => w.x >= s.x0 - 0.3 && w.x <= s.x1)) target = w.x;
      for (const st of STOPS) {
        if (w.done.has(st.machine) || w.x > st.x + 1e-6) continue;
        if (target >= st.x) { target = st.x; break; }
      }
      w.x = Math.max(w.x, target);
      limit = w.x - SPACING;
    }
  }

  private stations(dt: number, k: number) {
    for (const st of STOPS) {
      const id = st.machine, r = this.rt[id];
      const at = this.wps.find((w) => w.where === "line" && Math.abs(w.x - st.x) < 1e-6 && !w.done.has(id));
      if (at && this.stationWp[id] == null) { this.stationWp[id] = at.id; this.stationT[id] = 0; }
      const wid = this.stationWp[id];
      if (wid == null) { r.busy = 0; this.idlePhases(id, dt); continue; }
      if (!this.running(id)) continue;
      this.stationT[id] += dt * k;
      r.busy = Math.min(1, this.stationT[id] / st.time);
      this.cyclePhases(id, r.busy);
      if (r.busy >= 1) {
        const w = this.wps.find((x) => x.id === wid)!;
        w.done.add(id); r.cycles++; this.stationWp[id] = null; r.busy = 0;
        if (r.stepOnce) { r.stepOnce = false; r.status = "HOLD"; }
        if (id === "CNC") w.kind = "machined";
        if (id === "PRS") w.kind = "pressed";
        if (id === "WLD") w.kind = "welded";
        if (id === "VIS" && w.reject) {
          this.wps = this.wps.filter((x) => x.id !== w.id); this.stats.rejects++; r.phase.divert = 1;
          this.log("warning", `Vision: part #${w.id} out of tolerance → rejected`);
        }
      }
    }
  }
  private cyclePhases(id: string, b: number) {
    const ph = this.rt[id].phase;
    const seg = (a: number, z: number) => Math.max(0, Math.min(1, (b - a) / (z - a)));
    if (id === "CNC") { ph.door = 1 - seg(0, 0.12) + seg(0.88, 1); ph.z = seg(0.12, 0.25) - seg(0.75, 0.88); ph.table = (ph.table ?? 0) + (b > 0.3 && b < 0.7 ? 0.02 : 0); }
    if (id === "PRS") ph.ram = Math.sin(Math.min(1, b) * Math.PI);
    if (id === "WLD") { ph.clamp = seg(0, 0.1) - seg(0.9, 1); ph.arc = b > 0.2 && b < 0.85 ? 1 : 0; }
  }
  private idlePhases(id: string, dt: number) {
    const ph = this.rt[id].phase;
    if (id === "VIS") ph.divert = Math.max(0, (ph.divert ?? 0) - dt * 2);
    if (id === "WLD") { ph.arc = 0; ph.clamp = Math.max(0, (ph.clamp ?? 0) - dt * 3); }
    if (id === "CNC") ph.door = Math.min(1, (ph.door ?? 1) + dt);
  }

  // ------------------------------------------------------------ palletizer program (pick at line end, stack 3 x 3)
  private palletize() {
    const r = this.rt.PAL;
    if (r.manual || !this.running("PAL")) return;
    if (this.palStep < 0) {
      const w = this.wps.find((x) => x.where === "line" && x.x >= ST.lineEnd - 1e-6);
      const slot = this.pallet.findIndex((s) => s === null);
      if (!w || slot < 0) return;
      this.palWp = w.id; this.palStep = 0; w.slot = slot; this.pallet[slot] = -1;
    }
  }
  palTargets(): Pose | null {
    if (this.palStep < 0 || this.palWp == null) return null;
    const w = this.wps.find((x) => x.id === this.palWp);
    if (!w) return null;
    const pick = PAL_PICK, place = palletSlot(w.slot);
    const placeLocal: V3 = [place[0], place[1] + 0.25, place[2]];
    return [palPose(pick, 0.6), palPose(pick), palPose(pick), palPose(pick, 0.9), palPose(placeLocal, 0.9), palPose(placeLocal), palPose(placeLocal), palPose(placeLocal, 0.9)][this.palStep] ?? null;
  }

  // ------------------------------------------------------------ robots: follow program targets (or manual setpoints) in joint space
  private robots(dt: number, k: number, estop: boolean) {
    // welding robots
    const wr = this.rt.WLD;
    if (!estop) {
      let target: Pose;
      if (wr.manual) target = wr.set;
      else if (this.stationWp.WLD != null && this.running("WLD")) {
        const b = wr.busy, sweep = Math.sin(b * Math.PI * 3) * 0.25;
        const lift = b < 0.15 || b > 0.85 ? 0.4 : 0;
        target = { ...weldPose("A", sweep, lift), ...weldPose("B", -sweep, lift) };
      } else target = MACHINE.WLD.defaults;
      const vmax = 90 * (wr.act.toolSpeed ?? 70) / 70 * k * dt;
      for (const key of Object.keys(target)) if (/J\d$/.test(key)) {
        const prev = wr.act[key] ?? 0;
        wr.act[key] = approach(prev, target[key], vmax);
        wr.phase[`${key.slice(0, 2)}v${key.slice(-1)}`] = (wr.act[key] - prev) / Math.max(dt, 1e-6) / 90;
      }
    }
    // palletizer
    const pr = this.rt.PAL;
    if (estop) return;
    let target: Pose | null = pr.manual ? pr.set : this.palTargets();
    if (!target) target = MACHINE.PAL.defaults;
    const vmax = 120 * (pr.act.toolSpeed ?? 80) / 80 * k * dt;
    let arrived = true;
    for (let n = 1; n <= 6; n++) {
      const key = `J${n}`, prev = pr.act[key] ?? 0;
      pr.act[key] = approach(prev, target[key] ?? 0, vmax);
      pr.phase[`v${n}`] = (pr.act[key] - prev) / Math.max(dt, 1e-6) / 120;
      if (Math.abs(pr.act[key] - (target[key] ?? 0)) > 0.05) arrived = false;
    }
    const gripTarget = pr.manual ? (pr.set.grip ?? 0) : (this.palStep >= 2 && this.palStep <= 5 ? 100 : 0);
    pr.act.grip = approach(pr.act.grip ?? 0, gripTarget, 250 * dt);
    if (!pr.manual && this.palStep >= 0 && arrived && this.running("PAL") && Math.abs(pr.act.grip - gripTarget) < 1) {
      const w = this.wps.find((x) => x.id === this.palWp);
      if (this.palStep === 2 && w) w.where = "robot";
      if (this.palStep === 6 && w) {
        w.where = "pallet"; this.pallet[w.slot] = w.id; this.stats.good++; pr.cycles++;
        if (this.pallet.every((s) => s !== null)) this.log("success", "Pallet complete (9 parts) - waiting for an AGV");
      }
      this.palStep++;
      if (this.palStep > 7) { this.palStep = -1; this.palWp = null; if (pr.stepOnce) { pr.stepOnce = false; pr.status = "HOLD"; } }
    }
  }

  // ------------------------------------------------------------ AGV fleet
  private placeAgv(a: AgvState) { const p = pathPoint(a.s); a.pos = [p.x, 0, p.z]; a.yaw = p.yaw; }
  private fleet(dt: number) {
    const sorted = [...this.agvs].sort((x, y) => x.s - y.s);
    for (const a of this.agvs) {
      const r = this.rt[a.id];
      r.phase.lift = approach(r.phase.lift ?? 0, a.carrying ? 1 : 0, dt * 2);
      if (r.status !== "RUN" || this.line.state === "ESTOP") { r.act.speed = 0; continue; }
      if (a.wait > 0) { a.wait -= dt; r.act.speed = 0; continue; }
      const idx = sorted.indexOf(a), ahead = sorted[(idx + 1) % sorted.length];
      const gap = ((ahead.s - a.s) % PATH_LEN + PATH_LEN) % PATH_LEN;
      const speed = gap < 3 ? 0 : (r.set.speed ?? 1.2);                  // keep distance from the AGV ahead
      r.act.speed = approach(r.act.speed ?? 0, speed, dt * 1.5);
      r.act.current = 4 + r.act.speed * 6 + (a.carrying ? 6 : 0);
      r.act.load = a.carrying === "pallet" ? 380 : a.carrying === "raw" ? 220 : 0;
      r.act.voltage = Math.max(44, (r.act.voltage ?? 51.2) - dt * 0.0005);
      const prev = a.s;
      a.s = (a.s + r.act.speed * dt) % PATH_LEN;
      r.phase.wheel = (r.phase.wheel ?? 0) + (r.act.speed / 0.12) * dt;
      STOP_S.forEach((s0, i) => {
        const ahead0 = ((s0 - prev) % PATH_LEN + PATH_LEN) % PATH_LEN, moved = ((a.s - prev) % PATH_LEN + PATH_LEN) % PATH_LEN;
        const crossed = ahead0 <= moved && moved < 5;           // works across the loop wrap-around
        if (!crossed || a.stop === i) return;
        a.s = s0; a.stop = i; a.wait = AGV_STOPS[i].wait;
        this.agvStop(a, i);
      });
      if (a.stop >= 0 && Math.abs(a.s - STOP_S[a.stop]) > 1) a.stop = -1;
      this.placeAgv(a);
    }
  }
  private agvStop(a: AgvState, i: number) {
    const name = AGV_STOPS[i].name;
    if (name === "rack pick") {
      if (a.carrying === "pallet") { this.stats.pallets++; this.log("success", `${a.id} stored finished pallet #${this.stats.pallets} in the high-bay rack`); a.carrying = null; }
      if (!a.carrying) a.carrying = "raw";
    } else if (name === "dispenser drop" && a.carrying === "raw") {
      a.carrying = null; this.stock += 6; this.log("info", `${a.id} delivered 6 raw carriers to the dispenser`);
    } else if (name === "outfeed pick" && !a.carrying && this.pallet.every((s) => s !== null && s >= 0)) {
      a.carrying = "pallet";
      this.wps = this.wps.filter((w) => w.where !== "pallet");
      this.pallet = Array(PALLET_SLOTS).fill(null);
      this.log("info", `${a.id} picked up a full pallet at the outfeed`);
    } else a.wait = Math.min(a.wait, 0.8);
  }
}

export const partsOf = (id: string) => allParts(MACHINE[id]);
