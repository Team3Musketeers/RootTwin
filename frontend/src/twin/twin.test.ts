import { describe, expect, it } from "vitest";
import { explodeProgress } from "./explode";
import { ARM, armFK, armIK } from "./kinematics";
import { PAL_BASE, PAL_DIMS, PAL_SCALE, WELD_BASE, WELD_DIMS, WELD_SCALE } from "./machines/cells";
import { palletSlot } from "./sim";
import { BELT_Y, ST } from "./layout";
import { MACHINES, allParts, partById } from "./registry";
import { applyAction } from "../services/floor";
import { ioTags } from "./io";
import { TwinSim } from "./sim";

const run = (s: TwinSim, seconds: number) => { for (let t = 0; t < seconds; t += 0.1) s.tick(0.1); };

describe("model", () => {
  it("every machine has a valid component tree, faults and controls", () => {
    const ids = new Set<string>();
    for (const m of MACHINES) {
      expect(m.subAssemblies.length).toBeGreaterThan(0);
      for (const p of allParts(m)) {
        expect(ids.has(p.id), `duplicate ${p.id}`).toBe(false);
        ids.add(p.id);
        if (p.parent) expect(partById(p.parent), `${p.id} parent`).toBeDefined();
        expect(p.partNumber).toMatch(/^[A-Z0-9]+-\d{4}$/);
      }
      for (const f of m.faults) expect(allParts(m).some((p) => p.id === f.partId), `${m.id} fault ${f.code}`).toBe(true);
      for (const c of m.controls) expect(m.defaults[c.key], `${m.id} default ${c.key}`).toBeDefined();
    }
    expect(MACHINES.length).toBeGreaterThanOrEqual(11);                     // 8 machine types incl. 3 AGVs + conveyors
  });

  it("CAD quality gate: 15+ parts per machine, real shapes, housings for X-ray", () => {
    for (const m of MACHINES) {
      const parts = allParts(m);
      expect(parts.length, m.id).toBeGreaterThanOrEqual(15);
      const plain = parts.filter((p) => p.geo.kind === "rbox" || p.geo.kind === "cyl").length;
      expect(plain / parts.length, `${m.id} too many primitive parts`).toBeLessThan(0.6);
      if (m.type !== "agv") expect(parts.some((p) => p.housing), `${m.id} has no X-ray housing`).toBe(true);
    }
  });
  it("explode progress is staggered and bounded", () => {
    expect(explodeProgress(0, 0, 5)).toBe(0);
    expect(explodeProgress(1, 5, 5)).toBe(1);
    expect(explodeProgress(0.3, 0, 5)).toBeGreaterThan(explodeProgress(0.3, 5, 5));
  });
});

describe("kinematics", () => {
  it("IK places the tool tip on the target (FK round trip)", () => {
    for (const t of [[1.4, 1.4, 0.3], [0.2, 1.45, 1.6], [-1.2, 0.9, 1.1], [1.0, 0.5, -1.2]] as [number, number, number][]) {
      const tip = armFK(armIK(t));
      expect(Math.hypot(tip[0] - t[0], tip[1] - t[1], tip[2] - t[2])).toBeLessThan(1e-6);
    }
    const s = 1.25, t: [number, number, number] = [-1.8, 1.4, 1.4];
    const tip = armFK(armIK(t, ARM, s), ARM, s);
    expect(Math.hypot(tip[0] - t[0], tip[1] - t[1], tip[2] - t[2])).toBeLessThan(1e-6);
  });
});

describe("real KUKA arms", () => {
  it("KR 16-2 reaches the whole weld seam and KR 120 every pallet slot (FK(IK(target)) = target)", () => {
    for (const [r, z] of [["A", -0.3], ["B", 0.3]] as const) for (const x of [-0.5, 0, 0.5]) {
      const b = WELD_BASE[r], t: [number, number, number] = [x - b[0], BELT_Y + 0.55, z - b[2]];
      const tip = armFK(armIK(t, WELD_DIMS, WELD_SCALE), WELD_DIMS, WELD_SCALE);
      tip.forEach((v, i) => expect(v).toBeCloseTo(t[i], 3));
    }
    for (let i = 0; i < 9; i++) {
      const p = palletSlot(i), t: [number, number, number] = [ST.palletizer + p[0] - ST.palletizer - PAL_BASE[0], p[1], p[2] - PAL_BASE[2]];
      const tip = armFK(armIK(t, PAL_DIMS, PAL_SCALE), PAL_DIMS, PAL_SCALE);
      tip.forEach((v, k) => expect(v).toBeCloseTo(t[k], 3));
    }
  });
});

describe("TwinSim", () => {
  it("runs the full flow: dispense, process, palletize, AGV pick-up and delivery", () => {
    const s = new TwinSim();
    s.line.spawnInterval = 4;
    run(s, 400);
    const k = s.kpis();
    expect(k.good).toBeGreaterThanOrEqual(9);
    expect(s.stats.pallets + (s.agvs.some((a) => a.carrying === "pallet") ? 1 : 0)).toBeGreaterThanOrEqual(1);
    expect(s.events.some((e) => e.text.includes("delivered 6 raw carriers"))).toBe(true);
    expect(k.oee).toBeGreaterThan(0);
  });

  it("a critical fault stops its station and the line accumulates; clearing resumes", () => {
    const s = new TwinSim();
    s.line.spawnInterval = 3;
    const f = s.injectFault("PRS", "PRS-INBRG")!;
    expect(s.rt.PRS.status).toBe("FAULT");
    expect(s.health()).toBe("FAULT");
    run(s, 120);
    expect(s.wps.some((w) => w.done.has("PRS"))).toBe(false);
    expect(s.rt.PRS.phase.heat).toBe(1);
    s.clearFault(f.id);
    run(s, 60);
    expect(s.wps.some((w) => w.done.has("PRS"))).toBe(true);
  });

  it("operator overload damages a part, trips the line interlock, repair + Start resumes", () => {
    const s = new TwinSim();
    s.setValue("CNC", "rpm", 11800);                  // > 90 % of 12 000 rpm
    for (let i = 0; i < 60; i++) s.tick(0.1);
    const f = s.interlock()!;
    expect(f.partId).toBe("CNC.spbrg");
    expect(s.line.state).toBe("STOPPED");
    s.setLine("RUNNING");
    expect(s.line.state).toBe("STOPPED");            // wrong sequence: refused while the red part is not repaired
    s.setValue("CNC", "rpm", 8000);
    s.startRepair(f.id, "tester");
    for (let i = 0; i < 50; i++) s.tick(0.1);
    expect(s.faults).toHaveLength(0);
    s.setLine("RUNNING");
    expect(s.line.state).toBe("RUNNING");
  });

  it("I/O tags: every machine has DI/DO/AI/AO; forcing a sensor injects its fault; time scale 0 freezes", () => {
    const s = new TwinSim();
    for (const m of MACHINES) {
      const kinds = new Set(ioTags(s, m.id).map((t) => t.kind));
      expect([...kinds].sort(), m.id).toEqual(["AI", "AO", "DI", "DO"]);
    }
    const pe = ioTags(s, "DSP").find((t) => t.partId === "DSP.pe")!;
    applyAction(s, { m: "force", id: "DSP", tag: pe.name, v: 0, part: "DSP.pe" });
    expect(ioTags(s, "DSP").find((t) => t.name === pe.name)).toMatchObject({ value: false, forced: true });
    expect(s.partFault("DSP.pe")).toBeTruthy();
    applyAction(s, { m: "speed", v: 0 });
    const t = s.t; s.tick(1);
    expect(s.t).toBe(t);
  });

  it("E-stop freezes everything until reset", () => {
    const s = new TwinSim();
    run(s, 30);
    s.setLine("ESTOP");
    const xs = s.wps.map((w) => w.x), agv = s.agvs.map((a) => a.s);
    run(s, 10);
    expect(s.wps.map((w) => w.x)).toEqual(xs);
    expect(s.agvs.map((a) => a.s)).toEqual(agv);
    s.setLine("RUNNING");
    expect(s.line.state).toBe("ESTOP");                   // refused until reset
    s.resetEstop(); s.setLine("RUNNING");
    expect(s.line.state).toBe("RUNNING");
  });

  it("manual joint control drives the robot and Run returns to the program", () => {
    const s = new TwinSim();
    s.setValue("PAL", "J1", 0);
    run(s, 5);
    expect(s.rt.PAL.act.J1).toBeCloseTo(0, 3);
    s.setMachine("PAL", "RUN");
    expect(s.rt.PAL.manual).toBe(false);
  });
});
