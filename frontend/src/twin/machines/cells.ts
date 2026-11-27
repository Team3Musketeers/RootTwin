// Robotic cells: dual-robot welding cell and heavy palletizing robot.
import { fmt, partFactory, robotArm } from "../build";
import { BELT_Y, ST } from "../layout";
import type { Control, MachineDef } from "../types";

const joints = (prefix: string, who: string): Control[] =>
  [1, 2, 3, 4, 5, 6].map((n) => ({ key: `${prefix}J${n}`, label: `${who} J${n}`, unit: "°", min: -180, max: 180, step: 0.5 }));

// ------------------------------------------------------------------ 6. dual-robot welding / fastening cell
const w = partFactory("WLD");
export const WELD_BASE = { A: [0, 0, -1.9] as [number, number, number], B: [0, 0, 1.9] as [number, number, number] };
export const welding: MachineDef = {
  id: "WLD", type: "welding", name: "Dual-robot welding cell", zone: "assembly", backendId: "M4", position: [ST.welding, 0, 0], size: [5.6, 3.2, 6],
  description: "Two synchronised 6-axis robots weld the seams of the part held in a pneumatic fixture; fumes are extracted by the hood.",
  controls: [...joints("A_", "Robot A"), ...joints("B_", "Robot B"),
    { key: "toolSpeed", label: "Tool speed", unit: "%", min: 0, max: 100, step: 1 },
    { key: "power", label: "Welding power", unit: "%", min: 0, max: 100, step: 1 }],
  defaults: { toolSpeed: 70, power: 80, A_J1: -90, A_J2: 10, A_J3: 30, A_J4: 0, A_J5: 50, A_J6: 0, B_J1: 90, B_J2: 10, B_J3: 30, B_J4: 0, B_J5: 50, B_J6: 0 },
  faults: [
    { code: "WLD-B-J3", partId: "WLD.B.j3", label: "Welding robot B – J3 servo fault", severity: "critical", backendCodes: ["MOTOR_OVERCURRENT", "PHASE_IMBALANCE"] },
    { code: "WLD-A-J2", partId: "WLD.A.j2m", label: "Welding robot A – J2 motor overload", severity: "critical", backendCodes: ["BEARING_WEAR", "MISALIGNMENT"] },
    { code: "WLD-TIP", partId: "WLD.A.tool", label: "Robot A torch contact tip worn", severity: "warning", backendCodes: ["TOOL_WEAR"] },
    { code: "WLD-PSU", partId: "WLD.psuA", label: "Welding power source overheat", severity: "warning", backendCodes: ["OVERHEATING", "COOLING_FAILURE"] },
    { code: "WLD-CLAMP", partId: "WLD.clampL", label: "Fixture clamp sensor fault", severity: "warning", backendCodes: ["SENSOR_DRIFT", "SENSOR_STUCK", "CONVEYOR_JAM", "BELT_SLIP"] },
  ],
  subAssemblies: [
    { id: "WLD.fixture", name: "Fixture & infrastructure", parts: [
      w({ id: "WLD.table", name: "Welding fixture table", category: "structural", geo: { kind: "box", args: [2.4, 0.84, 1.2] }, pos: [0, 0.42, 0], color: "#334155", explodeVector: [0, -0.5, 0], explodeOrder: 4 }),
      w({ id: "WLD.clampL", name: "Pneumatic clamp (left)", category: "actuator", geo: { kind: "box", args: [0.16, 0.3, 0.5] }, pos: [-0.55, BELT_Y + 0.2, 0], color: "#ef4444", explodeVector: [-0.4, 0.5, 0], explodeOrder: 1,
        motion: (rt) => ({ pos: [-0.55 + 0.18 * (rt.phase.clamp ?? 0), BELT_Y + 0.2, 0] }), telemetry: (rt) => ({ state: (rt.phase.clamp ?? 0) > 0.9 ? "clamped" : "open", "reed switch": "OK" }) }),
      w({ id: "WLD.clampR", name: "Pneumatic clamp (right)", category: "actuator", geo: { kind: "box", args: [0.16, 0.3, 0.5] }, pos: [0.55, BELT_Y + 0.2, 0], color: "#ef4444", explodeVector: [0.4, 0.5, 0], explodeOrder: 1,
        motion: (rt) => ({ pos: [0.55 - 0.18 * (rt.phase.clamp ?? 0), BELT_Y + 0.2, 0] }) }),
      w({ id: "WLD.hood", name: "Fume extraction hood", category: "structural", geo: { kind: "box", args: [2.6, 0.3, 2.0] }, pos: [0, 3.7, 0], color: "#94a3b8", explodeVector: [0, 1.2, 0], explodeOrder: 0 }),
      w({ id: "WLD.psuA", name: "Welding power source A", category: "electrical", geo: { kind: "box", args: [0.6, 0.9, 0.7] }, pos: [-2.2, 0.45, -2.4], color: "#1d4ed8", explodeVector: [-0.6, 0, -0.6], explodeOrder: 0,
        description: "Inverter MIG/MAG source, 400 A @ 60 % duty.", telemetry: (rt) => ({ output: fmt((rt.act.power ?? 0) * 2.8, "A", 0), "heatsink temp": fmt(45 + (rt.act.power ?? 0) * 0.2 + (rt.phase.heat ?? 0) * 40, "°C") }) }),
      w({ id: "WLD.psuB", name: "Welding power source B", category: "electrical", geo: { kind: "box", args: [0.6, 0.9, 0.7] }, pos: [-2.2, 0.45, 2.4], color: "#1d4ed8", explodeVector: [-0.6, 0, 0.6], explodeOrder: 0 }),
      w({ id: "WLD.ctrl", name: "Cell controller cabinet", category: "electrical", geo: { kind: "box", args: [0.8, 1.9, 0.6] }, pos: [2.4, 0.95, -2.5], color: "#475569", explodeVector: [0.6, 0, -0.6], explodeOrder: 0,
        telemetry: () => ({ "safety PLC": "RUN", "robot sync": "OK" }) }),
    ] },
    { id: "WLD.A", name: "Robot A", parts: robotArm(w, { id: "WLD.A", k: "A_", pos: WELD_BASE.A, color: "#f97316", tool: "torch" }) },
    { id: "WLD.B", name: "Robot B", parts: robotArm(w, { id: "WLD.B", k: "B_", pos: WELD_BASE.B, color: "#f97316", tool: "torch" }) },
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
  description: "A heavy 6-axis robot picks each finished part at the end of the line with a vacuum gripper and stacks it on the pallet, 3 × 3 per layer.",
  controls: [...joints("", "Palletizer"),
    { key: "grip", label: "Gripper vacuum", unit: "%", min: 0, max: 100, step: 1 },
    { key: "toolSpeed", label: "Tool speed", unit: "%", min: 0, max: 100, step: 1 }],
  defaults: { grip: 0, toolSpeed: 80, J1: 90, J2: 0, J3: 20, J4: 0, J5: 70, J6: 0 },
  faults: [
    { code: "PAL-VAC", partId: "PAL.R.tool", label: "Vacuum loss at gripper", severity: "critical", backendCodes: ["CONVEYOR_JAM", "BELT_SLIP"] },
    { code: "PAL-J2", partId: "PAL.R.j2m", label: "Palletizer J2 servo overtemperature", severity: "critical", backendCodes: ["OVERHEATING", "MOTOR_OVERCURRENT"] },
    { code: "PAL-J1", partId: "PAL.R.base", label: "J1 reducer wear", severity: "warning", backendCodes: ["BEARING_WEAR", "MISALIGNMENT"] },
    { code: "PAL-SCAN", partId: "PAL.scanner", label: "Safety laser scanner fault", severity: "critical", backendCodes: ["SENSOR_STUCK", "SENSOR_DRIFT"] },
  ],
  subAssemblies: [
    { id: "PAL.station", name: "Outfeed & pallet station", parts: [
      p({ id: "PAL.stop", name: "Outfeed end stop", category: "mechanical", geo: { kind: "box", args: [0.6, 0.84, 1.1] }, pos: [PAL_PICK[0], 0.42, 0], color: "#334155", explodeVector: [0, -0.4, 0], explodeOrder: 2 }),
      p({ id: "PAL.place", name: "Pallet locating plate", category: "structural", geo: { kind: "box", args: [1.6, 0.05, 1.6] }, pos: [PAL_PALLET[0], 0.025, PAL_PALLET[2]], color: "#16a34a", metalness: 0.2, explodeVector: [0, -0.3, 0], explodeOrder: 3 }),
      p({ id: "PAL.scanner", name: "Safety laser scanner", category: "sensor", geo: { kind: "cyl", args: [0.1, 0.12, 0.18] }, pos: [0.8, 0.3, 0.2], color: "#facc15", explodeVector: [0.4, 0.5, 0.4], explodeOrder: 0,
        description: "Protective-field scanner: the robot slows when a person enters the warning field and stops in the protective field.",
        telemetry: () => ({ field: "clear", "protective field": "2.1 m" }) }),
      p({ id: "PAL.vac", name: "Vacuum pump", category: "electrical", geo: { kind: "box", args: [0.5, 0.45, 0.4] }, pos: [-2.0, 0.23, -2.4], color: "#0f766e", explodeVector: [-0.5, 0, -0.5], explodeOrder: 0,
        telemetry: (rt) => ({ vacuum: fmt(-0.75 * (rt.act.grip ?? 0) / 100, "bar", 2) }) }),
      p({ id: "PAL.ctrl", name: "Robot controller", category: "electrical", geo: { kind: "box", args: [0.7, 1.6, 0.6] }, pos: [-2.0, 0.8, -1.6], color: "#475569", explodeVector: [-0.6, 0, 0], explodeOrder: 0 }),
    ] },
    { id: "PAL.R", name: "Palletizing robot", parts: robotArm(p, { id: "PAL.R", k: "", pos: PAL_BASE, color: "#eab308", tool: "gripper", scale: PAL_SCALE }) },
  ],
};
