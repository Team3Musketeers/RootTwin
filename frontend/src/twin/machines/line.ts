// Main-line machines as CAD assemblies: pallet dispenser, vision portal, CNC machining centre, gearbox + hydraulic press, conveyors.
import { at, bolts, comp, cy, fmt, hose, lathe, motorS, panel, partFactory, pneuCyl, rb, X, Z } from "../build";
import { BELT_Y, LINE_X0, ST } from "../layout";
import type { Control, MachineDef, MachineRuntime, Shape, V3 } from "../types";

const PI = Math.PI;
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
const heat = (rt: MachineRuntime) => rt.phase.heat ?? 0;
const motorTele = (rt: MachineRuntime) => ({ current: fmt((rt.act.current ?? rt.act.rpm / 600) + heat(rt) * 6, "A", 2), "winding temp": fmt((rt.act.temp ?? 40) + heat(rt) * 50, "°C"), insulation: "class F" });

/** T-slot aluminium frame: two long rails + legs + cross members. */
const tFrame = (len: number, height: number, width: number): Shape => comp(
  ...[-width / 2, width / 2].map((z) => at({ kind: "tslot", len, s: 0.045 }, [0, height, z])),
  ...[-len / 2 + 0.05, len / 2 - 0.05].flatMap((x) => [-width / 2, width / 2].map((z) => at({ kind: "tslot", len: height, s: 0.045 }, [x, height / 2, z], [0, 0, PI / 2]))),
  ...[-len / 2 + 0.05, len / 2 - 0.05].map((x) => at({ kind: "tslot", len: width, s: 0.045 }, [x, 0.15, 0], [0, PI / 2, 0])),
  ...[-len / 2 + 0.05, len / 2 - 0.05].flatMap((x) => [-width / 2, width / 2].map((z) => at(cy(0.04, 0.03), [x, 0.015, z]))),
);
/** Stack light (signal tower): green / amber / red segments on a pole. */
const stackLight: Shape = comp(at(cy(0.015, 0.4), [0, -0.2, 0]), at(cy(0.04, 0.04), [0, 0.02, 0]), at(cy(0.04, 0.02), [0, 0.32, 0]));
/** Euro pallet 1200 x 800 (boards + blocks). */
export const euroPallet: Shape = comp(
  ...[-0.5, -0.17, 0.17, 0.5].map((z) => at(rb(1.2, 0.022, 0.14, 0.004), [0, 0.133, z * 0.8])),
  ...[-0.55, 0, 0.55].flatMap((x) => [-0.33, 0, 0.33].map((z) => at(rb(0.145, 0.078, 0.145, 0.006), [x, 0.083, z]))),
  ...[-0.55, 0, 0.55].map((x) => at(rb(0.145, 0.022, 0.8, 0.004), [x, 0.033, 0])),
);

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
      d({ id: "DSP.frame", name: "T-slot frame (45 × 45)", category: "structural", mat: "brushedAlu", pos: [0, 0, 0], explodeVector: [0, -0.4, 0], explodeOrder: 5, material: "Aluminium 6063-T5 profile",
        geo: comp(at(tFrame(2.4, 3.1, 1.7)), ...[1.0, 2.0].map((y) => at({ kind: "tslot", len: 2.4, s: 0.045 }, [0, y, -0.85])), at(rb(2.4, 0.05, 1.7, 0.01), [0, 0.04, 0])) }),
      d({ id: "DSP.guardL", name: "Perforated guard (rear)", category: "structural", mat: "perforated", pos: [0, 1.7, -0.86], explodeVector: [0, 0, -1.0], explodeOrder: 0, assemblyAxis: "Z", housing: true, geo: panel(2.3, 2.6, 0.01) }),
      d({ id: "DSP.guardF", name: "Polycarbonate guard (front)", category: "structural", mat: "glass", pos: [0, 2.05, 0.86], explodeVector: [0, 0, 1.2], explodeOrder: 0, assemblyAxis: "Z", housing: true, geo: panel(2.3, 1.9, 0.01), material: "Polycarbonate 6 mm" }),
    ] },
    { id: "DSP.lift", name: "Destacking lift", parts: [
      d({ id: "DSP.mag", name: "Carrier magazine (Euro pallets)", category: "mechanical", mat: "wood", pos: [0, 2.0, 0], explodeVector: [0, 1.3, 0], explodeOrder: 1, material: "Wooden EPAL carriers",
        geo: comp(...[0, 1, 2, 3, 4].map((i) => at(euroPallet, [0, i * 0.15, 0], [0, PI / 2, 0]))), description: "Stack of raw-material carriers dropped by the AGVs." }),
      d({ id: "DSP.plate", name: "Lift plate & guide carriage", category: "actuator", mat: "steel", pos: [0, BELT_Y - 0.05, 0], explodeVector: [0, 0.5, 0], explodeOrder: 3,
        geo: comp(at(rb(1.3, 0.05, 1.2, 0.01)), ...[-0.6, 0.6].map((x) => at(rb(0.1, 0.18, 0.12, 0.02), [x, -0.1, -0.7]))),
        motion: (rt) => ({ pos: [0, BELT_Y - 0.05 + 0.6 * Math.sin((rt.phase.push ?? 0) * PI), 0] }) }),
      d({ id: "DSP.motor", name: "Lift gear motor 0.75 kW", category: "electrical", mat: "paintBlue", pos: [-0.85, 0.35, -0.55], rot: [0, 0, PI / 2], explodeVector: [-0.6, 0, -0.6], explodeOrder: 2, assemblyAxis: "X",
        geo: motorS(0.11, 0.38), description: "0.75 kW geared motor driving the lift chain.", telemetry: motorTele }),
      d({ id: "DSP.chain", name: "Lift drive chain", category: "mechanical", mat: "steel", pos: [-0.85, 1.6, -0.7], explodeVector: [-0.5, 0, -0.3], explodeOrder: 2,
        geo: { kind: "helix", r: 0.03, pitch: 0.025, turns: 100, wire: 0.008 }, description: "ISO 10B roller chain." }),
    ] },
    { id: "DSP.push", name: "Pusher & sensing", parts: [
      d({ id: "DSP.cyl", name: "Pneumatic pusher cylinder Ø50", category: "actuator", mat: "brushedAlu", pos: [-0.75, BELT_Y + 0.3, 0], rot: [0, 0, -PI / 2], explodeVector: [-0.9, 0.3, 0], explodeOrder: 2, assemblyAxis: "X",
        geo: pneuCyl(0.05, 0.6), tolerance: "stroke 400 mm ±0.5", description: "ISO 15552 cylinder, Ø50 × 400 mm stroke, 6 bar.",
        maintenanceNotes: "Check for air leaks with leak spray monthly; replace seals every 2 million cycles.",
        telemetry: (rt) => ({ "supply pressure": fmt(6 - (rt.phase.leak ?? 0), "bar"), position: fmt((rt.phase.push ?? 0) * 400, "mm", 0) }) }),
      d({ id: "DSP.rod", name: "Piston rod & push plate", category: "actuator", mat: "chrome", parent: "DSP.cyl", pos: [0, 0.3, 0], explodeVector: [0, 0.5, 0], explodeOrder: 1,
        geo: comp(at(cy(0.02, 0.5), [0, 0.25, 0]), at(rb(0.5, 0.04, 0.4, 0.01), [0, 0.5, 0])), motion: (rt) => ({ pos: [0, 0.3 + 0.9 * Math.max(0, Math.sin((rt.phase.push ?? 0) * PI)), 0] }) }),
      d({ id: "DSP.pe", name: "Photo-eye (presence)", category: "sensor", mat: "plasticBlack", pos: [1.05, BELT_Y + 0.25, -0.55], explodeVector: [0.4, 0.4, -0.4], explodeOrder: 0,
        geo: comp(at(rb(0.05, 0.08, 0.1, 0.008)), at(cy(0.012, 0.01), [0, 0, 0.055], Z)), description: "Diffuse photo-electric sensor detecting a workpiece at the outlet.",
        telemetry: (rt) => ({ signal: (rt.phase.drift ?? 0) > 0 ? "unstable" : "OK", "switching freq": "500 Hz" }) }),
      d({ id: "DSP.beam", name: "Photo-eye beam", category: "sensor", mat: "laser", parent: "DSP.pe", pos: [0, 0, 0.55], explodeVector: [0, 0.2, 0], explodeOrder: 0, geo: cy(0.004, 1.0), rot: Z }),
      d({ id: "DSP.valve", name: "Pneumatic valve terminal (4 × 5/2)", category: "actuator", mat: "anodized", pos: [-1.05, 1.2, -0.6], explodeVector: [-0.6, 0.2, -0.4], explodeOrder: 1,
        geo: comp(at(rb(0.08, 0.1, 0.3, 0.01)), ...Array.from({ length: 4 }, (_, i) => at(rb(0.05, 0.12, 0.05, 0.008), [0.06, 0.02, -0.11 + i * 0.075])),
          at(hose([[0.1, 0, 0.1], [0.3, -0.2, 0.35], [0.3, -0.1, 0.6]], 0.006, true)), at(hose([[0.1, 0, -0.1], [0.2, -0.5, 0.2], [0.3, -0.85, 0.6]], 0.006, true))),
        description: "Valve island driving the pusher and the lift brake, with exhaust silencers.", tolerance: "6 bar ±0.2" }),
    ] },
    { id: "DSP.ctrl", name: "Control & signalling", parts: [
      d({ id: "DSP.box", name: "Local control box (IP65)", category: "electrical", mat: "sheetGrey", pos: [1.15, 1.25, -0.6], explodeVector: [0.7, 0, -0.3], explodeOrder: 2, housing: true,
        geo: comp(at(rb(0.12, 0.6, 0.45, 0.02)), at(rb(0.02, 0.5, 0.36, 0.005), [0.065, 0, 0]), ...[-0.2, 0.2].map((y) => at(cy(0.012, 0.03), [0.075, y, 0.19], Z))),
        description: "Remote I/O, motor starter and safety relay for the dispenser.", material: "Powder-coated steel, IP65" }),
      d({ id: "DSP.hmi", name: "Operator touch panel 7\"", category: "electrical", mat: "screen", pos: [1.22, 1.45, -0.6], rot: [0, PI / 2, 0], explodeVector: [0.5, 0.2, 0], explodeOrder: 1, geo: rb(0.2, 0.14, 0.01, 0.005) }),
      d({ id: "DSP.stack", name: "Signal tower", category: "electrical", mat: "ledGreen", pos: [1.15, 3.35, -0.75], explodeVector: [0, 0.4, 0], explodeOrder: 0, geo: stackLight }),
      d({ id: "DSP.bed", name: "Outlet roller bed", category: "mechanical", mat: "steel", pos: [0, BELT_Y - 0.06, 0], explodeVector: [0, -0.3, 0], explodeOrder: 4,
        geo: comp(...Array.from({ length: 8 }, (_, i) => at(cy(0.04, 0.9), [-0.9 + i * 0.26, 0, 0], Z)), ...[-0.48, 0.48].map((z) => at(rb(2.1, 0.08, 0.03, 0.01), [0, 0, z]))) }),
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
    { code: "VIS-DIVERT", partId: "VIS.pusher", label: "Reject pusher stuck", severity: "critical", backendCodes: ["CONVEYOR_JAM", "BELT_SLIP"] },
    { code: "VIS-CURTAIN", partId: "VIS.lcE", label: "Light curtain misaligned", severity: "critical" },
  ],
  subAssemblies: [
    { id: "VIS.portal", name: "Portal gantry", parts: [
      v({ id: "VIS.bed", name: "Transfer roller bed", category: "mechanical", mat: "steel", pos: [0, BELT_Y - 0.06, 0], explodeVector: [0, -0.4, 0], explodeOrder: 4,
        geo: comp(...Array.from({ length: 8 }, (_, i) => at(cy(0.04, 0.9), [-0.9 + i * 0.26, 0, 0], Z)), ...[-0.48, 0.48].map((z) => at(rb(2.1, 0.08, 0.03, 0.01), [0, 0, z])), at(tFrame(2.1, BELT_Y - 0.1, 0.96), [0, -(BELT_Y - 0.06), 0])) }),
      v({ id: "VIS.gantry", name: "Portal gantry (T-slot 90 × 90)", category: "structural", mat: "brushedAlu", pos: [0, 0, 0], explodeVector: [0, 0, 0], explodeOrder: 3,
        geo: comp(...[-0.95, 0.95].map((z) => at({ kind: "tslot", len: 2.6, s: 0.09 }, [0, 1.3, z], [0, 0, PI / 2])), at({ kind: "tslot", len: 2.0, s: 0.09 }, [0, 2.62, 0], [0, PI / 2, 0]),
          ...[-0.95, 0.95].map((z) => at(rb(0.3, 0.03, 0.3, 0.01), [0, 0.015, z])), at(rb(0.12, 0.12, 2.0, 0.02), [0, 2.74, 0])) }),
      v({ id: "VIS.tray", name: "Cable tray & conduit", category: "electrical", mat: "rubber", pos: [0, 0, 0], explodeVector: [0, 0.6, -0.4], explodeOrder: 0,
        geo: hose([[0.12, 2.6, 0.3], [0.2, 2.75, -0.2], [0.25, 2.7, -0.9], [0.4, 2.2, -1.0], [0.5, 2.5, -0.98]], 0.018) }),
    ] },
    { id: "VIS.optics", name: "Optics & sensing", parts: [
      v({ id: "VIS.cam", name: "Colour area-scan camera", category: "sensor", mat: "anodized", pos: [0, 2.3, 0.3], explodeVector: [0, 0.4, 0.6], explodeOrder: 0,
        geo: comp(at(rb(0.12, 0.12, 0.16, 0.02), [0, 0.08, 0]), at(lathe([[0, 0], [0.045, 0], [0.045, 0.12], [0.05, 0.14], [0.05, 0.18], [0, 0.18]]), [0, -0.14, 0], [PI, 0, 0]), at(hose([[0, 0.14, -0.05], [0, 0.25, -0.15], [0.1, 0.35, -0.3]], 0.008))),
        description: "5 MP GigE camera with telecentric lens, inspects surface defects and labels.", maintenanceNotes: "Clean lens with optical wipe weekly; recalibrate with the reference target after any knock.",
        tolerance: "measurement ±0.05 mm", telemetry: (rt) => ({ exposure: "180 µs", fps: "60", "focus score": (rt.phase.drift ?? 0) ? "0.41 (fouled)" : "0.94" }) }),
      v({ id: "VIS.laser", name: "Laser line profile scanner", category: "sensor", mat: "paintRed", pos: [0, 2.3, -0.3], explodeVector: [0, 0.4, -0.6], explodeOrder: 0,
        geo: comp(at(rb(0.1, 0.2, 0.3, 0.02)), at(rb(0.06, 0.02, 0.22, 0.005), [0, -0.105, 0])),
        description: "Class 2M laser triangulation sensor, 2 kHz profiles, ±0.02 mm.", telemetry: () => ({ "profile rate": "2 kHz", "laser power": "8 mW" }) }),
      v({ id: "VIS.plane", name: "Laser line (projected)", category: "sensor", mat: "laser", parent: "VIS.laser", pos: [0, -0.68, 0], explodeVector: [0, -0.2, 0], explodeOrder: 0,
        geo: { kind: "extrude", outline: [[-0.01, 0.57], [0.01, 0.57], [0.35, -0.57], [-0.35, -0.57]], depth: 0.002, bevel: 0 }, rot: [0, PI / 2, 0] }),
      v({ id: "VIS.ring", name: "LED ring light", category: "electrical", mat: "ledWhite", pos: [0, 2.0, 0.3], explodeVector: [0, -0.5, 0.3], explodeOrder: 1, geo: { kind: "torus", R: 0.09, r: 0.018 }, rot: Z }),
      v({ id: "VIS.lcE", name: "Safety light curtain (emitter)", category: "sensor", mat: "safetyYellow", pos: [-0.85, BELT_Y + 0.6, -0.75], explodeVector: [-0.6, 0, -0.6], explodeOrder: 1,
        geo: comp(at(rb(0.05, 1.2, 0.05, 0.01)), ...Array.from({ length: 10 }, (_, i) => at(cy(0.006, 0.01), [0, -0.5 + i * 0.11, 0.026], Z))) }),
      v({ id: "VIS.lcR", name: "Safety light curtain (receiver)", category: "sensor", mat: "safetyYellow", pos: [-0.85, BELT_Y + 0.6, 0.75], explodeVector: [-0.6, 0, 0.6], explodeOrder: 1, geo: rb(0.05, 1.2, 0.05, 0.01) }),
      v({ id: "VIS.pc", name: "Edge vision computer", category: "electrical", mat: "graphite", pos: [0.55, 2.4, -0.95], explodeVector: [0.5, 0.5, -0.5], explodeOrder: 0,
        geo: comp(at(rb(0.3, 0.42, 0.18, 0.02)), ...Array.from({ length: 8 }, (_, i) => at(rb(0.3, 0.008, 0.03, 0.002), [0, -0.18 + i * 0.05, 0.1]))), telemetry: () => ({ "CPU load": "41 %", inference: "7.8 ms", model: "defect-net v3" }) }),
    ] },
    { id: "VIS.tunnel", name: "Light tunnel & services", parts: [
      v({ id: "VIS.hood", name: "Light-tight inspection tunnel", category: "structural", mat: "smokedGlass", pos: [0, 2.05, 0], explodeVector: [0, 1.1, 0], explodeOrder: 2, housing: true,
        geo: comp(at(rb(1.6, 0.03, 1.8, 0.01), [0, 0.55, 0]), ...[-0.9, 0.9].map((z) => at(rb(1.6, 1.1, 0.02, 0.01), [0, 0, z]))), material: "Smoked polycarbonate 4 mm",
        description: "Blocks ambient light so the camera exposure stays constant; hinged for lens cleaning." }),
      v({ id: "VIS.air", name: "Air service unit (filter-regulator)", category: "actuator", mat: "brushedAlu", pos: [1.0, 1.2, -1.0], explodeVector: [0.4, 0, -0.5], explodeOrder: 1, tolerance: "6.0 bar ±0.1",
        geo: comp(at(rb(0.14, 0.08, 0.1, 0.01), [0, 0.12, 0]), at(lathe([[0, 0], [0.04, 0], [0.045, 0.08], [0.04, 0.16], [0, 0.16]]), [0, -0.08, 0]), at(cy(0.03, 0.02), [0, 0.18, 0]),
          at(hose([[0.07, 0.12, 0], [0.3, 0.3, 0.2], [-0.15, 0.6, 0.25]], 0.006, true))) }),
      v({ id: "VIS.chain", name: "Cable drag chain", category: "electrical", mat: "plasticBlack", pos: [-0.3, 2.66, 0], explodeVector: [0, 0.5, 0], explodeOrder: 0,
        geo: comp(...Array.from({ length: 14 }, (_, i) => at(rb(0.05, 0.035, 0.06, 0.006), [0, 0, -0.85 + i * 0.13]))) }),
    ] },
    { id: "VIS.reject", name: "Reject unit", parts: [
      v({ id: "VIS.pusher", name: "Pneumatic reject pusher", category: "actuator", mat: "brushedAlu", pos: [0.85, BELT_Y + 0.25, -0.75], rot: [PI / 2, 0, 0], explodeVector: [0.5, 0.4, -0.5], explodeOrder: 1,
        geo: pneuCyl(0.035, 0.4), description: "Pushes rejected parts sideways into the bin." }),
      v({ id: "VIS.paddle", name: "Pusher paddle", category: "actuator", mat: "paintRed", parent: "VIS.pusher", pos: [0, 0.3, 0], explodeVector: [0, 0.4, 0], explodeOrder: 0,
        geo: comp(at(cy(0.015, 0.3), [0, -0.1, 0]), at(rb(0.4, 0.03, 0.3, 0.01), [0, 0.06, 0])), motion: (rt) => ({ pos: [0, 0.3 + 0.9 * (rt.phase.divert ?? 0), 0] }) }),
      v({ id: "VIS.bin", name: "Reject bin (perforated)", category: "structural", mat: "perforated", pos: [0.9, 0.35, 1.5], explodeVector: [0, 0, 0.8], explodeOrder: 2,
        geo: comp(at(panel(0.9, 0.7, 0.01), [0, 0, 0.4]), at(panel(0.9, 0.7, 0.01), [0, 0, -0.4]), at(panel(0.8, 0.7, 0.01), [0.45, 0, 0], [0, PI / 2, 0]), at(panel(0.8, 0.7, 0.01), [-0.45, 0, 0], [0, PI / 2, 0]), at(panel(0.9, 0.8, 0.01), [0, -0.35, 0], [PI / 2, 0, 0])) }),
    ] },
  ],
};

// ------------------------------------------------------------------ 4. CNC machining centre
const c = partFactory("CNC");
const toolHolders: Shape = comp(...Array.from({ length: 16 }, (_, i) => {
  const a = (i / 16) * PI * 2;
  return at(comp(at(lathe([[0, 0], [0.035, 0], [0.035, 0.04], [0.025, 0.07], [0.02, 0.07], [0.008, 0.16], [0, 0.16]]))), [Math.cos(a) * 0.38, -0.2, Math.sin(a) * 0.38], [PI, 0, 0]);
}));
export const cnc: MachineDef = {
  id: "CNC", type: "cnc", name: "CNC vertical machining centre", zone: "machining", backendId: "M2", position: [ST.cnc, 0, 0], size: [3.4, 3.2, 3.2],
  description: "Mills and drills the workpiece: the door closes, the spindle head comes down along the linear guides, the rotary table indexes, coolant flushes the chips onto the auger.",
  controls: PROCESS_CONTROLS, defaults: { rpm: 8000, force: 35, pressure: 40, temp: 42 },
  faults: [
    { code: "CNC-SPBRG", partId: "CNC.spbrg", label: "Spindle bearing wear", severity: "critical", backendCodes: ["BEARING_WEAR", "MISALIGNMENT"] },
    { code: "CNC-SPMOT", partId: "CNC.spmotor", label: "Spindle motor winding overheat", severity: "critical", backendCodes: ["OVERHEATING", "MOTOR_OVERCURRENT", "PHASE_IMBALANCE"] },
    { code: "CNC-TOOL", partId: "CNC.cutter", label: "End mill worn", severity: "warning", backendCodes: ["TOOL_WEAR"] },
    { code: "CNC-COOL", partId: "CNC.pump", label: "Coolant pump failure", severity: "warning", backendCodes: ["COOLING_FAILURE"] },
    { code: "CNC-DOOR", partId: "CNC.door", label: "Door interlock sensor fault", severity: "critical", backendCodes: ["SENSOR_STUCK", "SENSOR_DRIFT"] },
  ],
  subAssemblies: [
    { id: "CNC.enclosure", name: "Enclosure", parts: [
      c({ id: "CNC.back", name: "Rear enclosure panel", category: "structural", mat: "sheetWhite", pos: [0, 1.62, -1.5], explodeVector: [0, 0, -2.2], explodeOrder: 0, assemblyAxis: "Z", housing: true, geo: panel(3.2, 2.6, 0.05) }),
      c({ id: "CNC.roof", name: "Enclosure roof with interior light", category: "structural", mat: "sheetWhite", pos: [0, 2.95, 0], explodeVector: [0, 2.2, 0], explodeOrder: 0, housing: true,
        geo: comp(at(rb(3.2, 0.06, 3.0, 0.03)), at(rb(1.8, 0.03, 0.1, 0.01), [0, -0.05, 0.6])) }),
      c({ id: "CNC.light", name: "Interior LED light bar", category: "electrical", mat: "ledWhite", parent: "CNC.roof", pos: [0, -0.07, 0.6], explodeVector: [0, -0.3, 0], explodeOrder: 0, geo: rb(1.7, 0.02, 0.06, 0.008) }),
      c({ id: "CNC.sideL", name: "Left panel (infeed hatch)", category: "structural", mat: "sheetGrey", pos: [-1.6, 2.06, 0], explodeVector: [-2.0, 0, 0], explodeOrder: 0, assemblyAxis: "X", housing: true, geo: panel(0.05, 1.75, 3.0) }),
      c({ id: "CNC.sideR", name: "Right panel (outfeed hatch)", category: "structural", mat: "sheetGrey", pos: [1.6, 2.06, 0], explodeVector: [2.0, 0, 0], explodeOrder: 0, assemblyAxis: "X", housing: true, geo: panel(0.05, 1.75, 3.0) }),
      c({ id: "CNC.front", name: "Front fascia (fixed)", category: "structural", mat: "sheetWhite", pos: [0.85, 2.06, 1.5], explodeVector: [0, 0, 2.2], explodeOrder: 0, assemblyAxis: "Z", housing: true, geo: panel(1.5, 1.75, 0.05) }),
      c({ id: "CNC.door", name: "Sliding safety door frame", category: "actuator", mat: "sheetGrey", pos: [-0.8, 2.06, 1.56], explodeVector: [0, 0, 2.6], explodeOrder: 0, assemblyAxis: "Z",
        geo: comp(at(rb(1.6, 0.12, 0.05, 0.02), [0, 0.8, 0]), at(rb(1.6, 0.12, 0.05, 0.02), [0, -0.8, 0]), at(rb(0.12, 1.7, 0.05, 0.02), [-0.74, 0, 0]), at(rb(0.12, 1.7, 0.05, 0.02), [0.74, 0, 0]), at(rb(0.05, 0.5, 0.06, 0.02), [0.6, 0, 0.05])),
        motion: (rt) => ({ pos: [-0.8 + 1.5 * (rt.phase.door ?? 1), 2.06, 1.56 + 0.08 * (rt.phase.door ?? 1)] }), description: "Interlocked sliding door (category 3 safety switch).",
        telemetry: (rt) => ({ position: (rt.phase.door ?? 1) > 0.95 ? "open" : (rt.phase.door ?? 1) < 0.05 ? "closed & locked" : "moving" }) }),
      c({ id: "CNC.glass", name: "Tempered safety glass", category: "structural", mat: "glass", parent: "CNC.door", pos: [0, 0, 0], explodeVector: [0, 0, 0.5], explodeOrder: 0, geo: rb(1.38, 1.5, 0.02, 0.005), material: "Laminated polycarbonate + tempered glass" }),
      c({ id: "CNC.tower", name: "Signal tower", category: "electrical", mat: "ledGreen", pos: [1.4, 3.35, -1.3], explodeVector: [0, 0.6, 0], explodeOrder: 0, geo: stackLight }),
      c({ id: "CNC.hmi", name: "Operator pendant on swivel arm", category: "electrical", mat: "graphite", pos: [1.75, 1.7, 1.55], explodeVector: [0.6, 0, 0.6], explodeOrder: 0,
        geo: comp(at(rb(0.55, 0.65, 0.1, 0.03)), at(hose([[-0.2, 0.32, -0.05], [-0.3, 0.6, -0.3], [-0.35, 1.2, -0.3]], 0.03)), ...Array.from({ length: 12 }, (_, i) => at(cy(0.015, 0.02), [-0.2 + (i % 6) * 0.08, -0.25 + Math.floor(i / 6) * 0.06, 0.055], Z))),
        telemetry: (rt) => ({ program: "O1024 FACE+POCKET", cycle: fmt((rt.busy ?? 0) * 100, "%", 0), feed: "2 400 mm/min" }) }),
      c({ id: "CNC.screen", name: "HMI touch screen", category: "electrical", mat: "screen", parent: "CNC.hmi", pos: [0, 0.1, 0.052], explodeVector: [0, 0, 0.3], explodeOrder: 0, geo: rb(0.45, 0.3, 0.005, 0.002) }),
    ] },
    { id: "CNC.structure", name: "Bed, column & axes", parts: [
      c({ id: "CNC.bed", name: "Cast-iron machine bed", category: "structural", mat: "castIron", pos: [0, 0.31, 0], explodeVector: [0, -0.7, 0], explodeOrder: 8, material: "Meehanite cast iron GA",
        geo: comp(at(rb(3.1, 0.62, 2.9, 0.06)), ...[-1, 0, 1].map((i) => at(rb(0.06, 0.4, 2.7, 0.02), [i * 0.9, 0.2, 0]))), tolerance: "guide-way straightness 5 µm / m" }),
      c({ id: "CNC.rails", name: "Linear guide rails (X) & ball screw", category: "mechanical", mat: "steel", pos: [0, 0.66, 0], explodeVector: [0, 0.3, 0], explodeOrder: 6,
        geo: comp(...[-0.4, 0.4].map((z) => at(rb(2.6, 0.05, 0.05, 0.005), [0, 0, z])), at(cy(0.022, 2.4), [0, 0, 0], X), ...[-0.4, 0.4].flatMap((z) => [-0.3, 0.3].map((x) => at(rb(0.14, 0.06, 0.09, 0.01), [x, 0.04, z])))),
        tolerance: "preload class P, H accuracy", description: "35 mm profiled rail guides with recirculating ball carriages and a Ø40 C3 ball screw." }),
      c({ id: "CNC.column", name: "Z column (ribbed casting)", category: "structural", mat: "castIron", pos: [0, 1.75, -1.05], explodeVector: [0, 0, -1.5], explodeOrder: 7, assemblyAxis: "Z",
        geo: comp(at(rb(0.7, 2.3, 0.5, 0.05)), ...[-0.3, 0, 0.3].map((x) => at(rb(0.04, 2.1, 0.12, 0.01), [x, 0, -0.3])), ...[-0.2, 0.2].map((x) => at(rb(0.05, 2.0, 0.05, 0.005), [x, 0.05, 0.27]))) }),
      c({ id: "CNC.screw", name: "Z ball screw Ø32", category: "mechanical", mat: "chrome", pos: [0, 1.9, -0.76], explodeVector: [0, 0.4, -0.9], explodeOrder: 5,
        geo: comp(at(cy(0.016, 1.9)), at({ kind: "helix", r: 0.018, pitch: 0.01, turns: 180, wire: 0.003 })), tolerance: "C3, lead 10 mm",
        description: "Ø32 ball screw, 10 mm lead, preloaded nut.", maintenanceNotes: "Grease nut every 500 h; check backlash < 5 µm." }),
    ] },
    { id: "CNC.spindle", name: "Spindle head", parts: [
      c({ id: "CNC.head", name: "Spindle head carriage (finned)", category: "actuator", mat: "paintBlue", pos: [0, 2.3, -0.45], explodeVector: [0, 0.9, 0], explodeOrder: 4, housing: true,
        geo: comp(at(rb(0.55, 0.62, 0.55, 0.06)), ...Array.from({ length: 7 }, (_, i) => at(rb(0.6, 0.012, 0.6, 0.004), [0, -0.25 + i * 0.07, 0]))),
        motion: (rt) => ({ pos: [0, 2.3 - 0.55 * (rt.phase.z ?? 0), -0.45] }) }),
      c({ id: "CNC.spmotor", name: "Spindle motor 22 kW", category: "electrical", mat: "graphite", parent: "CNC.head", pos: [0, 0.55, 0], explodeVector: [0, 0.9, 0], explodeOrder: 1,
        geo: motorS(0.16, 0.42), description: "22 kW synchronous motor, liquid cooled, 12 000 rpm.", maintenanceNotes: "Measure insulation yearly (> 100 MΩ); check the coolant jacket flow.",
        telemetry: (rt) => ({ speed: fmt(rt.act.rpm ?? 0, "rpm", 0), power: fmt((rt.act.rpm ?? 0) * (rt.act.force ?? 0) / 9550 / 10, "kW"), "winding temp": fmt((rt.act.temp ?? 40) + heat(rt) * 60, "°C") }) }),
      c({ id: "CNC.spbrg", name: "Spindle cartridge (angular-contact bearings)", category: "mechanical", mat: "steel", parent: "CNC.head", pos: [0, -0.42, 0], explodeVector: [0, -0.45, 0], explodeOrder: 3,
        geo: comp(at(lathe([[0.07, -0.2], [0.11, -0.2], [0.11, 0.15], [0.13, 0.17], [0.13, 0.2], [0.07, 0.2]])), at({ kind: "bearing", ri: 0.05, ro: 0.1, w: 0.05, n: 16, taper: false }, [0, -0.12, 0]), at({ kind: "bearing", ri: 0.05, ro: 0.1, w: 0.05, n: 16, taper: false }, [0, 0.08, 0])),
        tolerance: "run-out < 2 µm (HSK-A63)", description: "P4 ceramic angular-contact bearings, oil-air lubricated.", maintenanceNotes: "Vibration > 2.5 mm/s or temp > 60 °C = plan bearing replacement.",
        telemetry: (rt) => ({ vibration: fmt(0.8 + (rt.phase.wear ?? 0) * 3.2, "mm/s", 2), "bearing temp": fmt(32 + (rt.act.temp ?? 40) * 0.4 + (rt.phase.wear ?? 0) * 30, "°C") }) }),
      c({ id: "CNC.spindle", name: "Spindle shaft & HSK holder", category: "mechanical", mat: "chrome", parent: "CNC.spbrg", pos: [0, -0.24, 0], explodeVector: [0, -0.35, 0], explodeOrder: 2,
        geo: lathe([[0, 0.3], [0.05, 0.3], [0.05, 0.02], [0.045, 0], [0.03, -0.07], [0.02, -0.07], [0, -0.07]]), motion: (rt) => ({ rot: [0, rt.phase.spindle ?? 0, 0] }),
        telemetry: (rt) => ({ speed: fmt(rt.act.rpm ?? 0, "rpm", 0) }) }),
      c({ id: "CNC.cutter", name: "Carbide end mill Ø16", category: "tooling", mat: "brass", parent: "CNC.spindle", pos: [0, -0.18, 0], explodeVector: [0, -0.35, 0], explodeOrder: 1,
        geo: comp(at(cy(0.016, 0.1), [0, 0.04, 0]), at({ kind: "helix", r: 0.012, pitch: 0.03, turns: 3, wire: 0.005 }, [0, -0.05, 0])), material: "Carbide, TiAlN coated",
        maintenanceNotes: "Replace after 240 min of cutting or when flank wear > 0.3 mm.", tolerance: "Ø16 h6",
        telemetry: (rt) => ({ "tool life used": fmt(Math.min(100, (rt.cycles % 60) / 0.6 + (rt.phase.wear ?? 0) * 40), "%", 0) }) }),
      c({ id: "CNC.carousel", name: "Automatic tool changer (16 tools)", category: "mechanical", mat: "anodized", pos: [-1.05, 2.45, -0.75], explodeVector: [-0.7, 0.7, 0], explodeOrder: 2,
        geo: comp(at(cy(0.45, 0.06)), at(toolHolders), at(cy(0.08, 0.2), [0, 0.12, 0])), motion: (rt) => ({ rot: [0, rt.phase.carousel ?? 0, 0] }) }),
    ] },
    { id: "CNC.table", name: "Worktable & coolant", parts: [
      c({ id: "CNC.table", name: "Rotary T-slot table (4th axis)", category: "mechanical", mat: "castIron", pos: [0, 0.74, 0], explodeVector: [0, 0.4, 0], explodeOrder: 6,
        geo: comp(at(cy(0.55, 0.14)), ...[-0.3, -0.1, 0.1, 0.3].map((x) => at(rb(0.05, 0.02, 1.0, 0.005), [x, 0.07, 0]))), motion: (rt) => ({ rot: [0, rt.phase.table ?? 0, 0] }),
        tolerance: "indexing ±5 arc-sec", description: "Direct-drive rotary table with T-slots." }),
      c({ id: "CNC.vise", name: "Hydraulic machine vise", category: "tooling", mat: "steel", parent: "CNC.table", pos: [0, 0.12, 0], explodeVector: [0, 0.35, 0], explodeOrder: 1,
        geo: comp(at(rb(0.7, 0.1, 0.22, 0.01)), at(rb(0.08, 0.15, 0.24, 0.01), [-0.3, 0.1, 0]), at(rb(0.08, 0.15, 0.24, 0.01), [0.3, 0.1, 0]), at(cy(0.025, 0.12), [0.4, 0.04, 0], X)) }),
      c({ id: "CNC.nozzles", name: "Coolant nozzles", category: "mechanical", mat: "copper", pos: [0, 0, 0], explodeVector: [0, 0.4, 0.4], explodeOrder: 0,
        geo: comp(at(hose([[0.3, 2.0, -0.5], [0.25, 1.4, -0.3], [0.08, 1.15, -0.05]], 0.012)), at(hose([[-0.3, 2.0, -0.5], [-0.25, 1.4, -0.3], [-0.08, 1.15, -0.05]], 0.012))) }),
      c({ id: "CNC.pump", name: "Coolant pump", category: "electrical", mat: "paintGreen", pos: [1.25, 0.25, 2.05], explodeVector: [0.6, 0, 0.6], explodeOrder: 1,
        geo: comp(at(motorS(0.09, 0.26), [0, 0.3, 0]), at(lathe([[0, 0], [0.1, 0], [0.12, 0.08], [0.06, 0.12], [0, 0.12]]), [0, 0.1, 0])),
        telemetry: (rt) => ({ pressure: fmt((rt.act.pressure ?? 0) * (1 - (rt.phase.heat ?? 0) * 0.8), "bar"), flow: fmt((rt.act.pressure ?? 0) * 0.9, "l/min") }) }),
      c({ id: "CNC.tank", name: "Coolant tank 400 l", category: "mechanical", mat: "sheetGrey", pos: [1.05, 0.25, 2.05], explodeVector: [0.5, -0.2, 0.9], explodeOrder: 2, geo: rb(1.1, 0.5, 0.6, 0.03) }),
      c({ id: "CNC.auger", name: "Chip auger conveyor", category: "mechanical", mat: "steel", pos: [-0.85, 0.5, 2.05], rot: [0, 0, 0.3], explodeVector: [-0.6, 0, 0.9], explodeOrder: 2,
        geo: comp(at({ kind: "helix", r: 0.09, pitch: 0.12, turns: 12, wire: 0.012 }, [0, 0, 0], X), at(cy(0.02, 1.5), [0, 0, 0], X), at(rb(1.6, 0.04, 0.24, 0.01), [0, -0.12, 0])) }),
    ] },
  ],
};

// ------------------------------------------------------------------ 5. gearbox-driven servo press with hydraulic cylinder
const g = partFactory("PRS");
const MOD = 0.012;                                   // gear module 12 mm
const Z_IN = 14, Z_MID = 28, Z_OUT = 36;
const R_IN = (MOD * Z_IN) / 2, R_MID = (MOD * Z_MID) / 2, R_OUT = (MOD * Z_OUT) / 2;
const GY = 4.62, GX = -0.15;                         // gearbox shaft height / x
const zIn = -0.3, zMid = zIn + R_IN + R_MID, zOut = zMid + R_MID + R_OUT;
const motor = (rt: MachineRuntime) => rt.phase.motor ?? 0;
const ribbedBox = (w: number, h: number, dd: number, ribs: number): Shape => comp(at(rb(w, h, dd, 0.04)), ...Array.from({ length: ribs }, (_, i) => at(rb(0.025, h * 0.9, dd + 0.04, 0.01), [-w / 2 + (w / (ribs + 1)) * (i + 1), 0, 0])));
export const press: MachineDef = {
  id: "PRS", type: "press", name: "Gearbox drive & hydraulic press", zone: "machining", backendId: "M3", position: [ST.press, 0, 0], size: [3.2, 5.2, 2.2],
  description: `A 30 kW motor drives a two-stage helical gearbox (z${Z_IN}/z${Z_MID} - z${Z_MID}/z${Z_OUT}, ratio 1:${(Z_OUT / Z_IN).toFixed(2)}) on the crown; a hydraulic cylinder adds the forming force.`,
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
      g({ id: "PRS.bed", name: "Bed & T-slot bolster", category: "structural", mat: "castIron", pos: [0, 0.42, 0], explodeVector: [0, -0.6, 0], explodeOrder: 8,
        geo: comp(at(rb(2.4, 0.84, 1.6, 0.05)), ...[-0.4, 0, 0.4].map((z) => at(rb(1.6, 0.02, 0.06, 0.005), [0, 0.42, z]))), tolerance: "bolster parallelism 0.03 mm" }),
      ...([-1, 1] as const).map((sx) => g({ id: sx < 0 ? "PRS.colL" : "PRS.colR", name: `Column (${sx < 0 ? "left" : "right"})`, category: "structural", mat: "paintRed", pos: [sx * 1.0, 2.25, 0], explodeVector: [sx * 1.3, 0, 0], explodeOrder: 1, assemblyAxis: "X",
        geo: comp(at(rb(0.38, 2.8, 0.55, 0.05)), at(rb(0.08, 2.6, 0.62, 0.02), [sx * 0.12, 0, 0])) })),
      g({ id: "PRS.crown", name: "Crown", category: "structural", mat: "paintRed", pos: [0, 3.95, 0], explodeVector: [0, 0.9, 0], explodeOrder: 2, geo: ribbedBox(2.6, 0.6, 1.5, 5) }),
      g({ id: "PRS.tierods", name: "Tie rods & nuts (×4)", category: "mechanical", mat: "steel", pos: [0, 0, 0], explodeVector: [0, 0.6, 0.6], explodeOrder: 3,
        geo: comp(...[-1, 1].flatMap((x) => [-0.3, 0.3].flatMap((z) => [at(cy(0.04, 4.4), [x * 1.0, 2.2, z]), at(cy(0.07, 0.06, 0.07), [x * 1.0, 4.3, z]), at(cy(0.07, 0.06, 0.07), [x * 1.0, 0.86, z])]))) }),
    ] },
    { id: "PRS.hyd", name: "Hydraulics & ram", parts: [
      g({ id: "PRS.cyl", name: "Hydraulic cylinder Ø200", category: "actuator", mat: "steel", pos: [0, 3.1, 0], explodeVector: [0, 0, 1.5], explodeOrder: 3, assemblyAxis: "Z",
        geo: comp(at(lathe([[0, -0.5], [0.24, -0.5], [0.26, -0.45], [0.26, 0.45], [0.3, 0.5], [0.3, 0.6], [0, 0.6]])), at(bolts(0.28, 8, 0.02), [0, 0.6, 0])),
        tolerance: "bore H8, rod f7", description: "Double-acting cylinder Ø200 mm, 250 bar max.", maintenanceNotes: "Inspect the rod for scoring; replace the seal kit at the first sign of external leak.",
        telemetry: (rt) => ({ pressure: fmt((rt.act.pressure ?? 0) - (rt.phase.leak ?? 0) * 20, "bar"), force: fmt(rt.act.force ?? 0, "kN", 0) }) }),
      g({ id: "PRS.ram", name: "Ram / slide", category: "actuator", mat: "castIron", pos: [0, 2.2, 0], explodeVector: [0, 0, -1.5], explodeOrder: 2, assemblyAxis: "Z",
        geo: comp(at(rb(1.3, 0.34, 1.1, 0.04)), ...[-0.55, 0.55].map((x) => at(rb(0.12, 0.5, 0.2, 0.02), [x * 1.05, 0, 0]))), motion: (rt) => ({ pos: [0, 2.2 - 0.62 * (rt.phase.ram ?? 0), 0] }),
        telemetry: (rt) => ({ stroke: fmt((rt.phase.ram ?? 0) * 620, "mm", 0) }) }),
      g({ id: "PRS.dieSprings", name: "Die springs ISO 10243 (red = heavy load, ×4)", category: "mechanical", mat: "paintRed", pos: [0, 0.98, 0], explodeVector: [0, 0.5, 0.8], explodeOrder: 3,
        geo: comp(...[-0.5, 0.5].flatMap((x) => [-0.35, 0.35].map((z) => at({ kind: "helix", r: 0.045, pitch: 0.028, turns: 9, wire: 0.009 }, [x, 0, z])))), material: "Spring steel 51CrV4, rectangular wire",
        tolerance: "preload 10 % of free length", description: "Return the upper die and strip the part after each stroke; colour coding by load (ISO 10243).",
        maintenanceNotes: "Replace as a set after 1 million strokes or if the free length drops by more than 2 %.", motion: (rt) => ({ pos: [0, 0.98 - 0.02 * (rt.phase.ram ?? 0), 0] }) }),
      g({ id: "PRS.rod", name: "Chrome piston rod", category: "mechanical", mat: "chrome", parent: "PRS.ram", pos: [0, 0.6, 0], explodeVector: [0, 0.4, 0], explodeOrder: 1, geo: cy(0.09, 0.9), tolerance: "Ø90 f7, Ra 0.2" }),
      g({ id: "PRS.psens", name: "Pressure transducer", category: "sensor", mat: "steel", pos: [0.35, 3.62, 0.2], explodeVector: [0.5, 0.3, 0.5], explodeOrder: 0,
        geo: comp(at(cy(0.025, 0.1)), at(cy(0.018, 0.06), [0, 0.08, 0]), at(hose([[0, 0.1, 0], [0.1, 0.25, 0.1], [0.4, 0.3, 0.4]], 0.006))),
        telemetry: (rt) => ({ reading: fmt((rt.act.pressure ?? 0) + (rt.phase.drift ?? 0), "bar"), "true (reference)": fmt(rt.act.pressure ?? 0, "bar") }) }),
      g({ id: "PRS.hpu", name: "Hydraulic power unit", category: "mechanical", mat: "paintBlue", pos: [1.75, 0, -1.25], explodeVector: [0.8, 0, -0.6], explodeOrder: 1,
        geo: comp(at(rb(1.0, 0.55, 0.7, 0.04), [0, 0.28, 0]), at(motorS(0.13, 0.4), [0, 0.8, 0]), at(cy(0.05, 0.14), [0.32, 0.62, 0.22]),
          at(hose([[-0.35, 0.6, 0.2], [-0.9, 1.4, 0.6], [-1.5, 3.2, 1.0], [-1.5, 3.4, 1.25]], 0.025)), at(hose([[-0.35, 0.5, -0.1], [-0.95, 1.6, 0.4], [-1.5, 2.8, 1.0], [-1.5, 3.0, 1.25]], 0.025))) }),
      g({ id: "PRS.oilglass", name: "Tank sight glass", category: "sensor", mat: "oil", parent: "PRS.hpu", pos: [0.51, 0.28, 0], rot: [0, 0, PI / 2], explodeVector: [0.3, 0, 0], explodeOrder: 0, geo: cy(0.04, 0.02) }),
    ] },
    { id: "PRS.gearbox", name: "Motor & 2-stage helical gearbox", parts: [
      g({ id: "PRS.motor", name: "AC induction motor 30 kW", category: "electrical", mat: "paintBlue", pos: [GX - 1.05, GY, zIn], rot: [0, 0, PI / 2], explodeVector: [-1.0, 0, 0], explodeOrder: 1, assemblyAxis: "X",
        geo: comp(at(motorS(0.2, 0.62)), at(rb(0.36, 0.08, 0.36, 0.02), [0.22, 0, 0])), description: "IE4 asynchronous motor, 1480 rpm, inverter driven, radial cooling fins.",
        telemetry: (rt) => ({ speed: fmt(rt.act.rpm ?? 0, "rpm", 0), current: fmt((rt.act.force ?? 0) * 0.25 + heat(rt) * 10, "A"), "winding temp": fmt((rt.act.temp ?? 40) + heat(rt) * 45, "°C") }) }),
      g({ id: "PRS.coupling", name: "Jaw coupling (elastomer spider)", category: "mechanical", mat: "steel", pos: [GX - 0.62, GY, zIn], explodeVector: [-0.6, 0.2, 0], explodeOrder: 1, assemblyAxis: "X",
        geo: comp(at(cy(0.11, 0.08), [-0.05, 0, 0], X), at(cy(0.11, 0.08), [0.05, 0, 0], X), at({ kind: "torus", R: 0.08, r: 0.02 }, [0, 0, 0], [0, PI / 2, 0])),
        motion: (rt) => ({ rot: [motor(rt), 0, 0] }), description: "Flexible jaw coupling, absorbs misalignment and shocks." }),
      g({ id: "PRS.hLow", name: "Gearbox housing (lower, ribbed)", category: "structural", mat: "castIron", pos: [GX, GY - 0.24, (zIn + zOut) / 2], explodeVector: [0, -0.5, 0], explodeOrder: 4, housing: true, material: "Cast iron EN-GJL-250",
        geo: comp(at(ribbedBox(0.7, 0.32, zOut - zIn + 0.6, 4)), ...[-1, 1].flatMap((x) => [-1, 1].map((z) => at(rb(0.16, 0.05, 0.16, 0.01), [x * 0.36, -0.16, z * ((zOut - zIn) / 2 + 0.2)])))) }),
      g({ id: "PRS.hUp", name: "Gearbox cover (upper)", category: "structural", mat: "castIron", pos: [GX, GY + 0.2, (zIn + zOut) / 2], explodeVector: [0, 1.2, 0], explodeOrder: 0, housing: true, material: "Cast iron EN-GJL-250",
        geo: comp(at(ribbedBox(0.7, 0.26, zOut - zIn + 0.6, 4)), at(bolts(0.25, 8, 0.016), [0, 0.13, 0])), maintenanceNotes: "Replace the gasket and torque the bolts to 45 Nm when reassembling." }),
      g({ id: "PRS.inspect", name: "Inspection cover & breather", category: "structural", mat: "steel", parent: "PRS.hUp", pos: [0, 0.14, 0], explodeVector: [0, 0.5, 0], explodeOrder: 0,
        geo: comp(at(rb(0.36, 0.02, 0.36, 0.01)), at(bolts(0.15, 6, 0.012), [0, 0.01, 0]), at(lathe([[0, 0], [0.03, 0], [0.03, 0.04], [0.04, 0.05], [0, 0.07]]), [0.12, 0.01, 0.12])) }),
      g({ id: "PRS.sight", name: "Oil sight glass", category: "sensor", mat: "oil", parent: "PRS.hLow", pos: [0.36, 0, 0], rot: [0, 0, PI / 2], explodeVector: [0.3, 0, 0], explodeOrder: 0, geo: comp(at(cy(0.04, 0.025)), at({ kind: "torus", R: 0.04, r: 0.008 }, [0, 0.012, 0])) }),
      g({ id: "PRS.shaftIn", name: "Input pinion shaft", category: "mechanical", mat: "chrome", pos: [GX, GY, zIn], explodeVector: [0, 0.55, -0.35], explodeOrder: 2, assemblyAxis: "X",
        geo: comp(at(lathe([[0, -0.45], [0.03, -0.45], [0.03, -0.2], [0.04, -0.18], [0.04, 0.3], [0.03, 0.32], [0.03, 0.45], [0, 0.45]]), [0, 0, 0], X)), motion: (rt) => ({ rot: [motor(rt), 0, 0] }), tolerance: "Ø40 k6" }),
      g({ id: "PRS.gIn", name: `Helical input pinion (z=${Z_IN}, m=12)`, category: "mechanical", mat: "steel", pos: [GX, GY, zIn], rot: [0, PI / 2, 0], explodeVector: [0, 0.8, -0.4], explodeOrder: 3, assemblyAxis: "X",
        geo: { kind: "gear", m: MOD, z: Z_IN, w: 0.12, helix: 18, bore: 0.3 }, motion: (rt) => ({ rot: [0, PI / 2, motor(rt)] }), material: "Case-hardened 18CrNiMo7-6",
        tolerance: "DIN 3962 quality 6", telemetry: (rt) => ({ speed: fmt(rt.act.rpm ?? 0, "rpm", 0) }) }),
      g({ id: "PRS.gMid", name: `Helical intermediate gear (z=${Z_MID})`, category: "mechanical", mat: "steel", pos: [GX, GY, zMid], rot: [0, PI / 2, 0], explodeVector: [0, 1.0, 0], explodeOrder: 3, assemblyAxis: "X",
        geo: { kind: "gear", m: MOD, z: Z_MID, w: 0.12, helix: -18, bore: 0.2 }, motion: (rt) => ({ rot: [0, PI / 2, -motor(rt) * Z_IN / Z_MID + PI / Z_MID] }), material: "Case-hardened 18CrNiMo7-6",
        tolerance: "DIN 3962 quality 6", telemetry: (rt) => ({ speed: fmt((rt.act.rpm ?? 0) * Z_IN / Z_MID, "rpm", 0), "mesh vibration": fmt(1.1 + (rt.phase.wear ?? 0) * 2.2, "mm/s") }) }),
      g({ id: "PRS.gOut", name: `Helical output gear (z=${Z_OUT})`, category: "mechanical", mat: "steel", pos: [GX, GY, zOut], rot: [0, PI / 2, 0], explodeVector: [0, 1.2, 0.4], explodeOrder: 3, assemblyAxis: "X",
        geo: { kind: "gear", m: MOD, z: Z_OUT, w: 0.12, helix: 18, bore: 0.18 }, motion: (rt) => ({ rot: [0, PI / 2, motor(rt) * Z_IN / Z_OUT] }),
        telemetry: (rt) => ({ speed: fmt((rt.act.rpm ?? 0) * Z_IN / Z_OUT, "rpm", 0), torque: fmt((rt.act.force ?? 0) * 0.6, "kNm") }) }),
      g({ id: "PRS.shaftOut", name: "Output shaft", category: "mechanical", mat: "chrome", pos: [GX, GY, zOut], explodeVector: [0, 0.7, 0.6], explodeOrder: 2, assemblyAxis: "X",
        geo: lathe([[0, -0.4], [0.05, -0.4], [0.05, 0.4], [0, 0.4]]), rot: X, motion: (rt) => ({ rot: [motor(rt) * Z_IN / Z_OUT, 0, -PI / 2] }), tolerance: "Ø100 m6" }),
      g({ id: "PRS.brgIn", name: "Input tapered roller bearing (30208)", category: "mechanical", mat: "steel", pos: [GX + 0.28, GY, zIn], rot: X, explodeVector: [0.7, 0.6, -0.4], explodeOrder: 4, assemblyAxis: "X",
        geo: { kind: "bearing", ri: 0.04, ro: 0.08, w: 0.05, n: 15, taper: true }, tolerance: "inner ring k5 / housing H7",
        description: "Tapered roller bearing supporting the input shaft (radial + axial load from the helical pinion).",
        maintenanceNotes: "Temp > 80 °C or rising vibration = lubrication issue or wear; replace with the housing cover removed (LOTO).",
        telemetry: (rt) => ({ temperature: fmt(45 + (rt.act.temp ?? 40) * 0.3 + heat(rt) * 45, "°C"), vibration: fmt(1.2 + heat(rt) * 4, "mm/s"), "lube": heat(rt) ? "degraded" : "OK" }) }),
      g({ id: "PRS.brgIn2", name: "Input bearing (drive side, 30208)", category: "mechanical", mat: "steel", pos: [GX - 0.28, GY, zIn], rot: X, explodeVector: [-0.5, 0.6, -0.4], explodeOrder: 4, assemblyAxis: "X",
        geo: { kind: "bearing", ri: 0.04, ro: 0.08, w: 0.05, n: 15, taper: true } }),
      g({ id: "PRS.brgMid", name: "Intermediate shaft bearing (32210)", category: "mechanical", mat: "steel", pos: [GX + 0.28, GY, zMid], rot: X, explodeVector: [0.7, 0.8, 0], explodeOrder: 4, assemblyAxis: "X",
        geo: { kind: "bearing", ri: 0.05, ro: 0.09, w: 0.06, n: 16, taper: true } }),
      g({ id: "PRS.brgOut", name: "Output tapered roller bearing (32220)", category: "mechanical", mat: "steel", pos: [GX + 0.28, GY, zOut], rot: X, explodeVector: [0.7, 0.8, 0.5], explodeOrder: 4, assemblyAxis: "X",
        geo: { kind: "bearing", ri: 0.055, ro: 0.11, w: 0.07, n: 18, taper: true }, telemetry: (rt) => ({ temperature: fmt(42 + (rt.act.temp ?? 40) * 0.25, "°C") }) }),
      g({ id: "PRS.seal", name: "Output shaft oil seal", category: "mechanical", mat: "rubber", pos: [GX - 0.3, GY, zOut], rot: [0, 0, PI / 2], explodeVector: [-0.6, 0.6, 0.5], explodeOrder: 1, assemblyAxis: "X",
        geo: { kind: "torus", R: 0.065, r: 0.015 }, material: "FKM radial shaft seal" }),
    ] },
  ],
};

// ------------------------------------------------------------------ conveyors (5 segments between stations)
const k = partFactory("CNV");
const SEG_X = [LINE_X0, ST.vision - 1.1, ST.vision + 1.1, ST.cnc - 1.65, ST.cnc + 1.65, ST.press - 1.25, ST.press + 1.25, ST.welding - 1.3, ST.welding + 1.3, ST.lineEnd];
export const SEGMENTS = [0, 1, 2, 3, 4].map((i) => ({ n: i + 1, x0: SEG_X[i * 2], x1: SEG_X[i * 2 + 1] }));
export const conveyors: MachineDef = {
  id: "CNV", type: "dispenser", name: "Main line conveyors (5 drives)", zone: "machining", backendId: "M6", position: [0, 0, 0], size: [46, 1.2, 1.2],
  description: "Five belt conveyor sections on T-slot aluminium frames, each with its own drum motor, worm reducer and belt-tension sensor, chaining the stations at 0.9 m working height.",
  controls: CONVEYOR_CONTROLS, defaults: { speed: 0.6, current: 6.5, load: 120, voltage: 400 },
  faults: SEGMENTS.flatMap((s) => [
    { code: `CNV${s.n}-TENS`, partId: `CNV.s${s.n}.tension`, label: `Conveyor #${s.n} – belt tension sensor fault`, severity: "warning" as const, backendCodes: s.n === 3 ? ["SENSOR_DRIFT", "SENSOR_STUCK", "BELT_SLIP"] : [] },
    { code: `CNV${s.n}-DRIVE`, partId: `CNV.s${s.n}.motor`, label: `Conveyor #${s.n} – drive motor overcurrent`, severity: "critical" as const, backendCodes: s.n === 2 ? ["CONVEYOR_JAM", "MOTOR_OVERCURRENT"] : [] },
  ]),
  subAssemblies: SEGMENTS.map((s) => {
    const L = s.x1 - s.x0, cx = (s.x0 + s.x1) / 2;
    const legs: V3[] = [];
    for (let x = s.x0 + 0.1; x <= s.x1 - 0.05; x += Math.max(1.2, L / Math.ceil(L / 1.6))) legs.push([x, 0, 0]);
    return { id: `CNV.s${s.n}`, name: `Conveyor #${s.n}`, parts: [
      k({ id: `CNV.s${s.n}.frame`, name: `Conveyor #${s.n} T-slot frame`, category: "structural", mat: "brushedAlu", pos: [cx, 0, 0], explodeVector: [0, -0.5, 0], explodeOrder: 2, material: "Aluminium profile 45 × 90",
        geo: comp(...[-0.47, 0.47].map((z) => at({ kind: "tslot", len: L, s: 0.06 }, [0, BELT_Y - 0.1, z])),
          ...legs.flatMap(([x]) => [-0.42, 0.42].map((z) => at({ kind: "tslot", len: BELT_Y - 0.16, s: 0.045 }, [x - cx, (BELT_Y - 0.16) / 2, z], [0, 0, PI / 2]))),
          ...legs.map(([x]) => at({ kind: "tslot", len: 0.84, s: 0.045 }, [x - cx, 0.2, 0], [0, PI / 2, 0])),
          ...legs.flatMap(([x]) => [-0.42, 0.42].map((z) => at(cy(0.035, 0.025), [x - cx, 0.012, z])))) }),
      k({ id: `CNV.s${s.n}.rails`, name: `Conveyor #${s.n} side guide rails`, category: "mechanical", mat: "steel", pos: [cx, BELT_Y + 0.14, 0], explodeVector: [0, 0.4, 0], explodeOrder: 1,
        geo: comp(...[-0.44, 0.44].flatMap((z) => [at(rb(L - 0.1, 0.06, 0.02, 0.008), [0, 0, z]), ...Array.from({ length: Math.ceil(L / 1.5) }, (_, i) => at(cy(0.008, 0.18), [-L / 2 + 0.3 + i * 1.5, -0.1, z]))])) }),
      k({ id: `CNV.s${s.n}.belt`, name: `Conveyor #${s.n} belt`, category: "mechanical", mat: "belt", pos: [cx, BELT_Y - 0.025, 0], explodeVector: [0, 0.7, 0], explodeOrder: 0, material: "PVC 2-ply belt, chevron top",
        geo: rb(L - 0.1, 0.03, 0.82, 0.012), telemetry: (rt) => ({ speed: fmt(rt.act.speed ?? 0, "m/s", 2), tension: fmt(1.8 + (rt.phase[`slip${s.n}`] ?? 0), "kN") }) }),
      k({ id: `CNV.s${s.n}.drum`, name: `Conveyor #${s.n} drive drum`, category: "mechanical", mat: "rubber", pos: [s.x1 - 0.1, BELT_Y - 0.08, 0], rot: Z, explodeVector: [0.3, 0.2, 0], explodeOrder: 1, geo: cy(0.06, 0.84),
        motion: (rt) => ({ rot: [PI / 2, (rt.phase.belt ?? 0) / 0.06, 0] }) }),
      k({ id: `CNV.s${s.n}.motor`, name: `Conveyor #${s.n} drive motor 0.55 kW`, category: "electrical", mat: "paintBlue", pos: [s.x1 - 0.25, BELT_Y - 0.3, 0.7], rot: Z, explodeVector: [0, 0, 0.8], explodeOrder: 1, assemblyAxis: "Z",
        geo: motorS(0.09, 0.3), description: "0.55 kW geared motor with frequency inverter.", telemetry: (rt) => ({ current: fmt((rt.act.current ?? 0) + (rt.phase.heat ?? 0) * 8, "A"), speed: fmt((rt.act.speed ?? 0) * 1450 / 0.6, "rpm", 0) }) }),
      k({ id: `CNV.s${s.n}.gear`, name: `Conveyor #${s.n} worm gear reducer`, category: "mechanical", mat: "castIron", pos: [s.x1 - 0.25, BELT_Y - 0.3, 0.45], explodeVector: [0, -0.2, 0.55], explodeOrder: 1, assemblyAxis: "Z",
        geo: comp(at(rb(0.22, 0.24, 0.2, 0.04)), at(cy(0.05, 0.12), [0, 0.13, 0]), ...[-0.08, 0.08].map((x) => at(rb(0.025, 0.2, 0.22, 0.005), [x, 0, 0]))) }),
      k({ id: `CNV.s${s.n}.tension`, name: `Conveyor #${s.n} belt tension sensor`, category: "sensor", mat: "steel", pos: [s.x0 + 0.25, BELT_Y - 0.16, -0.55], explodeVector: [0, 0.3, -0.6], explodeOrder: 0, assemblyAxis: "Z",
        geo: comp(at(rb(0.08, 0.1, 0.1, 0.01)), at(cy(0.015, 0.08), [0, 0.09, 0]), at(hose([[0, -0.04, -0.05], [0, -0.2, -0.15], [0.3, -0.5, -0.15]], 0.006))),
        description: "Load-cell tension sensor on the take-up pulley.", telemetry: (rt) => ({ tension: fmt(1.8 + (rt.phase[`slip${s.n}`] ?? 0), "kN"), signal: "4-20 mA" }) }),
      k({ id: `CNV.s${s.n}.guard`, name: `Conveyor #${s.n} drive guard`, category: "structural", mat: "safetyYellow", pos: [s.x1 - 0.25, BELT_Y - 0.3, 0.58], explodeVector: [0, 0.3, 1.0], explodeOrder: 2, housing: true,
        geo: comp(at(rb(0.42, 0.36, 0.02, 0.02), [0, 0, 0.24]), at(rb(0.42, 0.02, 0.5, 0.01), [0, 0.18, 0]), at(rb(0.42, 0.02, 0.5, 0.01), [0, -0.18, 0])), description: "Guard over the motor-reducer coupling (EN ISO 14120)." }),
      k({ id: `CNV.s${s.n}.pe`, name: `Conveyor #${s.n} photo-eye`, category: "sensor", mat: "plasticBlack", pos: [s.x1 - 0.5, BELT_Y + 0.2, -0.47], explodeVector: [0, 0.3, -0.3], explodeOrder: 0,
        geo: comp(at(rb(0.04, 0.06, 0.08, 0.006)), at(cy(0.003, 0.92), [0, 0, 0.46], Z)) }),
    ] };
  }),
};

