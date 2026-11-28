// Robotic cells: dual-robot welding cell and heavy palletizing robot (CAD-level parts).
import { at, comp, cy, fmt, hose, lathe, motorS, partFactory, pneuCyl, rb, robotArm, X, Z } from "../build";
import { BELT_Y, ST } from "../layout";
import type { Control, MachineDef } from "../types";

const joints = (prefix: string, who: string): Control[] =>
  [1, 2, 3, 4, 5, 6].map((n) => ({ key: `${prefix}J${n}`, label: `${who} J${n}`, unit: "°", min: -180, max: 180, step: 0.5 }));

/** Industrial cabinet with louvres, door handle and a nameplate. */
const cabinet = (w: number, h: number, d: number) => comp(
  at(rb(w, h, d, 0.02)),
  ...Array.from({ length: 6 }, (_, i) => at(rb(w * 0.5, 0.012, 0.02, 0.005), [0, h * 0.3 - i * 0.04, d / 2 + 0.005])),
  at(rb(0.03, 0.18, 0.04, 0.01), [w * 0.38, 0, d / 2 + 0.02]),
);

// ------------------------------------------------------------------ 6. dual-robot welding cell
const w = partFactory("WLD");
export const WELD_BASE = { A: [0, 0, -1.9] as [number, number, number], B: [0, 0, 1.9] as [number, number, number] };
export const welding: MachineDef = {
  id: "WLD", type: "welding", name: "Dual-robot welding cell", zone: "assembly", backendId: "M4", position: [ST.welding, 0, 0], size: [5.6, 3.2, 6],
  description: "Two synchronised 6-axis robots MIG-weld the seams of the part held in a pneumatic fixture; fumes are extracted by the hood.",
  controls: [...joints("A_", "Robot A"), ...joints("B_", "Robot B"),
    { key: "toolSpeed", label: "Tool speed", unit: "%", min: 0, max: 100, step: 1 },
    { key: "power", label: "Welding power", unit: "%", min: 0, max: 100, step: 1 }],
  defaults: { toolSpeed: 70, power: 80, A_J1: -90, A_J2: 10, A_J3: 30, A_J4: 0, A_J5: 50, A_J6: 0, B_J1: 90, B_J2: 10, B_J3: 30, B_J4: 0, B_J5: 50, B_J6: 0 },
  faults: [
    { code: "WLD-B-J3", partId: "WLD.B.j3m", label: "Welding robot B – J3 servo fault", severity: "critical", backendCodes: ["MOTOR_OVERCURRENT", "PHASE_IMBALANCE"] },
    { code: "WLD-A-J2", partId: "WLD.A.j2r", label: "Welding robot A – J2 reducer wear", severity: "critical", backendCodes: ["BEARING_WEAR", "MISALIGNMENT"] },
    { code: "WLD-TIP", partId: "WLD.A.nozzle", label: "Robot A torch contact tip worn", severity: "warning", backendCodes: ["TOOL_WEAR"] },
    { code: "WLD-PSU", partId: "WLD.psuA", label: "Welding power source overheat", severity: "warning", backendCodes: ["OVERHEATING", "COOLING_FAILURE"] },
    { code: "WLD-CLAMP", partId: "WLD.clampL", label: "Fixture clamp sensor fault", severity: "warning", backendCodes: ["SENSOR_DRIFT", "SENSOR_STUCK", "CONVEYOR_JAM", "BELT_SLIP"] },
  ],
  subAssemblies: [
    { id: "WLD.fixture", name: "Welding fixture", parts: [
      w({ id: "WLD.table", name: "Welding table (slotted cast top)", category: "structural", mat: "castIron", pos: [0, 0, 0], explodeVector: [0, -0.5, 0], explodeOrder: 4,
        geo: comp(at(rb(2.4, 0.12, 1.2, 0.02), [0, BELT_Y - 0.12, 0]), ...[-1.05, 1.05].flatMap((x) => [-0.5, 0.5].map((z) => at(rb(0.12, BELT_Y - 0.18, 0.12, 0.02), [x, (BELT_Y - 0.18) / 2, z]))),
          ...Array.from({ length: 5 }, (_, i) => at(rb(2.3, 0.02, 0.025, 0.005), [0, BELT_Y - 0.055, -0.4 + i * 0.2]))),
        material: "Nitrided cast iron, 28 mm system holes", tolerance: "flatness 0.1 mm / m", description: "Modular welding table with a slotted nitrided top." }),
      w({ id: "WLD.clampL", name: "Pneumatic toggle clamp (left)", category: "actuator", mat: "paintRed", pos: [-0.55, BELT_Y + 0.2, 0], explodeVector: [-0.45, 0.5, 0], explodeOrder: 1,
        geo: comp(at(rb(0.12, 0.3, 0.4, 0.02)), at(pneuCyl(0.035, 0.28), [-0.1, 0.05, 0])),
        motion: (rt) => ({ pos: [-0.55 + 0.18 * (rt.phase.clamp ?? 0), BELT_Y + 0.2, 0] }), telemetry: (rt) => ({ state: (rt.phase.clamp ?? 0) > 0.9 ? "clamped" : "open", "reed switch": (rt.phase.drift ?? 0) ? "no signal" : "OK" }) }),
      ...(["L", "R"] as const).map((side) => w({ id: `WLD.spring${side}`, name: `Clamp return spring (${side === "L" ? "left" : "right"})`, category: "mechanical", mat: "graphite", parent: `WLD.clamp${side}`,
        pos: [0, 0.2, 0.12], rot: [0, 0, Math.PI / 2], explodeVector: [0, 0.35, 0.2], explodeOrder: 0, material: "Spring steel EN 10270-1",
        geo: { kind: "helix", r: 0.022, pitch: 0.018, turns: 8, wire: 0.004 }, description: "Opens the toggle clamp when air is released (fail-safe open)." })),
      w({ id: "WLD.clampR", name: "Pneumatic toggle clamp (right)", category: "actuator", mat: "paintRed", pos: [0.55, BELT_Y + 0.2, 0], explodeVector: [0.45, 0.5, 0], explodeOrder: 1,
        geo: comp(at(rb(0.12, 0.3, 0.4, 0.02)), at(pneuCyl(0.035, 0.28), [0.1, 0.05, 0])),
        motion: (rt) => ({ pos: [0.55 - 0.18 * (rt.phase.clamp ?? 0), BELT_Y + 0.2, 0] }) }),
    ] },
    { id: "WLD.infra", name: "Power, fumes & control", parts: [
      w({ id: "WLD.hood", name: "Fume extraction hood & duct", category: "structural", mat: "brushedAlu", pos: [0, 3.6, 0], explodeVector: [0, 1.2, 0], explodeOrder: 0, housing: true,
        geo: comp(at(lathe([[1.1, 0], [1.25, 0], [0.3, 0.45], [0.25, 0.45]])), at(hose([[0, 0.45, 0], [0, 1.2, 0], [0, 1.6, -1.2], [0, 1.6, -3]], 0.22))),
        description: "Hood connected to the central fume filter (W3 class)." }),
      w({ id: "WLD.psuA", name: "Welding power source A", category: "electrical", mat: "paintBlue", pos: [-2.2, 0.5, -2.4], explodeVector: [-0.7, 0, -0.6], explodeOrder: 0,
        geo: comp(at(cabinet(0.62, 0.95, 0.75)), at(lathe([[0, 0], [0.18, 0], [0.18, 0.12], [0, 0.12]]), [0, 0.6, 0], X)),
        description: "Inverter MIG/MAG source, 400 A @ 60 % duty, with wire-feeder spool on top.", maintenanceNotes: "Blow out the heatsinks monthly; overheat = clogged filter or fan failure.",
        telemetry: (rt) => ({ output: fmt((rt.act.power ?? 0) * 2.8, "A", 0), "heatsink temp": fmt(45 + (rt.act.power ?? 0) * 0.2 + (rt.phase.heat ?? 0) * 40, "°C") }) }),
      w({ id: "WLD.psuB", name: "Welding power source B", category: "electrical", mat: "paintBlue", pos: [-2.2, 0.5, 2.4], explodeVector: [-0.7, 0, 0.6], explodeOrder: 0,
        geo: comp(at(cabinet(0.62, 0.95, 0.75)), at(lathe([[0, 0], [0.18, 0], [0.18, 0.12], [0, 0.12]]), [0, 0.6, 0], X)) }),
      w({ id: "WLD.ctrl", name: "Cell controller & safety PLC", category: "electrical", mat: "cabinet", pos: [2.4, 1.0, -2.5], explodeVector: [0.6, 0, -0.6], explodeOrder: 0,
        geo: comp(at(cabinet(0.8, 2.0, 0.6)), at(rb(0.3, 0.2, 0.02, 0.01), [-0.15, 0.6, 0.31])), telemetry: () => ({ "safety PLC": "RUN", "robot sync": "OK", "cycle program": "SEAM_A2B" }) }),
      w({ id: "WLD.cables", name: "Weld cables & hose package", category: "electrical", mat: "rubber", pos: [0, 0, 0], explodeVector: [-0.4, 0.4, 0], explodeOrder: 0,
        geo: comp(at(hose([[-2.2, 0.98, -2.4], [-1.6, 0.15, -2.2], [-0.5, 0.05, -2.0], [-0.35, 0.2, -1.9]], 0.03)), at(hose([[-2.2, 0.98, 2.4], [-1.6, 0.15, 2.2], [-0.5, 0.05, 2.0], [-0.35, 0.2, 1.9]], 0.03))) }),
    ] },
    { id: "WLD.A", name: "Robot A", parts: robotArm(w, { id: "WLD.A", k: "A_", pos: WELD_BASE.A, paint: "robotOrange", tool: "torch" }) },
    { id: "WLD.B", name: "Robot B", parts: robotArm(w, { id: "WLD.B", k: "B_", pos: WELD_BASE.B, paint: "robotOrange", tool: "torch" }) },
  ],
};

// ------------------------------------------------------------------ 7. palletizing robot & outfeed
const p = partFactory("PAL");
export const PAL_SCALE = 1.25;
export const PAL_BASE: [number, number, number] = [-0.6, 0, -1.4];
export const PAL_PICK: [number, number, number] = [ST.lineEnd - ST.palletizer, BELT_Y + 0.5, 0];          // machine-local
export const PAL_PALLET: [number, number, number] = [1.2, 0.15, -2.6];
export const palletizer: MachineDef = {
  id: "PAL", type: "palletizer", name: "Palletizing robot & outfeed", zone: "packaging", backendId: "M5", position: [ST.palletizer, 0, 0], size: [5, 3.6, 5],
  description: "A heavy 6-axis robot picks each finished part at the end of the line with a vacuum gripper and stacks it on a Euro pallet, 3 × 3 per layer.",
  controls: [...joints("", "Palletizer"),
    { key: "grip", label: "Gripper vacuum", unit: "%", min: 0, max: 100, step: 1 },
    { key: "toolSpeed", label: "Tool speed", unit: "%", min: 0, max: 100, step: 1 }],
  defaults: { grip: 0, toolSpeed: 80, J1: 90, J2: 0, J3: 20, J4: 0, J5: 70, J6: 0 },
  faults: [
    { code: "PAL-VAC", partId: "PAL.R.tool", label: "Vacuum loss at gripper", severity: "critical", backendCodes: ["CONVEYOR_JAM", "BELT_SLIP"] },
    { code: "PAL-J2", partId: "PAL.R.j2m", label: "Palletizer J2 servo overtemperature", severity: "critical", backendCodes: ["OVERHEATING", "MOTOR_OVERCURRENT"] },
    { code: "PAL-J1", partId: "PAL.R.base", label: "J1 bearing / reducer wear", severity: "warning", backendCodes: ["BEARING_WEAR", "MISALIGNMENT"] },
    { code: "PAL-SCAN", partId: "PAL.scanner", label: "Safety laser scanner fault", severity: "critical", backendCodes: ["SENSOR_STUCK", "SENSOR_DRIFT"] },
  ],
  subAssemblies: [
    { id: "PAL.station", name: "Outfeed & pallet station", parts: [
      p({ id: "PAL.stop", name: "Outfeed end stop with buffer", category: "mechanical", mat: "safetyYellow", pos: [PAL_PICK[0] + 0.3, BELT_Y + 0.15, 0], explodeVector: [0.4, 0.3, 0], explodeOrder: 1,
        geo: comp(at(rb(0.08, 0.3, 0.9, 0.02)), at(pneuCyl(0.03, 0.12), [-0.06, 0, 0], [0, 0, Math.PI / 2])), description: "Hard stop with hydraulic shock absorber; photo-eye detects the part." }),
      p({ id: "PAL.place", name: "Pallet locating station", category: "structural", mat: "safetyYellow", pos: [PAL_PALLET[0], 0.02, PAL_PALLET[2]], explodeVector: [0, -0.3, 0], explodeOrder: 3,
        geo: comp(...[[-0.85, 0], [0.85, 0], [0, -0.85], [0, 0.85]].map(([x, z]) => at(rb(x ? 0.06 : 1.7, 0.08, z ? 0.06 : 1.7, 0.01), [x, 0.04, z]))) }),
      p({ id: "PAL.scanner", name: "Safety laser scanner", category: "sensor", mat: "safetyYellow", pos: [0.8, 0.2, 0.2], explodeVector: [0.4, 0.5, 0.4], explodeOrder: 0,
        geo: comp(at(rb(0.16, 0.16, 0.16, 0.03)), at(cy(0.07, 0.08), [0, 0.11, 0]), at(cy(0.071, 0.05), [0, 0.1, 0])),
        description: "Protective-field scanner: the robot slows when a person enters the warning field and stops in the protective field.",
        telemetry: (rt) => ({ field: (rt.phase.drift ?? 0) ? "contaminated window" : "clear", "protective field": "2.1 m" }) }),
      p({ id: "PAL.scanWin", name: "Scanner optical window", category: "sensor", mat: "smokedGlass", parent: "PAL.scanner", pos: [0, 0.1, 0], explodeVector: [0, 0.3, 0], explodeOrder: 0, geo: cy(0.072, 0.045) }),
      p({ id: "PAL.vac", name: "Vacuum pump & tank", category: "electrical", mat: "paintGreen", pos: [-2.0, 0, -2.4], explodeVector: [-0.5, 0, -0.5], explodeOrder: 0,
        geo: comp(at(rb(0.6, 0.35, 0.4, 0.04), [0, 0.18, 0]), at(motorS(0.11, 0.3), [0, 0.5, 0], X), at(hose([[0, 0.4, 0.2], [0.6, 0.8, 0.6], [1.4, 2.6, 1.0]], 0.02))),
        telemetry: (rt) => ({ vacuum: fmt(-0.75 * (rt.act.grip ?? 0) / 100, "bar", 2), motor: "1.1 kW" }) }),
      p({ id: "PAL.ctrl", name: "Robot controller cabinet", category: "electrical", mat: "cabinet", pos: [-2.0, 0.85, -1.4], explodeVector: [-0.6, 0, 0], explodeOrder: 0, geo: cabinet(0.7, 1.7, 0.6) }),
      p({ id: "PAL.pendant", name: "Teach pendant", category: "electrical", mat: "plasticBlack", parent: "PAL.ctrl", pos: [0.36, 0.2, 0.1], rot: [0, Math.PI / 2, 0], explodeVector: [0.4, 0, 0], explodeOrder: 0,
        geo: comp(at(rb(0.25, 0.32, 0.05, 0.03)), at(rb(0.18, 0.13, 0.01, 0.005), [0, 0.05, 0.03]), at(cy(0.02, 0.02), [0.08, -0.1, 0.035], Z)) }),
    ] },
    { id: "PAL.R", name: "Palletizing robot", parts: robotArm(p, { id: "PAL.R", k: "", pos: PAL_BASE, paint: "robotYellow", tool: "gripper", scale: PAL_SCALE }) },
  ],
};
