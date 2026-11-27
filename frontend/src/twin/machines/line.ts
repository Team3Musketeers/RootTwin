// Main-line machines: pallet dispenser, infeed vision portal, CNC machining centre, gearbox + hydraulic press, conveyors.
import { fmt, partFactory } from "../build";
import { BELT_Y, LINE_X0, ST } from "../layout";
import type { Control, MachineDef, MachineRuntime } from "../types";

const CONVEYOR_CONTROLS: Control[] = [
  { key: "speed", label: "Target speed", unit: "m/s", min: 0, max: 1.2, step: 0.01 },
  { key: "current", label: "Motor current", unit: "A", min: 0, max: 20, step: 0.1 },
  { key: "load", label: "Load weight", unit: "kg", min: 0, max: 500, step: 1 },
  { key: "voltage", label: "Bus voltage", unit: "V", min: 0, max: 600, step: 1 },
];
const PROCESS_CONTROLS: Control[] = [
  { key: "rpm", label: "Spindle / motor speed", unit: "rpm", min: 0, max: 12000, step: 10 },
  { key: "force", label: "Torque / press force", unit: "kN", min: 0, max: 400, step: 1 },
  { key: "pressure", label: "Coolant / hydraulic pressure", unit: "bar", min: 0, max: 250, step: 1 },
  { key: "temp", label: "Operating temperature", unit: "°C", min: 10, max: 120, step: 0.5 },
];
const motorTele = (rt: MachineRuntime) => ({ current: fmt(rt.act.current ?? rt.act.rpm / 600, "A", 2), "winding temp": fmt(rt.act.temp ?? 40, "°C") });

// ------------------------------------------------------------------ 1. raw material pallet dispenser / loader
const d = partFactory("DSP");
export const dispenser: MachineDef = {
  id: "DSP", type: "dispenser", name: "Raw material pallet dispenser", zone: "logistics", position: [ST.dispenser, 0, 0], size: [2.6, 3.4, 2],
  description: "Destacks raw-material carriers delivered by the AGVs and pushes one workpiece at a time onto the infeed conveyor.",
  controls: CONVEYOR_CONTROLS, defaults: { speed: 0.6, current: 4.2, load: 180, voltage: 400 },
  faults: [
    { code: "DSP-PUSH-LEAK", partId: "DSP.cyl", label: "Pusher cylinder air leak", severity: "critical" },
    { code: "DSP-PE-FAULT", partId: "DSP.pe", label: "Photo-eye dirty / misaligned", severity: "warning", backendCodes: ["SENSOR_DRIFT", "SENSOR_STUCK"] },
    { code: "DSP-MOTOR-OC", partId: "DSP.motor", label: "Lift motor overcurrent", severity: "critical", backendCodes: ["MOTOR_OVERCURRENT"] },
  ],
  subAssemblies: [
    { id: "DSP.frame", name: "Frame & guards", parts: [
      d({ id: "DSP.base", name: "Base plate", category: "structural", geo: { kind: "box", args: [2.6, 0.1, 2] }, pos: [0, 0.05, 0], color: "#475569", explodeVector: [0, -0.4, 0], explodeOrder: 6 }),
      d({ id: "DSP.sideL", name: "Side frame (left)", category: "structural", geo: { kind: "box", args: [0.12, 3.2, 1.8] }, pos: [-1.2, 1.7, 0], color: "#facc15", explodeVector: [-1.2, 0, 0], explodeOrder: 0, assemblyAxis: "X" }),
      d({ id: "DSP.sideR", name: "Side frame (right)", category: "structural", geo: { kind: "box", args: [0.12, 3.2, 0.5] }, pos: [1.2, 1.7, -0.65], color: "#facc15", explodeVector: [1.2, 0, 0], explodeOrder: 0, assemblyAxis: "X" }),
      d({ id: "DSP.guard", name: "Polycarbonate guard", category: "structural", geo: { kind: "box", args: [2.3, 2.4, 0.04] }, pos: [0, 2.0, 0.92], color: "#bae6fd", opacity: 0.25, metalness: 0, roughness: 0.1, explodeVector: [0, 0, 1.4], explodeOrder: 0, assemblyAxis: "Z", material: "Polycarbonate 6 mm" }),
    ] },
    { id: "DSP.lift", name: "Destacking lift", parts: [
      d({ id: "DSP.mag", name: "Carrier magazine", category: "mechanical", geo: { kind: "box", args: [1.4, 1.1, 1.3] }, pos: [0, 2.45, 0], color: "#8b5a2b", metalness: 0, roughness: 0.9, explodeVector: [0, 1.4, 0], explodeOrder: 1, material: "Wooden carriers",
        description: "Stack of raw-material carriers dropped by the AGVs." }),
      d({ id: "DSP.plate", name: "Lift plate", category: "actuator", geo: { kind: "box", args: [1.3, 0.08, 1.2] }, pos: [0, BELT_Y - 0.04, 0], color: "#94a3b8", explodeVector: [0, 0.5, 0], explodeOrder: 3,
        motion: (rt) => ({ pos: [0, BELT_Y - 0.04 + 0.6 * Math.sin((rt.phase.push ?? 0) * Math.PI), 0] }) }),
      d({ id: "DSP.motor", name: "Lift drive motor", category: "electrical", geo: { kind: "cyl", args: [0.16, 0.16, 0.4] }, pos: [-0.9, 0.35, -0.6], rot: [0, 0, Math.PI / 2], color: "#1e3a8a", explodeVector: [-0.6, 0, -0.6], explodeOrder: 2, assemblyAxis: "X",
        description: "0.75 kW geared motor driving the lift chain.", telemetry: motorTele }),
    ] },
    { id: "DSP.push", name: "Pusher & sensing", parts: [
      d({ id: "DSP.cyl", name: "Pneumatic pusher cylinder", category: "actuator", geo: { kind: "cyl", args: [0.08, 0.08, 0.9] }, pos: [-0.7, BELT_Y + 0.3, 0], rot: [0, 0, Math.PI / 2], color: "#cbd5e1", explodeVector: [-0.9, 0.3, 0], explodeOrder: 2, assemblyAxis: "X",
        description: "ISO 15552 cylinder, Ø50 × 400 mm stroke, 6 bar.", maintenanceNotes: "Check for air leaks with leak spray monthly; replace seals every 2 million cycles.",
        telemetry: (rt) => ({ "supply pressure": fmt(6 - (rt.phase.leak ?? 0), "bar"), position: fmt((rt.phase.push ?? 0) * 400, "mm", 0) }) }),
      d({ id: "DSP.rod", name: "Pusher rod & plate", category: "actuator", parent: "DSP.cyl", geo: { kind: "box", args: [0.06, 0.4, 0.5] }, pos: [0, -0.5, 0], rot: [0, 0, -Math.PI / 2], color: "#e5e7eb", explodeVector: [0, -0.5, 0], explodeOrder: 1,
        motion: (rt) => ({ pos: [0, -0.5 - 0.9 * Math.max(0, Math.sin((rt.phase.push ?? 0) * Math.PI)), 0] }) }),
      d({ id: "DSP.pe", name: "Photo-eye (presence)", category: "sensor", geo: { kind: "box", args: [0.08, 0.08, 0.12] }, pos: [1.05, BELT_Y + 0.25, -0.5], color: "#0ea5e9", explodeVector: [0.4, 0.4, -0.4], explodeOrder: 0,
        description: "Diffuse photo-electric sensor detecting a workpiece at the outlet.", telemetry: (rt) => ({ signal: (rt.phase.leak ?? 0) > 0 ? "unstable" : "OK", "switching freq": "500 Hz" }) }),
      d({ id: "DSP.bed", name: "Outlet roller bed", category: "mechanical", geo: { kind: "box", args: [2.2, 0.08, 1.0] }, pos: [0, BELT_Y - 0.06, 0], color: "#334155", explodeVector: [0, -0.3, 0], explodeOrder: 4 }),
    ] },
  ],
};

// ------------------------------------------------------------------ 3. infeed vision & laser inspection portal
const v = partFactory("VIS");
export const vision: MachineDef = {
  id: "VIS", type: "vision", name: "Infeed vision & laser inspection portal", zone: "machining", backendId: "M1", position: [ST.vision, 0, 0], size: [2.4, 2.8, 3.2],
  description: "Measures every workpiece (3D laser profile + colour camera) and diverts out-of-tolerance parts to the reject bin.",
  controls: CONVEYOR_CONTROLS, defaults: { speed: 0.6, current: 2.1, load: 60, voltage: 24 },
  faults: [
    { code: "VIS-LENS", partId: "VIS.cam", label: "Camera lens fouled", severity: "warning", backendCodes: ["SENSOR_DRIFT"] },
    { code: "VIS-LASER", partId: "VIS.laser", label: "Laser line scanner failure", severity: "critical", backendCodes: ["SENSOR_STUCK"] },
    { code: "VIS-DIVERT", partId: "VIS.flap", label: "Reject diverter stuck", severity: "critical", backendCodes: ["CONVEYOR_JAM", "BELT_SLIP"] },
    { code: "VIS-CURTAIN", partId: "VIS.lcE", label: "Light curtain misaligned", severity: "critical" },
  ],
  subAssemblies: [
    { id: "VIS.portal", name: "Portal frame", parts: [
      v({ id: "VIS.bed", name: "Transfer bed", category: "mechanical", geo: { kind: "box", args: [2.2, 0.1, 1.0] }, pos: [0, BELT_Y - 0.06, 0], color: "#334155", explodeVector: [0, -0.4, 0], explodeOrder: 4 }),
      v({ id: "VIS.postL", name: "Portal post (rear)", category: "structural", geo: { kind: "box", args: [0.16, 2.6, 0.16] }, pos: [0, 1.3, -0.9], color: "#0f766e", explodeVector: [0, 0, -1], explodeOrder: 1, assemblyAxis: "Z" }),
      v({ id: "VIS.postR", name: "Portal post (front)", category: "structural", geo: { kind: "box", args: [0.16, 2.6, 0.16] }, pos: [0, 1.3, 0.9], color: "#0f766e", explodeVector: [0, 0, 1], explodeOrder: 1, assemblyAxis: "Z" }),
      v({ id: "VIS.beam", name: "Top beam & cable tray", category: "structural", geo: { kind: "box", args: [0.32, 0.26, 2.0] }, pos: [0, 2.65, 0], color: "#14b8a6", explodeVector: [0, 1.0, 0], explodeOrder: 0 }),
    ] },
    { id: "VIS.optics", name: "Optics & sensing", parts: [
      v({ id: "VIS.cam", name: "Colour area-scan camera", category: "sensor", geo: { kind: "box", args: [0.22, 0.24, 0.3] }, pos: [0, 2.35, 0.3], color: "#111827", explodeVector: [0, 0.4, 0.6], explodeOrder: 0,
        description: "5 MP GigE camera, telecentric lens, inspects surface defects and labels.", maintenanceNotes: "Clean lens with optical wipe weekly; recalibrate with the reference target after any knock.",
        telemetry: () => ({ exposure: "180 µs", fps: "60", "focus score": "0.94" }) }),
      v({ id: "VIS.laser", name: "Laser line profile scanner", category: "sensor", geo: { kind: "box", args: [0.2, 0.18, 0.34] }, pos: [0, 2.35, -0.3], color: "#dc2626", explodeVector: [0, 0.4, -0.6], explodeOrder: 0,
        description: "Class 2M laser triangulation sensor, 2 kHz profiles, ±0.02 mm.", telemetry: () => ({ "profile rate": "2 kHz", "laser power": "8 mW" }) }),
      v({ id: "VIS.ring", name: "LED ring light", category: "electrical", geo: { kind: "torus", args: [0.32, 0.03] }, pos: [0, 2.05, 0], rot: [Math.PI / 2, 0, 0], color: "#f8fafc", metalness: 0, roughness: 0.2, explodeVector: [0, -0.5, 0], explodeOrder: 1 }),
      v({ id: "VIS.lcE", name: "Light curtain emitter", category: "sensor", geo: { kind: "box", args: [0.05, 1.2, 0.05] }, pos: [-0.8, BELT_Y + 0.6, -0.75], color: "#f59e0b", explodeVector: [-0.6, 0, -0.6], explodeOrder: 1 }),
      v({ id: "VIS.lcR", name: "Light curtain receiver", category: "sensor", geo: { kind: "box", args: [0.05, 1.2, 0.05] }, pos: [-0.8, BELT_Y + 0.6, 0.75], color: "#f59e0b", explodeVector: [-0.6, 0, 0.6], explodeOrder: 1 }),
      v({ id: "VIS.pc", name: "Edge vision computer", category: "electrical", geo: { kind: "box", args: [0.35, 0.5, 0.25] }, pos: [0.5, 2.5, -0.95], color: "#1f2937", explodeVector: [0.5, 0.5, -0.5], explodeOrder: 0,
        telemetry: () => ({ "CPU load": "41 %", inference: "7.8 ms" }) }),
    ] },
    { id: "VIS.reject", name: "Reject diverter", parts: [
      v({ id: "VIS.flap", name: "Diverter flap", category: "actuator", geo: { kind: "box", args: [0.05, 0.3, 1.0] }, pos: [0.85, BELT_Y + 0.15, 0], meshPos: [0, 0, 0.5], color: "#ef4444", explodeVector: [0.6, 0.4, 0], explodeOrder: 1,
        motion: (rt) => ({ rot: [0, -(rt.phase.divert ?? 0) * 0.9, 0] }), description: "Pivoting flap pushing rejected parts into the bin." }),
      v({ id: "VIS.act", name: "Diverter rotary actuator", category: "actuator", geo: { kind: "cyl", args: [0.07, 0.07, 0.25] }, pos: [0.85, BELT_Y + 0.4, -0.55], color: "#64748b", explodeVector: [0.4, 0.5, -0.3], explodeOrder: 0 }),
      v({ id: "VIS.bin", name: "Reject bin", category: "structural", geo: { kind: "box", args: [0.9, 0.6, 0.8] }, pos: [0.9, 0.3, 1.55], color: "#b91c1c", explodeVector: [0, 0, 0.8], explodeOrder: 2 }),
    ] },
  ],
};

// ------------------------------------------------------------------ 4. CNC machining centre
const c = partFactory("CNC");
export const cnc: MachineDef = {
  id: "CNC", type: "cnc", name: "CNC machining centre (3+1 axis)", zone: "machining", backendId: "M2", position: [ST.cnc, 0, 0], size: [3.4, 3.2, 3.2],
  description: "Mills and drills the workpiece: the door closes, the spindle head comes down, the rotary table indexes, coolant flushes the chips.",
  controls: PROCESS_CONTROLS, defaults: { rpm: 8000, force: 35, pressure: 40, temp: 42 },
  faults: [
    { code: "CNC-SPBRG", partId: "CNC.spindle", label: "Spindle bearing wear", severity: "critical", backendCodes: ["BEARING_WEAR", "MISALIGNMENT"] },
    { code: "CNC-SPMOT", partId: "CNC.spmotor", label: "Spindle motor winding overheat", severity: "critical", backendCodes: ["OVERHEATING", "MOTOR_OVERCURRENT", "PHASE_IMBALANCE"] },
    { code: "CNC-TOOL", partId: "CNC.cutter", label: "Cutting tool worn", severity: "warning", backendCodes: ["TOOL_WEAR"] },
    { code: "CNC-COOL", partId: "CNC.pump", label: "Coolant pump failure", severity: "warning", backendCodes: ["COOLING_FAILURE"] },
    { code: "CNC-DOOR", partId: "CNC.door", label: "Door interlock sensor fault", severity: "critical", backendCodes: ["SENSOR_STUCK", "SENSOR_DRIFT"] },
  ],
  subAssemblies: [
    { id: "CNC.enclosure", name: "Enclosure", parts: [
      c({ id: "CNC.back", name: "Rear enclosure wall", category: "structural", geo: { kind: "box", args: [3.2, 2.6, 0.08] }, pos: [0, 1.6, -1.5], color: "#e2e8f0", explodeVector: [0, 0, -2], explodeOrder: 0, assemblyAxis: "Z", metalness: 0.2 }),
      c({ id: "CNC.roof", name: "Enclosure roof", category: "structural", geo: { kind: "box", args: [3.2, 0.08, 3.0] }, pos: [0, 2.94, 0], color: "#cbd5e1", explodeVector: [0, 2.2, 0], explodeOrder: 0, metalness: 0.2 }),
      c({ id: "CNC.sideL", name: "Left wall (infeed hatch)", category: "structural", geo: { kind: "box", args: [0.08, 1.7, 3.0] }, pos: [-1.6, 2.05, 0], color: "#e2e8f0", explodeVector: [-1.8, 0, 0], explodeOrder: 0, assemblyAxis: "X", metalness: 0.2 }),
      c({ id: "CNC.sideR", name: "Right wall (outfeed hatch)", category: "structural", geo: { kind: "box", args: [0.08, 1.7, 3.0] }, pos: [1.6, 2.05, 0], color: "#e2e8f0", explodeVector: [1.8, 0, 0], explodeOrder: 0, assemblyAxis: "X", metalness: 0.2 }),
      c({ id: "CNC.door", name: "Sliding safety door", category: "actuator", geo: { kind: "box", args: [1.6, 1.7, 0.06] }, pos: [-0.8, 2.05, 1.5], color: "#1e40af", explodeVector: [0, 0, 2], explodeOrder: 0, assemblyAxis: "Z",
        motion: (rt) => ({ pos: [-0.8 - 1.4 * (rt.phase.door ?? 1), 2.05, 1.5] }), description: "Interlocked sliding door (category 3 safety switch).",
        telemetry: (rt) => ({ position: (rt.phase.door ?? 1) > 0.95 ? "open" : (rt.phase.door ?? 1) < 0.05 ? "closed & locked" : "moving" }) }),
      c({ id: "CNC.glass", name: "Door window (laminated)", category: "structural", parent: "CNC.door", geo: { kind: "box", args: [1.0, 0.7, 0.07] }, pos: [0, 0.2, 0.01], color: "#bae6fd", opacity: 0.35, metalness: 0, roughness: 0.05, explodeVector: [0, 0, 0.5], explodeOrder: 0, material: "Laminated polycarbonate" }),
    ] },
    { id: "CNC.structure", name: "Bed & column", parts: [
      c({ id: "CNC.bed", name: "Machine bed", category: "structural", geo: { kind: "box", args: [3.2, 0.62, 3.0] }, pos: [0, 0.31, 0], color: "#475569", explodeVector: [0, -0.6, 0], explodeOrder: 7, material: "Polymer concrete" }),
      c({ id: "CNC.column", name: "Z column", category: "structural", geo: { kind: "box", args: [0.6, 2.3, 0.5] }, pos: [0, 1.75, -1.05], color: "#64748b", explodeVector: [0, 0, -1.3], explodeOrder: 5, assemblyAxis: "Z" }),
      c({ id: "CNC.screw", name: "Z ball screw", category: "mechanical", geo: { kind: "cyl", args: [0.04, 0.04, 2.0] }, pos: [0, 1.9, -0.75], color: "#d1d5db", explodeVector: [0, 0.4, -0.9], explodeOrder: 4,
        description: "Ø32 ball screw, 10 mm lead, preloaded nut.", maintenanceNotes: "Grease nut every 500 h; check backlash < 5 µm." }),
    ] },
    { id: "CNC.spindle", name: "Spindle head", parts: [
      c({ id: "CNC.head", name: "Spindle head carriage", category: "actuator", geo: { kind: "box", args: [0.55, 0.6, 0.55] }, pos: [0, 2.3, -0.45], color: "#2563eb", explodeVector: [0, 0.8, 0], explodeOrder: 3,
        motion: (rt) => ({ pos: [0, 2.3 - 0.55 * (rt.phase.z ?? 0), -0.45] }) }),
      c({ id: "CNC.spmotor", name: "Spindle motor (direct drive)", category: "electrical", parent: "CNC.head", geo: { kind: "cyl", args: [0.2, 0.2, 0.45] }, pos: [0, 0.5, 0], color: "#1f2937", explodeVector: [0, 0.8, 0], explodeOrder: 1,
        description: "22 kW synchronous motor, liquid cooled, 12 000 rpm.", maintenanceNotes: "Measure insulation yearly (> 100 MΩ); check coolant jacket flow.",
        telemetry: (rt) => ({ speed: fmt(rt.act.rpm ?? 0, "rpm", 0), power: fmt((rt.act.rpm ?? 0) * (rt.act.force ?? 0) / 9550 / 10, "kW"), "winding temp": fmt(rt.act.temp ?? 40, "°C") }) }),
      c({ id: "CNC.spindle", name: "Spindle cartridge & bearings", category: "mechanical", parent: "CNC.head", geo: { kind: "cyl", args: [0.1, 0.1, 0.4] }, pos: [0, -0.45, 0], color: "#e5e7eb", explodeVector: [0, -0.5, 0], explodeOrder: 2,
        motion: (rt) => ({ rot: [0, rt.phase.spindle ?? 0, 0] }), description: "Angular-contact ceramic bearings (P4), HSK-A63 taper.",
        maintenanceNotes: "Vibration > 2.5 mm/s or temp > 60 °C = plan bearing replacement.",
        telemetry: (rt) => ({ speed: fmt(rt.act.rpm ?? 0, "rpm", 0), vibration: fmt(0.8 + (rt.phase.wear ?? 0) * 3, "mm/s", 2), "bearing temp": fmt(32 + (rt.act.temp ?? 40) * 0.4, "°C") }) }),
      c({ id: "CNC.cutter", name: "End mill Ø16", category: "tooling", parent: "CNC.spindle", geo: { kind: "cyl", args: [0.04, 0.04, 0.22] }, pos: [0, -0.3, 0], color: "#fbbf24", explodeVector: [0, -0.4, 0], explodeOrder: 1, material: "Carbide, TiAlN coated",
        maintenanceNotes: "Replace after 240 min of cutting or when flank wear > 0.3 mm.", telemetry: (rt) => ({ "tool life used": fmt(Math.min(100, (rt.cycles % 60) / 0.6), "%", 0) }) }),
      c({ id: "CNC.carousel", name: "Tool carousel (20 pockets)", category: "mechanical", geo: { kind: "cyl", args: [0.45, 0.45, 0.12] }, pos: [-1.05, 2.35, -0.8], color: "#94a3b8", explodeVector: [-0.6, 0.6, 0], explodeOrder: 2,
        motion: (rt) => ({ rot: [0, rt.phase.carousel ?? 0, 0] }) }),
    ] },
    { id: "CNC.table", name: "Rotary table & coolant", parts: [
      c({ id: "CNC.table", name: "Rotary table (4th axis)", category: "mechanical", geo: { kind: "cyl", args: [0.55, 0.55, 0.2] }, pos: [0, 0.72, 0], color: "#cbd5e1", explodeVector: [0, 0.35, 0], explodeOrder: 6,
        motion: (rt) => ({ rot: [0, rt.phase.table ?? 0, 0] }), description: "Direct-drive rotary table, ±5 arc-sec indexing." }),
      c({ id: "CNC.pump", name: "Coolant pump", category: "electrical", geo: { kind: "cyl", args: [0.15, 0.15, 0.35] }, pos: [1.25, 0.85, 1.2], color: "#16a34a", explodeVector: [0.6, 0, 0.6], explodeOrder: 1,
        telemetry: (rt) => ({ pressure: fmt(rt.act.pressure ?? 0, "bar"), flow: fmt((rt.act.pressure ?? 0) * 0.9, "l/min") }) }),
      c({ id: "CNC.tank", name: "Coolant tank (400 l)", category: "mechanical", geo: { kind: "box", args: [1.1, 0.5, 0.6] }, pos: [1.05, 0.25, 2.05], color: "#0f766e", explodeVector: [0.5, 0, 0.8], explodeOrder: 2 }),
      c({ id: "CNC.chip", name: "Chip conveyor", category: "mechanical", geo: { kind: "box", args: [1.6, 0.25, 0.45] }, pos: [-0.9, 0.55, 2.05], rot: [0, 0, 0.25], color: "#57534e", explodeVector: [-0.6, 0, 0.8], explodeOrder: 2 }),
      c({ id: "CNC.hmi", name: "Operator panel (HMI)", category: "electrical", geo: { kind: "box", args: [0.55, 0.7, 0.12] }, pos: [1.25, 1.6, 1.62], rot: [-0.2, 0, 0], color: "#0f172a", explodeVector: [0.5, 0, 0.6], explodeOrder: 0,
        telemetry: (rt) => ({ program: "O1024 FACE+POCKET", cycle: fmt((rt.busy ?? 0) * 100, "%", 0) }) }),
    ] },
  ],
};

// ------------------------------------------------------------------ 5. gearbox-driven servo press with hydraulic cushion
const g = partFactory("PRS");
const R_IN = 0.08, R_MID = 0.16, R_OUT = 0.2;             // gear pitch radii -> ratios
const motor = (rt: MachineRuntime) => rt.phase.motor ?? 0;
export const press: MachineDef = {
  id: "PRS", type: "press", name: "Gearbox drive & hydraulic press", zone: "machining", backendId: "M3", position: [ST.press, 0, 0], size: [3.2, 4.8, 2.2],
  description: "A motor drives a two-stage helical gearbox (ratio 1:" + ((R_MID / R_IN) * (R_OUT / R_MID)).toFixed(1) + ") that powers the press; a hydraulic cylinder adds the forming force.",
  controls: PROCESS_CONTROLS, defaults: { rpm: 1450, force: 220, pressure: 180, temp: 48 },
  faults: [
    { code: "PRS-INBRG", partId: "PRS.brgIn", label: "Gearbox input bearing overheat", severity: "critical", backendCodes: ["BEARING_WEAR", "OVERHEATING"] },
    { code: "PRS-GEAR", partId: "PRS.gMid", label: "Intermediate gear tooth wear", severity: "warning", backendCodes: ["MISALIGNMENT"] },
    { code: "PRS-SEAL", partId: "PRS.cyl", label: "Hydraulic cylinder seal leak", severity: "critical", backendCodes: ["COOLING_FAILURE"] },
    { code: "PRS-MOTOR", partId: "PRS.motor", label: "Drive motor overcurrent", severity: "critical", backendCodes: ["MOTOR_OVERCURRENT", "PHASE_IMBALANCE"] },
    { code: "PRS-PSENS", partId: "PRS.psens", label: "Pressure transducer drift", severity: "warning", backendCodes: ["SENSOR_DRIFT", "SENSOR_STUCK"] },
  ],
  subAssemblies: [
    { id: "PRS.frame", name: "Press frame", parts: [
      g({ id: "PRS.bed", name: "Bolster & bed", category: "structural", geo: { kind: "box", args: [2.4, 0.84, 1.6] }, pos: [0, 0.42, 0], color: "#334155", explodeVector: [0, -0.5, 0], explodeOrder: 7 }),
      g({ id: "PRS.colL", name: "Column (left)", category: "structural", geo: { kind: "box", args: [0.36, 2.8, 0.5] }, pos: [-1.0, 2.24, 0], color: "#b91c1c", explodeVector: [-1.2, 0, 0], explodeOrder: 1, assemblyAxis: "X" }),
      g({ id: "PRS.colR", name: "Column (right)", category: "structural", geo: { kind: "box", args: [0.36, 2.8, 0.5] }, pos: [1.0, 2.24, 0], color: "#b91c1c", explodeVector: [1.2, 0, 0], explodeOrder: 1, assemblyAxis: "X" }),
      g({ id: "PRS.crown", name: "Crown", category: "structural", geo: { kind: "box", args: [2.6, 0.6, 1.5] }, pos: [0, 3.9, 0], color: "#dc2626", explodeVector: [0, 0.9, 0], explodeOrder: 2 }),
    ] },
    { id: "PRS.hyd", name: "Hydraulic ram", parts: [
      g({ id: "PRS.cyl", name: "Hydraulic cylinder", category: "actuator", geo: { kind: "cyl", args: [0.26, 0.26, 1.0] }, pos: [0, 3.1, 0], color: "#9ca3af", explodeVector: [0, 0, 1.4], explodeOrder: 3, assemblyAxis: "Z",
        description: "Double-acting cylinder Ø200 mm, 250 bar max.", maintenanceNotes: "Inspect rod for scoring; replace seal kit at first sign of external leak.",
        telemetry: (rt) => ({ pressure: fmt(rt.act.pressure ?? 0, "bar"), force: fmt(rt.act.force ?? 0, "kN", 0) }) }),
      g({ id: "PRS.ram", name: "Ram / slide", category: "actuator", geo: { kind: "box", args: [1.3, 0.34, 1.1] }, pos: [0, 2.2, 0], color: "#475569", explodeVector: [0, 0, -1.3], explodeOrder: 2, assemblyAxis: "Z",
        motion: (rt) => ({ pos: [0, 2.2 - 0.62 * (rt.phase.ram ?? 0), 0] }), telemetry: (rt) => ({ stroke: fmt((rt.phase.ram ?? 0) * 620, "mm", 0) }) }),
      g({ id: "PRS.rod", name: "Piston rod", category: "mechanical", parent: "PRS.ram", geo: { kind: "cyl", args: [0.09, 0.09, 0.9] }, pos: [0, 0.6, 0], color: "#e5e7eb", explodeVector: [0, 0.4, 0], explodeOrder: 1 }),
      g({ id: "PRS.psens", name: "Pressure transducer", category: "sensor", geo: { kind: "cyl", args: [0.04, 0.04, 0.16] }, pos: [0.35, 3.3, 0.2], color: "#0ea5e9", explodeVector: [0.5, 0.3, 0.5], explodeOrder: 0,
        telemetry: (rt) => ({ reading: fmt((rt.act.pressure ?? 0) + (rt.phase.drift ?? 0), "bar") }) }),
      g({ id: "PRS.hpu", name: "Hydraulic power unit", category: "mechanical", geo: { kind: "box", args: [1.0, 0.8, 0.7] }, pos: [1.7, 0.4, -1.2], color: "#1d4ed8", explodeVector: [0.8, 0, -0.6], explodeOrder: 1 }),
    ] },
    { id: "PRS.gearbox", name: "Motor & 2-stage gearbox", parts: [
      g({ id: "PRS.motor", name: "Drive motor 30 kW", category: "electrical", geo: { kind: "cyl", args: [0.22, 0.22, 0.6] }, pos: [-1.05, 4.5, -0.35], rot: [0, 0, Math.PI / 2], color: "#1e3a8a", explodeVector: [-1.0, 0, 0], explodeOrder: 1, assemblyAxis: "X",
        description: "IE4 asynchronous motor, 1480 rpm, inverter driven.", telemetry: (rt) => ({ speed: fmt(rt.act.rpm ?? 0, "rpm", 0), current: fmt((rt.act.force ?? 0) * 0.25, "A"), "winding temp": fmt(rt.act.temp ?? 40, "°C") }) }),
      g({ id: "PRS.coupling", name: "Flexible coupling", category: "mechanical", geo: { kind: "cyl", args: [0.12, 0.12, 0.14] }, pos: [-0.65, 4.5, -0.35], rot: [0, 0, Math.PI / 2], color: "#f59e0b", explodeVector: [-0.6, 0, 0], explodeOrder: 1, assemblyAxis: "X",
        motion: (rt) => ({ rot: [motor(rt), 0, Math.PI / 2] }) }),
      g({ id: "PRS.hLow", name: "Gearbox housing (lower)", category: "structural", geo: { kind: "box", args: [0.8, 0.36, 1.3] }, pos: [-0.15, 4.38, 0], color: "#64748b", explodeVector: [0, -0.4, 0], explodeOrder: 3, material: "Cast iron EN-GJL-250" }),
      g({ id: "PRS.hUp", name: "Gearbox cover (upper)", category: "structural", geo: { kind: "box", args: [0.8, 0.34, 1.3] }, pos: [-0.15, 4.73, 0], color: "#94a3b8", explodeVector: [0, 1.1, 0], explodeOrder: 0, material: "Cast iron EN-GJL-250",
        maintenanceNotes: "Replace gasket and torque bolts to 45 Nm when reassembling." }),
      g({ id: "PRS.shaftIn", name: "Input shaft", category: "mechanical", geo: { kind: "cyl", args: [0.035, 0.035, 0.9] }, pos: [-0.15, 4.55, -0.35], rot: [0, 0, Math.PI / 2], color: "#e5e7eb", explodeVector: [0, 0.55, -0.3], explodeOrder: 2, assemblyAxis: "X",
        motion: (rt) => ({ rot: [motor(rt), 0, Math.PI / 2] }) }),
      g({ id: "PRS.gIn", name: `Input pinion (z=${Math.round(R_IN * 200)})`, category: "mechanical", geo: { kind: "gear", args: [R_IN, 0.12, 12] }, pos: [-0.15, 4.55, -0.35], rot: [0, Math.PI / 2, 0], color: "#fbbf24", explodeVector: [0, 0.75, -0.35], explodeOrder: 3, assemblyAxis: "X",
        motion: (rt) => ({ rot: [0, Math.PI / 2, motor(rt)] }), material: "Case-hardened 18CrNiMo7-6", telemetry: (rt) => ({ speed: fmt(rt.act.rpm ?? 0, "rpm", 0) }) }),
      g({ id: "PRS.gMid", name: `Intermediate gear (z=${Math.round(R_MID * 200)})`, category: "mechanical", geo: { kind: "gear", args: [R_MID, 0.12, 24] }, pos: [-0.15, 4.55, -0.35 + R_IN + R_MID], rot: [0, Math.PI / 2, 0], color: "#f59e0b", explodeVector: [0, 0.95, 0], explodeOrder: 3, assemblyAxis: "X",
        motion: (rt) => ({ rot: [0, Math.PI / 2, -motor(rt) * R_IN / R_MID + Math.PI / 24] }), material: "Case-hardened 18CrNiMo7-6",
        telemetry: (rt) => ({ speed: fmt((rt.act.rpm ?? 0) * R_IN / R_MID, "rpm", 0), "mesh vibration": fmt(1.1 + (rt.phase.wear ?? 0) * 2, "mm/s") }) }),
      g({ id: "PRS.gOut", name: `Output gear (z=${Math.round(R_OUT * 200)})`, category: "mechanical", geo: { kind: "gear", args: [R_OUT, 0.12, 30] }, pos: [-0.15, 4.55, -0.35 + R_IN + 2 * R_MID + R_OUT], rot: [0, Math.PI / 2, 0], color: "#d97706", explodeVector: [0, 1.15, 0.35], explodeOrder: 3, assemblyAxis: "X",
        motion: (rt) => ({ rot: [0, Math.PI / 2, motor(rt) * R_IN / R_OUT] }), telemetry: (rt) => ({ speed: fmt((rt.act.rpm ?? 0) * R_IN / R_OUT, "rpm", 0), torque: fmt((rt.act.force ?? 0) * 0.6, "kNm") }) }),
      g({ id: "PRS.brgIn", name: "Input bearing (6208)", category: "mechanical", geo: { kind: "torus", args: [0.06, 0.025] }, pos: [0.15, 4.55, -0.35], rot: [0, Math.PI / 2, 0], color: "#cbd5e1", explodeVector: [0.6, 0.6, -0.4], explodeOrder: 4, assemblyAxis: "X",
        description: "Deep-groove ball bearing supporting the input shaft.", maintenanceNotes: "Temp > 80 °C or rising vibration = lubrication issue or wear; replace with the housing cover removed.",
        telemetry: (rt) => ({ temperature: fmt(45 + (rt.act.temp ?? 40) * 0.3 + (rt.phase.heat ?? 0) * 45, "°C"), vibration: fmt(1.2 + (rt.phase.heat ?? 0) * 4, "mm/s") }) }),
      g({ id: "PRS.brgOut", name: "Output bearing (22312)", category: "mechanical", geo: { kind: "torus", args: [0.1, 0.03] }, pos: [0.15, 4.55, -0.35 + R_IN + 2 * R_MID + R_OUT], rot: [0, Math.PI / 2, 0], color: "#cbd5e1", explodeVector: [0.6, 0.6, 0.4], explodeOrder: 4, assemblyAxis: "X",
        telemetry: (rt) => ({ temperature: fmt(42 + (rt.act.temp ?? 40) * 0.25, "°C") }) }),
    ] },
  ],
};

// ------------------------------------------------------------------ conveyors (5 segments between stations)
const k = partFactory("CNV");
const SEG_X = [LINE_X0, ST.vision - 1.1, ST.vision + 1.1, ST.cnc - 1.65, ST.cnc + 1.65, ST.press - 1.25, ST.press + 1.25, ST.welding - 1.3, ST.welding + 1.3, ST.lineEnd];
export const SEGMENTS = [0, 1, 2, 3, 4].map((i) => ({ n: i + 1, x0: SEG_X[i * 2], x1: SEG_X[i * 2 + 1] }));
export const conveyors: MachineDef = {
  id: "CNV", type: "dispenser", name: "Main line conveyors (5 drives)", zone: "machining", backendId: "M6", position: [0, 0, 0], size: [46, 1.2, 1.2],
  description: "Five belt conveyor sections with their own geared drive and belt-tension sensor, chaining the stations at 0.9 m working height.",
  controls: CONVEYOR_CONTROLS, defaults: { speed: 0.6, current: 6.5, load: 120, voltage: 400 },
  faults: SEGMENTS.flatMap((s) => [
    { code: `CNV${s.n}-TENS`, partId: `CNV.s${s.n}.tension`, label: `Conveyor #${s.n} – belt tension sensor fault`, severity: "warning" as const, backendCodes: s.n === 3 ? ["SENSOR_DRIFT", "SENSOR_STUCK", "BELT_SLIP"] : [] },
    { code: `CNV${s.n}-DRIVE`, partId: `CNV.s${s.n}.motor`, label: `Conveyor #${s.n} – drive motor overcurrent`, severity: "critical" as const, backendCodes: s.n === 2 ? ["CONVEYOR_JAM", "MOTOR_OVERCURRENT"] : [] },
  ]),
  subAssemblies: SEGMENTS.map((s) => {
    const L = s.x1 - s.x0, cx = (s.x0 + s.x1) / 2;
    return { id: `CNV.s${s.n}`, name: `Conveyor #${s.n}`, parts: [
      k({ id: `CNV.s${s.n}.frame`, name: `Conveyor #${s.n} frame`, category: "structural", geo: { kind: "box", args: [L, 0.14, 1.0] }, pos: [cx, BELT_Y - 0.12, 0], color: "#facc15", explodeVector: [0, -0.5, 0], explodeOrder: 2, material: "Aluminium profile 45×90" }),
      k({ id: `CNV.s${s.n}.belt`, name: `Conveyor #${s.n} belt`, category: "mechanical", geo: { kind: "box", args: [L - 0.1, 0.03, 0.8] }, pos: [cx, BELT_Y - 0.03, 0], color: "#111827", metalness: 0, roughness: 0.8, explodeVector: [0, 0.5, 0], explodeOrder: 0, material: "PVC 2-ply belt",
        telemetry: (rt) => ({ speed: fmt(rt.act.speed ?? 0, "m/s", 2), tension: fmt(1.8 + (rt.phase[`slip${s.n}`] ?? 0), "kN") }) }),
      k({ id: `CNV.s${s.n}.motor`, name: `Conveyor #${s.n} drive motor`, category: "electrical", geo: { kind: "cyl", args: [0.12, 0.12, 0.36] }, pos: [s.x1 - 0.25, BELT_Y - 0.25, 0.62], rot: [Math.PI / 2, 0, 0], color: "#1e3a8a", explodeVector: [0, 0, 0.7], explodeOrder: 1, assemblyAxis: "Z",
        description: "0.55 kW geared motor with frequency inverter.", telemetry: (rt) => ({ current: fmt(rt.act.current ?? 0, "A"), speed: fmt((rt.act.speed ?? 0) * 1450 / 0.6, "rpm", 0) }) }),
      k({ id: `CNV.s${s.n}.gear`, name: `Conveyor #${s.n} worm gear reducer`, category: "mechanical", geo: { kind: "box", args: [0.22, 0.22, 0.2] }, pos: [s.x1 - 0.25, BELT_Y - 0.25, 0.38], color: "#475569", explodeVector: [0, -0.2, 0.5], explodeOrder: 1, assemblyAxis: "Z" }),
      k({ id: `CNV.s${s.n}.tension`, name: `Conveyor #${s.n} belt tension sensor`, category: "sensor", geo: { kind: "box", args: [0.1, 0.1, 0.1] }, pos: [s.x0 + 0.25, BELT_Y - 0.15, -0.56], color: "#0ea5e9", explodeVector: [0, 0.3, -0.6], explodeOrder: 0, assemblyAxis: "Z",
        description: "Load-cell tension sensor on the take-up pulley.", telemetry: (rt) => ({ tension: fmt(1.8 + (rt.phase[`slip${s.n}`] ?? 0), "kN"), signal: "4-20 mA" }) }),
    ] };
  }),
};

