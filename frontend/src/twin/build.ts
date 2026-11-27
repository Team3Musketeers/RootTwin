// Compact part builder: every machine file describes its parts as data with sensible defaults.
import { ARM, type ArmDims } from "./kinematics";
import type { MachineRuntime, Part, PartCategory, V3 } from "./types";

type Init = Partial<Part> & { id: string; name: string; category: PartCategory; geo: Part["geo"]; pos: V3 };

export function partFactory(prefix: string) {
  let n = 0;
  return (o: Init): Part => ({
    partNumber: `${prefix}-${String(++n * 10).padStart(4, "0")}`,
    material: "Steel S355",
    description: "",
    maintenanceNotes: "Visual check every shift; follow LOTO before opening guards.",
    color: "#9ca3af",
    metalness: 0.6,
    roughness: 0.4,
    explodeVector: [0, 0, 0],
    explodeOrder: 0,
    assemblyAxis: "Y",
    ...o,
  });
}

export const fmt = (v: number, unit: string, digits = 1) => `${v.toFixed(digits)} ${unit}`;
const D = Math.PI / 180;

/** 6-axis industrial arm as a kinematic chain of parts. `k` prefixes the joint keys in the runtime (e.g. "A_" -> A_J1..A_J6). */
export function robotArm(p: ReturnType<typeof partFactory>, opt: {
  id: string; k: string; pos: V3; color: string; scale?: number; tool: "torch" | "gripper"; dims?: ArmDims;
}): Part[] {
  const s = opt.scale ?? 1, d = opt.dims ?? ARM, k = opt.k, id = opt.id;
  const J = (rt: MachineRuntime, n: number) => (rt.act[`${k}J${n}`] ?? 0) * D;
  const servo = (n: number) => (rt: MachineRuntime) => ({
    angle: `${(rt.act[`${k}J${n}`] ?? 0).toFixed(1)} °`,
    "servo current": `${(1.2 + Math.abs(rt.phase[`${k}v${n}`] ?? 0) * 0.8).toFixed(2)} A`,
    "winding temp": `${(38 + (rt.act.temp ?? 0) * 0.1 + n).toFixed(1)} °C`,
  });
  const servoInfo = (n: number, what: string) =>
    `J${n} axis: AC servo motor with absolute encoder and harmonic/RV reducer. ${what}`;
  return [
    p({ id: `${id}.base`, name: `${id} base & J1 bearing`, category: "structural", geo: { kind: "cyl", args: [0.42 * s, 0.5 * s, 0.3 * s] },
      pos: [opt.pos[0], opt.pos[1] + 0.15 * s, opt.pos[2]], color: "#334155", explodeVector: [0, -0.3 * s, 0], explodeOrder: 5,
      description: "Cast base bolted to the floor plate; houses the large J1 cross-roller bearing.", material: "Cast iron EN-GJS-400" }),
    p({ id: `${id}.j1`, name: `${id} J1 turret`, category: "actuator", parent: `${id}.base`, geo: { kind: "cyl", args: [0.36 * s, 0.4 * s, 0.45 * s] },
      pos: [0, 0.15 * s, 0], meshPos: [0, 0.22 * s, 0], color: opt.color, explodeVector: [0, 0.35 * s, 0], explodeOrder: 4,
      motion: (rt) => ({ rot: [0, J(rt, 1), 0] }), telemetry: servo(1), description: servoInfo(1, "Rotates the whole arm around the vertical axis.") }),
    p({ id: `${id}.j2`, name: `${id} J2 lower arm`, category: "actuator", parent: `${id}.j1`, geo: { kind: "box", args: [0.26 * s, d.l1 * s, 0.3 * s] },
      pos: [d.shoulderX * s, d.shoulderY * s, 0], meshPos: [0, (d.l1 / 2) * s, 0], color: opt.color, explodeVector: [0, 0, 0.45 * s], explodeOrder: 3, assemblyAxis: "Z",
      motion: (rt) => ({ rot: [0, 0, -J(rt, 2)] }), telemetry: servo(2), description: servoInfo(2, "Shoulder: leans the lower arm forward/back; carries most of the payload torque.") }),
    p({ id: `${id}.j2m`, name: `${id} J2 servo motor`, category: "electrical", parent: `${id}.j2`, geo: { kind: "cyl", args: [0.16 * s, 0.16 * s, 0.32 * s] },
      pos: [0, 0, 0.3 * s], rot: [Math.PI / 2, 0, 0], color: "#1f2937", explodeVector: [0, 0, 0.5 * s], explodeOrder: 1, assemblyAxis: "Z",
      telemetry: servo(2), description: "Shoulder servo motor (brake + encoder)." }),
    p({ id: `${id}.j3`, name: `${id} J3 upper arm`, category: "actuator", parent: `${id}.j2`, geo: { kind: "box", args: [d.l2 * s, 0.22 * s, 0.24 * s] },
      pos: [0, d.l1 * s, 0], meshPos: [(d.l2 / 2) * s, 0, 0], color: opt.color, explodeVector: [0, 0.35 * s, 0], explodeOrder: 2,
      motion: (rt) => ({ rot: [0, 0, -J(rt, 3)] }), telemetry: servo(3), description: servoInfo(3, "Elbow: raises/lowers the upper arm.") }),
    p({ id: `${id}.j3m`, name: `${id} J3 servo motor`, category: "electrical", parent: `${id}.j3`, geo: { kind: "cyl", args: [0.13 * s, 0.13 * s, 0.3 * s] },
      pos: [-0.12 * s, 0, 0.24 * s], rot: [Math.PI / 2, 0, 0], color: "#1f2937", explodeVector: [0, 0, 0.45 * s], explodeOrder: 1, assemblyAxis: "Z",
      telemetry: servo(3), description: "Elbow servo motor." }),
    p({ id: `${id}.j4`, name: `${id} J4 forearm roll`, category: "actuator", parent: `${id}.j3`, geo: { kind: "cyl", args: [0.1 * s, 0.1 * s, 0.3 * s] },
      pos: [d.l2 * s, 0, 0], meshPos: [0.15 * s, 0, 0], meshRot: [0, 0, Math.PI / 2], color: "#e5e7eb", explodeVector: [0.35 * s, 0, 0], explodeOrder: 2, assemblyAxis: "X",
      motion: (rt) => ({ rot: [J(rt, 4), 0, 0] }), telemetry: servo(4), description: servoInfo(4, "Rolls the forearm around its own axis.") }),
    p({ id: `${id}.j5`, name: `${id} J5 wrist`, category: "actuator", parent: `${id}.j4`, geo: { kind: "box", args: [0.16 * s, 0.14 * s, 0.18 * s] },
      pos: [d.forearm * s, 0, 0], meshPos: [0.08 * s, 0, 0], color: opt.color, explodeVector: [0.3 * s, 0, 0], explodeOrder: 1, assemblyAxis: "X",
      motion: (rt) => ({ rot: [0, 0, -J(rt, 5)] }), telemetry: servo(5), description: servoInfo(5, "Bends the wrist; keeps the tool pointing at the workpiece.") }),
    p({ id: `${id}.j6`, name: `${id} J6 flange`, category: "actuator", parent: `${id}.j5`, geo: { kind: "cyl", args: [0.08 * s, 0.08 * s, 0.05 * s] },
      pos: [(d.wrist - d.forearm) * s, 0, 0], meshRot: [0, 0, Math.PI / 2], color: "#9ca3af", explodeVector: [0.25 * s, 0, 0], explodeOrder: 0, assemblyAxis: "X",
      motion: (rt) => ({ rot: [J(rt, 6), 0, 0] }), telemetry: servo(6), description: servoInfo(6, "Tool flange (ISO 9409) rotation.") }),
    ...(opt.tool === "torch" ? [
      p({ id: `${id}.tool`, name: `${id} MIG welding torch`, category: "tooling" as PartCategory, parent: `${id}.j6`,
        geo: { kind: "cyl", args: [0.03 * s, 0.05 * s, d.tool * s] }, pos: [d.tool / 2 * s, 0, 0], meshRot: [0, 0, Math.PI / 2],
        color: "#b45309", explodeVector: [0.3 * s, 0, 0], explodeOrder: 0, assemblyAxis: "X" as const, material: "Copper contact tip, brass nozzle",
        description: "Gas-shielded MIG torch: wire feed through the contact tip, shielding gas around the arc.",
        maintenanceNotes: "Replace contact tip every 8 h of arc time; clean spatter from the nozzle.",
        telemetry: (rt: MachineRuntime) => ({ "weld current": `${((rt.act.power ?? 0) * 2.8).toFixed(0)} A`, "wire speed": `${((rt.act.toolSpeed ?? 0) * 0.09).toFixed(1)} m/min` }) }),
    ] : [
      p({ id: `${id}.tool`, name: `${id} vacuum gripper`, category: "tooling" as PartCategory, parent: `${id}.j6`,
        geo: { kind: "box", args: [0.12 * s, 0.6 * s, 0.6 * s] }, pos: [(d.tool - 0.06) * s, 0, 0], color: "#475569", explodeVector: [0.35 * s, 0, 0], explodeOrder: 0, assemblyAxis: "X" as const,
        description: "Vacuum gripper plate with 4 suction cups and a vacuum switch.", material: "Aluminium 6082, NBR suction cups",
        maintenanceNotes: "Check suction cups for cracks weekly; vacuum must reach -0.6 bar.",
        telemetry: (rt: MachineRuntime) => ({ vacuum: `${(-0.7 * (rt.act.grip ?? 0) / 100).toFixed(2)} bar`, grip: `${(rt.act.grip ?? 0).toFixed(0)} %` }) }),
    ]),
  ];
}
