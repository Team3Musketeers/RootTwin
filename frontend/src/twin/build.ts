// Part builder + CAD shape shorthands + the 6-axis industrial robot assembly.
import { ARM, type ArmDims } from "./kinematics";
import type { MachineRuntime, MatName, Part, PartCategory, Shape, V3 } from "./types";

type Init = Partial<Part> & { id: string; name: string; category: PartCategory; geo: Shape; pos: V3; mat: MatName };

export function partFactory(prefix: string) {
  let n = 0;
  return (o: Init): Part => ({
    partNumber: `${prefix}-${String(++n * 10).padStart(4, "0")}`,
    material: "Steel S355",
    description: "",
    maintenanceNotes: "Visual check every shift; follow LOTO before opening guards.",
    explodeVector: [0, 0, 0],
    explodeOrder: 0,
    assemblyAxis: "Y",
    ...o,
  });
}

export const fmt = (v: number, unit: string, digits = 1) => `${v.toFixed(digits)} ${unit}`;

// ------------------------------------------------------------------ CAD shorthands
const PI = Math.PI;
export const X: V3 = [0, 0, -PI / 2];           // rotate a +y-axis shape so its axis points along +x
export const Z: V3 = [PI / 2, 0, 0];            // ... along +z
export const rb = (w: number, h: number, d: number, r = 0.015): Shape => ({ kind: "rbox", size: [w, h, d], r });
export const cy = (r: number, h: number, r2?: number): Shape => ({ kind: "cyl", r, h, r2 });
export const comp = (...items: { shape: Shape; pos?: V3; rot?: V3 }[]): Shape => ({ kind: "compound", items });
export const at = (shape: Shape, pos?: V3, rot?: V3) => ({ shape, pos, rot });
export const lathe = (pts: [number, number][]): Shape => ({ kind: "lathe", pts });
export const motorS = (r: number, len: number): Shape => ({ kind: "motor", r, len });
export const bolts = (radius: number, n: number, size = 0.02): Shape => ({ kind: "bolts", radius, n, size });
export const hose = (pts: V3[], r: number, corrugated = false): Shape => ({ kind: "tube", pts, r, corrugated });
/** Pneumatic / hydraulic cylinder along +y: barrel, end caps, tie rods. */
export const pneuCyl = (r: number, len: number): Shape => comp(
  at(cy(r, len)), at(cy(r * 1.25, r * 0.7), [0, -len / 2, 0]), at(cy(r * 1.25, r * 0.7), [0, len / 2, 0]),
  ...[0, 1, 2, 3].map((i) => at(cy(r * 0.09, len), [Math.cos(i * PI / 2 + PI / 4) * r * 1.1, 0, Math.sin(i * PI / 2 + PI / 4) * r * 1.1])),
);
/** Sheet-metal panel: thin filleted plate. */
/** Sheet-metal panel: face + folded return flanges + pressed stiffening bead + perimeter fasteners (ISO 7380).
 *  Works for any orientation: the thinnest of w / h / t is the sheet normal. */
export function panel(w: number, h: number, t = 0.03): Shape {
  const dims = [w, h, t], n = dims.indexOf(Math.min(w, h, t)), [ia, ib] = [0, 1, 2].filter((i) => i !== n);
  const A = dims[ia], B = dims[ib], T = dims[n];
  const v = (a: number, b: number, c: number): V3 => { const o: V3 = [0, 0, 0]; o[ia] = a; o[ib] = b; o[n] = c; return o; };
  const box = (a: number, b: number, c: number) => { const sz = v(a, b, c) as V3; return rb(sz[0], sz[1], sz[2], Math.min(0.006, Math.min(a, b, c) / 2.2)); };
  const lip = Math.min(0.035, Math.min(A, B) * 0.08), f = Math.max(0.006, T * 0.4);
  const boltRot: V3 = n === 0 ? [0, 0, PI / 2] : n === 2 ? [PI / 2, 0, 0] : [0, 0, 0];
  const items = [
    at(rb(...(v(A, B, T) as V3), Math.min(0.012, T / 2.2))),
    at(box(A, f, lip), v(0, B / 2 - f / 2, -lip / 2)), at(box(A, f, lip), v(0, -B / 2 + f / 2, -lip / 2)),     // folded flanges
    at(box(f, B, lip), v(A / 2 - f / 2, 0, -lip / 2)), at(box(f, B, lip), v(-A / 2 + f / 2, 0, -lip / 2)),
  ];
  if (Math.max(A, B) > 0.9) items.push(A >= B ? at(box(A * 0.8, 0.03, T * 0.6), v(0, 0, T * 0.5)) : at(box(0.03, B * 0.8, T * 0.6), v(0, 0, T * 0.5)));   // bead
  if (Math.min(A, B) > 0.25) {
    const per = (len: number) => Math.max(2, Math.round(len / 0.4));
    for (const [len, other, alongA] of [[A, B, true], [B, A, false]] as const)
      for (let i = 0; i < per(len); i++) for (const sgn of [-1, 1]) {
        const p = -len / 2 + 0.05 + (i * (len - 0.1)) / (per(len) - 1), q = sgn * (other / 2 - 0.035);
        items.push(at({ kind: "cyl", r: 0.008, h: 0.006, seg: 10 }, alongA ? v(p, q, T / 2 + 0.003) : v(q, p, T / 2 + 0.003), boltRot));
      }
  }
  return comp(...items);
}
/** Rounded rectangle outline (w x h, corner radius r) for extrusions. */
export function roundedRectOutline(w: number, h: number, r: number): [number, number][] {
  const out: [number, number][] = [];
  const corner = (cx: number, cy: number, a0: number) => { for (let i = 0; i <= 5; i++) { const a = a0 + (i / 5) * (PI / 2); out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); } };
  corner(w / 2 - r, -h / 2 + r, -PI / 2); corner(w / 2 - r, h / 2 - r, 0); corner(-w / 2 + r, h / 2 - r, PI / 2); corner(-w / 2 + r, -h / 2 + r, PI);
  return out;
}
/** Link side-profile: capsule-like tapered plate between two bosses (along +y). */
export function linkProfile(len: number, w0: number, w1: number): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i <= 10; i++) { const a = PI + (i / 10) * PI; pts.push([Math.cos(a) * w0 / 2, Math.sin(a) * w0 / 2]); }
  for (let i = 0; i <= 10; i++) { const a = (i / 10) * PI; pts.push([Math.cos(a) * w1 / 2, len + Math.sin(a) * w1 / 2]); }
  return pts;
}

// ------------------------------------------------------------------ 6-axis industrial robot
const D = PI / 180;
export function robotArm(p: ReturnType<typeof partFactory>, opt: {
  id: string; k: string; pos: V3; paint: MatName; scale?: number; tool: "torch" | "gripper"; dims?: ArmDims;
}): Part[] {
  const s = opt.scale ?? 1, d = opt.dims ?? ARM, k = opt.k, id = opt.id, paint = opt.paint;
  const S = (v: number) => v * s;
  const J = (rt: MachineRuntime, n: number) => (rt.act[`${k}J${n}`] ?? 0) * D;
  const servo = (n: number) => (rt: MachineRuntime) => ({
    angle: `${(rt.act[`${k}J${n}`] ?? 0).toFixed(1)} °`,
    "servo current": `${(1.2 + Math.abs(rt.phase[`${k}v${n}`] ?? 0) * 0.8 + (rt.phase.heat ?? 0) * 3).toFixed(2)} A`,
    "winding temp": `${(38 + n + (rt.phase.heat ?? 0) * 55).toFixed(1)} °C`,
    encoder: "23-bit absolute, OK",
  });
  const info = (n: number, what: string) => `J${n}: AC servo motor + harmonic drive reducer, absolute encoder, holding brake. ${what}`;
  const L2 = d.l2;
  const parts: Part[] = [
    p({ id: `${id}.base`, name: `${id} cast base pedestal`, category: "structural", mat: "castIron", pos: opt.pos, explodeVector: [0, -S(0.35), 0], explodeOrder: 6,
      geo: comp(at(lathe([[0, 0], [S(0.52), 0], [S(0.52), S(0.05)], [S(0.44), S(0.08)], [S(0.39), S(0.24)], [S(0.36), S(0.3)], [0, S(0.3)]])),
        ...[0, 1, 2, 3, 4, 5].map((i) => at(rb(S(0.12), S(0.2), S(0.035), S(0.01)), [Math.cos(i * PI / 3) * S(0.43), S(0.14), Math.sin(i * PI / 3) * S(0.43)], [0, -i * PI / 3, 0])),
        at(bolts(S(0.47), 8, S(0.022)), [0, S(0.05), 0])),
      material: "Cast iron EN-GJS-400-15", tolerance: "base flatness 0.05 mm",
      description: "Ribbed cast pedestal anchored with 8 × M20 chemical anchors; houses the J1 cross-roller bearing." }),
    p({ id: `${id}.jbox`, name: `${id} cable junction box`, category: "electrical", mat: "graphite", parent: `${id}.base`, pos: [-S(0.42), S(0.18), 0], explodeVector: [-S(0.4), 0, 0], explodeOrder: 1, assemblyAxis: "X",
      geo: comp(at(rb(S(0.12), S(0.2), S(0.26), S(0.02))), at(cy(S(0.035), S(0.08)), [-S(0.08), 0, S(0.07)], [0, 0, PI / 2]), at(cy(S(0.035), S(0.08)), [-S(0.08), 0, -S(0.07)], [0, 0, PI / 2])),
      description: "Power, encoder and air connections (Harting connectors) between the controller cable and the arm dress pack." }),
    p({ id: `${id}.j1`, name: `${id} J1 turret casting`, category: "actuator", mat: paint, parent: `${id}.base`, pos: [0, S(0.3), 0], explodeVector: [0, S(0.4), 0], explodeOrder: 5,
      geo: comp(at(lathe([[0, 0], [S(0.37), 0], [S(0.39), S(0.04)], [S(0.36), S(0.11)], [0, S(0.11)]])),
        at(rb(S(0.5), S(0.46), S(0.5), S(0.09)), [S(0.1), S(0.33), 0]),
        at(cy(S(0.2), S(0.6)), [S(0.2), S(0.55), 0], Z)),
      motion: (rt) => ({ rot: [0, J(rt, 1), 0] }), telemetry: servo(1), housing: true, material: "Cast aluminium AlSi10Mg, powder coat",
      description: info(1, "Rotates the whole arm around the vertical axis (±185°).") }),
    p({ id: `${id}.j1m`, name: `${id} J1 servo motor`, category: "electrical", mat: "graphite", parent: `${id}.j1`, pos: [-S(0.2), S(0.32), 0], explodeVector: [-S(0.5), S(0.2), 0], explodeOrder: 1, assemblyAxis: "X",
      geo: motorS(S(0.085), S(0.28)), telemetry: servo(1), description: "J1 AC servo, 3.7 kW, 23-bit encoder." }),
    p({ id: `${id}.j2`, name: `${id} J2 lower arm`, category: "actuator", mat: paint, parent: `${id}.j1`, pos: [S(d.shoulderX), S(d.shoulderY), 0], explodeVector: [0, 0, S(0.55)], explodeOrder: 4, assemblyAxis: "Z",
      geo: { kind: "extrude", outline: linkProfile(S(d.l1), S(0.34), S(0.26)), depth: S(0.26), bevel: S(0.03) },
      motion: (rt) => ({ rot: [0, 0, -J(rt, 2)] }), telemetry: servo(2), housing: true, material: "Cast aluminium, powder coat",
      description: info(2, "Shoulder: leans the lower arm forward/back; carries the payload moment.") }),
    p({ id: `${id}.j2m`, name: `${id} J2 servo motor`, category: "electrical", mat: "graphite", parent: `${id}.j2`, pos: [0, 0, S(0.26)], rot: Z, explodeVector: [0, 0, S(0.55)], explodeOrder: 0, assemblyAxis: "Z",
      geo: motorS(S(0.1), S(0.3)), telemetry: servo(2), description: "J2 AC servo motor, 5.5 kW, brake 24 V DC.", maintenanceNotes: "Replace if winding temp > 120 °C repeatedly; check brake release at every service." }),
    p({ id: `${id}.j2r`, name: `${id} J2 harmonic drive reducer`, category: "mechanical", mat: "steel", parent: `${id}.j2`, pos: [0, 0, -S(0.17)], rot: Z, explodeVector: [0, 0, -S(0.5)], explodeOrder: 2, assemblyAxis: "Z",
      geo: comp(at(cy(S(0.17), S(0.07))), at(cy(S(0.13), S(0.05)), [0, -S(0.05), 0]), at(bolts(S(0.15), 12, S(0.012)), [0, S(0.035), 0])),
      tolerance: "backlash < 1 arcmin", description: "Strain-wave (harmonic) gear, ratio 1:121, zero backlash." }),
    p({ id: `${id}.cb`, name: `${id} counterbalance cylinder`, category: "actuator", mat: "chrome", parent: `${id}.j2`, pos: [-S(0.2), S(0.4), 0], rot: [0, 0, 0.12], explodeVector: [-S(0.45), 0, 0], explodeOrder: 1, assemblyAxis: "X",
      geo: comp(at(cy(S(0.055), S(0.5)), [0, -S(0.1), 0]), at(cy(S(0.025), S(0.42)), [0, S(0.3), 0])),
      description: "Gas-spring counterbalance relieving the J2 motor from the arm weight." }),
    p({ id: `${id}.cbSpring`, name: `${id} counterbalance coil spring`, category: "mechanical", mat: "graphite", parent: `${id}.cb`, pos: [0, -S(0.1), 0], explodeVector: [-S(0.3), 0, 0], explodeOrder: 0,
      geo: { kind: "helix", r: S(0.07), pitch: S(0.04), turns: 11, wire: S(0.011) }, material: "Spring steel 51CrV4, shot-peened",
      description: "Coil spring around the counterbalance cylinder; carries the static arm weight so the J2 servo only supplies dynamic torque." }),
    p({ id: `${id}.j3`, name: `${id} J3 elbow & upper arm`, category: "actuator", mat: paint, parent: `${id}.j2`, pos: [0, S(d.l1), 0], explodeVector: [0, S(0.45), 0], explodeOrder: 3,
      geo: comp(at(rb(S(0.38), S(0.34), S(0.36), S(0.08)), [S(0.03), 0, 0]), at(cy(S(0.17), S(0.42)), [0, 0, 0], Z),
        at(cy(S(0.11), S(L2 - 0.12), S(0.085)), [S((L2 + 0.12) / 2), S(0.02), 0], X)),
      motion: (rt) => ({ rot: [0, 0, -J(rt, 3)] }), telemetry: servo(3), housing: true, description: info(3, "Elbow: raises/lowers the upper arm.") }),
    p({ id: `${id}.j3m`, name: `${id} J3 servo motor`, category: "electrical", mat: "graphite", parent: `${id}.j3`, pos: [-S(0.28), S(0.04), 0], rot: [0, 0, PI / 2], explodeVector: [-S(0.5), S(0.2), 0], explodeOrder: 0, assemblyAxis: "X",
      geo: motorS(S(0.075), S(0.24)), telemetry: servo(3), description: "J3 AC servo motor, 2.2 kW.", maintenanceNotes: "J3 servo faults: check the motor cable at the elbow (flex wear), then the encoder battery." }),
    p({ id: `${id}.j3r`, name: `${id} J3 harmonic drive reducer`, category: "mechanical", mat: "steel", parent: `${id}.j3`, pos: [0, 0, S(0.24)], rot: Z, explodeVector: [0, 0, S(0.45)], explodeOrder: 1, assemblyAxis: "Z",
      geo: comp(at(cy(S(0.14), S(0.06))), at(bolts(S(0.12), 10, S(0.011)), [0, S(0.03), 0])), tolerance: "backlash < 1 arcmin" }),
    p({ id: `${id}.dress`, name: `${id} dress-pack hose`, category: "electrical", mat: "rubber", parent: `${id}.j3`, pos: [0, 0, 0], explodeVector: [0, S(0.35), S(0.25)], explodeOrder: 0,
      geo: hose([[-S(0.15), S(0.2), S(0.12)], [S(0.15), S(0.28), S(0.12)], [S(L2 * 0.6), S(0.2), S(0.1)], [S(L2 + 0.25), S(0.12), S(0.06)]], S(0.035), true),
      description: "Corrugated protective hose carrying weld power, wire, gas and signal cables to the wrist.", maintenanceNotes: "Replace when the corrugation cracks; check clamps every 3 months." }),
    p({ id: `${id}.j4`, name: `${id} J4 forearm roll`, category: "actuator", mat: paint, parent: `${id}.j3`, pos: [S(L2), 0, 0], explodeVector: [S(0.4), 0, 0], explodeOrder: 2, assemblyAxis: "X",
      geo: comp(at(cy(S(0.085), S(d.forearm), S(0.075)), [S(d.forearm / 2), 0, 0], X), at(cy(S(0.095), S(0.03)), [S(0.015), 0, 0], X)),
      motion: (rt) => ({ rot: [J(rt, 4), 0, 0] }), telemetry: servo(4), description: info(4, "Rolls the forearm around its own axis.") }),
    p({ id: `${id}.j5`, name: `${id} J5 wrist`, category: "actuator", mat: paint, parent: `${id}.j4`, pos: [S(d.forearm), 0, 0], explodeVector: [S(0.35), 0, 0], explodeOrder: 1, assemblyAxis: "X",
      geo: comp(at(rb(S(0.17), S(0.15), S(0.2), S(0.05)), [S(0.07), 0, 0]), at(cy(S(0.075), S(0.24)), [0, 0, 0], Z)),
      motion: (rt) => ({ rot: [0, 0, -J(rt, 5)] }), telemetry: servo(5), description: info(5, "Bends the wrist; keeps the tool on the work.") }),
    p({ id: `${id}.j6`, name: `${id} J6 tool flange`, category: "actuator", mat: "steel", parent: `${id}.j5`, pos: [S(d.wrist - d.forearm), 0, 0], explodeVector: [S(0.3), 0, 0], explodeOrder: 0, assemblyAxis: "X",
      geo: comp(at(lathe([[0, -S(0.025)], [S(0.075), -S(0.025)], [S(0.075), S(0.02)], [S(0.06), S(0.025)], [0, S(0.025)]]), [0, 0, 0], X), at(bolts(S(0.05), 6, S(0.008)), [S(0.025), 0, 0], X)),
      motion: (rt) => ({ rot: [J(rt, 6), 0, 0] }), telemetry: servo(6), tolerance: "ISO 9409-1-50-4-M6", description: info(6, "Tool flange rotation.") }),
  ];
  if (opt.tool === "torch") parts.push(
    p({ id: `${id}.tool`, name: `${id} MIG welding torch`, category: "tooling", mat: "plasticBlack", parent: `${id}.j6`, pos: [0, 0, 0], explodeVector: [S(0.35), 0, 0], explodeOrder: 0, assemblyAxis: "X",
      geo: comp(at(cy(S(0.045), S(0.1)), [S(0.05), 0, 0], X), at(hose([[S(0.1), 0, 0], [S(0.2), 0, 0], [S(0.3), S(0.02), 0]], S(0.022))), at(cy(S(0.026), S(0.07), S(0.02)), [S(d.tool - 0.04), S(0.02), 0], X)),
      material: "Copper contact tip, brass nozzle, glass-fibre insulator", tolerance: "TCP repeatability ±0.05 mm",
      description: "Gas-shielded MIG/MAG torch: wire through the contact tip, Ar/CO₂ shielding gas through the nozzle.",
      maintenanceNotes: "Replace the contact tip every 8 h of arc time; clean spatter from the nozzle; check the TCP after a crash.",
      telemetry: (rt) => ({ "weld current": `${((rt.act.power ?? 0) * 2.8).toFixed(0)} A`, "arc voltage": `${(18 + (rt.act.power ?? 0) * 0.08).toFixed(1)} V`, "wire speed": `${((rt.act.toolSpeed ?? 0) * 0.09).toFixed(1)} m/min` }) }),
    p({ id: `${id}.nozzle`, name: `${id} gas nozzle & contact tip`, category: "tooling", mat: "copper", parent: `${id}.tool`, pos: [S(d.tool - 0.01), S(0.02), 0], explodeVector: [S(0.25), 0, 0], explodeOrder: 0, assemblyAxis: "X",
      geo: comp(at(cy(S(0.018), S(0.04), S(0.012)), [0, 0, 0], X), at(cy(S(0.005), S(0.03)), [S(0.03), 0, 0], X)), material: "CuCrZr contact tip" }),
  ); else parts.push(
    p({ id: `${id}.tool`, name: `${id} vacuum gripper`, category: "tooling", mat: "brushedAlu", parent: `${id}.j6`, pos: [S(d.tool - 0.06), 0, 0], explodeVector: [S(0.4), 0, 0], explodeOrder: 0, assemblyAxis: "X",
      geo: comp(at(rb(S(0.06), S(0.6), S(0.6), S(0.02))), at(rb(S(0.12), S(0.12), S(0.12), S(0.03)), [-S(0.08), 0, 0]),
        ...[[-1, -1], [-1, 1], [1, -1], [1, 1]].map(([a, b]) => at(lathe([[0, 0], [S(0.05), 0], [S(0.06), S(0.03)], [S(0.07), S(0.05)], [0, S(0.05)]]), [S(0.03), a * S(0.2), b * S(0.2)], X))),
      material: "Aluminium 6082-T6, NBR suction cups", description: "Vacuum gripper with 4 bellows suction cups and a vacuum switch.",
      maintenanceNotes: "Check suction cups for cracks weekly; vacuum must reach -0.6 bar within 0.3 s.",
      telemetry: (rt) => ({ vacuum: `${(-0.7 * (rt.act.grip ?? 0) / 100 + (rt.phase.leak ?? 0) * 0.2).toFixed(2)} bar`, grip: `${(rt.act.grip ?? 0).toFixed(0)} %` }) }),
    p({ id: `${id}.ejector`, name: `${id} vacuum ejector & valves`, category: "actuator", mat: "paintBlue", parent: `${id}.tool`, pos: [-S(0.08), S(0.18), 0], explodeVector: [0, S(0.35), 0], explodeOrder: 0,
      geo: comp(at(rb(S(0.08), S(0.06), S(0.16), S(0.012))), at(hose([[0, S(0.03), 0], [-S(0.1), S(0.12), 0], [-S(0.3), S(0.1), 0]], S(0.008)))),
      description: "Venturi ejector producing vacuum from 6 bar compressed air, with blow-off valve." }),
  );
  return parts;
}
