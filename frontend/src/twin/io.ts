// Factory I/O-style tag table for each machine, derived from the component tree and the live simulation:
//   DI  digital inputs  (sensor -> PLC): push-buttons, E-stop circuit, mode switch, every sensor part
//   DO  digital outputs (PLC -> actuator): run contactor, lamps, every actuator / motor part
//   AI  analog inputs   (actual values), AO analog outputs (setpoints): scaled 0-10 V like Factory I/O analog tags
// Forcing a tag (sim.forced) overrides its value, as in Factory I/O's failure injection / forcing.
import { MACHINE, allParts } from "./registry";
import type { TwinSim } from "./sim";

export type TagKind = "DI" | "DO" | "AI" | "AO";
export interface Tag { name: string; kind: TagKind; value: boolean | number; volts?: number; unit?: string; partId?: string; forced: boolean }

// actuator part -> runtime phase that drives it
const ACTUATOR_PHASE: [RegExp, string][] = [[/pusher|paddle/, "divert"], [/^DSP\.(cyl|rod|plate)/, "push"], [/^PRS\.(cyl|ram|rod)/, "ram"], [/clamp/, "clamp"], [/door/, "door"]];

export function ioTags(sim: TwinSim, machineId: string): Tag[] {
  const m = MACHINE[machineId], rt = sim.rt[machineId];
  const running = sim.line.state === "RUNNING" && rt.status === "RUN";
  const faults = sim.machineFaults(machineId);
  const tags: Omit<Tag, "forced">[] = [
    { name: `${m.id}.EStop_OK`, kind: "DI", value: sim.line.state !== "ESTOP" },
    { name: `${m.id}.Auto_Mode`, kind: "DI", value: !rt.manual },
    { name: `${m.id}.Guard_Closed`, kind: "DI", value: (rt.phase.door ?? 0) < 0.5 || m.id !== "CNC" },
  ];
  for (const p of allParts(m)) {
    const fault = faults.find((f) => f.partId === p.id);
    if (p.category === "sensor" && p.mat !== "laser") {
      let v = !fault;                                         // healthy sensor = signal OK
      if (/\.pe$|photo/i.test(p.id + p.name)) {               // photo-eyes really see the workpieces
        const x = m.position[0] + p.pos[0];
        v = sim.wps.some((w) => w.where === "line" && Math.abs(w.x - x) < 0.3) !== !!fault;
      }
      tags.push({ name: `${p.id}`, kind: "DI", value: v, partId: p.id });
    } else if (p.category === "actuator" || (p.category === "electrical" && /motor|j\dm$/i.test(p.id))) {
      const phase = ACTUATOR_PHASE.find(([re]) => re.test(p.id))?.[1];
      const v = phase ? (rt.phase[phase] ?? 0) > 0.5 : running && !fault;
      tags.push({ name: `${p.id}`, kind: "DO", value: v, partId: p.id });
    }
  }
  tags.push({ name: `${m.id}.Run_Lamp`, kind: "DO", value: running }, { name: `${m.id}.Fault_Lamp`, kind: "DO", value: faults.length > 0 });
  for (const c of m.controls) {
    const volts = (x: number) => +(((x - c.min) / (c.max - c.min)) * 10).toFixed(2);
    tags.push({ name: `${m.id}.${c.key}_SP`, kind: "AO", value: rt.set[c.key] ?? 0, volts: volts(rt.set[c.key] ?? 0), unit: c.unit });
    tags.push({ name: `${m.id}.${c.key}_PV`, kind: "AI", value: rt.act[c.key] ?? 0, volts: volts(rt.act[c.key] ?? 0), unit: c.unit });
  }
  return tags.map((t) => {
    const f = sim.forced[t.name];
    return f === undefined ? { ...t, forced: false } : { ...t, value: typeof t.value === "boolean" ? f === 1 : f, forced: true };
  });
}
