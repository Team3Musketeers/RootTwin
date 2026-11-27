// AGV / AMR fleet and the main-line PLC / electrical cabinet bank.
import { fmt, partFactory } from "../build";
import { PLC_POS } from "../layout";
import type { MachineDef, MachineRuntime } from "../types";

// ------------------------------------------------------------------ 2. AGV / AMR (3 identical vehicles)
export function agv(n: number): MachineDef {
  const a = partFactory(`AGV${n}`);
  const id = `AGV${n}`;
  const wheel = (rt: MachineRuntime) => rt.phase.wheel ?? 0;
  return {
    id, type: "agv", name: `AMR #${n} (latent lifting)`, zone: "logistics", position: [0, 0, 0], size: [1.4, 1.2, 1.0],
    description: "Autonomous mobile robot: natural-navigation LiDAR, differential drive, lifts carriers and pallets from underneath.",
    controls: [
      { key: "speed", label: "Target speed", unit: "m/s", min: 0, max: 2, step: 0.05 },
      { key: "current", label: "Motor current", unit: "A", min: 0, max: 40, step: 0.1 },
      { key: "load", label: "Load weight", unit: "kg", min: 0, max: 1000, step: 5 },
      { key: "voltage", label: "Battery voltage", unit: "V", min: 40, max: 56, step: 0.1 },
    ],
    defaults: { speed: 1.2, current: 8, load: 0, voltage: 51.2 },
    faults: [
      { code: `${id}-LIDAR`, partId: `${id}.lidar`, label: `AGV #${n} – LiDAR fault`, severity: "critical" },
      { code: `${id}-DRIVE`, partId: `${id}.motorL`, label: `AGV #${n} – drive motor fault`, severity: "critical" },
      { code: `${id}-BATT`, partId: `${id}.battery`, label: `AGV #${n} – battery low`, severity: "warning" },
    ],
    subAssemblies: [
      { id: `${id}.body`, name: "Chassis & lift", parts: [
        a({ id: `${id}.chassis`, name: "Chassis", category: "structural", geo: { kind: "box", args: [1.3, 0.28, 0.9] }, pos: [0, 0.24, 0], color: "#e5e7eb", metalness: 0.3, explodeVector: [0, 0, 0], explodeOrder: 4 }),
        a({ id: `${id}.deck`, name: "Lifting deck", category: "actuator", geo: { kind: "box", args: [1.1, 0.06, 0.8] }, pos: [0, 0.41, 0], color: "#1f2937", explodeVector: [0, 0.8, 0], explodeOrder: 0,
          motion: (rt) => ({ pos: [0, 0.41 + 0.08 * (rt.phase.lift ?? 0), 0] }), telemetry: (rt) => ({ height: fmt(80 * (rt.phase.lift ?? 0), "mm", 0), load: fmt(rt.act.load ?? 0, "kg", 0) }) }),
        a({ id: `${id}.bumper`, name: "Safety bumper strip", category: "sensor", geo: { kind: "box", args: [0.06, 0.12, 0.92] }, pos: [0.68, 0.18, 0], color: "#111827", explodeVector: [0.5, 0, 0], explodeOrder: 0, assemblyAxis: "X" }),
        a({ id: `${id}.light`, name: "Status light strip", category: "electrical", geo: { kind: "box", args: [1.32, 0.03, 0.92] }, pos: [0, 0.37, 0], color: "#22d3ee", metalness: 0, roughness: 0.3, explodeVector: [0, 0.5, 0], explodeOrder: 0 }),
      ] },
      { id: `${id}.nav`, name: "Navigation & control", parts: [
        a({ id: `${id}.lidar`, name: "Safety LiDAR (270°)", category: "sensor", geo: { kind: "cyl", args: [0.07, 0.07, 0.1] }, pos: [0.58, 0.2, 0.38], color: "#facc15", explodeVector: [0.5, 0.4, 0.4], explodeOrder: 0,
          description: "SIL2 safety laser scanner used for navigation and personnel protection.", telemetry: () => ({ "scan rate": "25 Hz", "nearest obstacle": "1.9 m" }) }),
        a({ id: `${id}.ctrl`, name: "Navigation controller", category: "electrical", geo: { kind: "box", args: [0.35, 0.1, 0.3] }, pos: [-0.3, 0.28, 0], color: "#0f172a", explodeVector: [0, 0.55, -0.3], explodeOrder: 1,
          telemetry: () => ({ localisation: "98 %", "Wi-Fi": "-54 dBm" }) }),
        a({ id: `${id}.battery`, name: "LiFePO4 battery pack 48 V", category: "electrical", geo: { kind: "box", args: [0.5, 0.16, 0.5] }, pos: [0.15, 0.2, 0], color: "#16a34a", explodeVector: [0, 0.4, 0.7], explodeOrder: 1,
          maintenanceNotes: "Charge at 20 % SoC; check cell balance monthly.", telemetry: (rt) => ({ voltage: fmt(rt.act.voltage ?? 51, "V"), "state of charge": fmt(Math.max(5, ((rt.act.voltage ?? 51) - 44) / 0.1), "%", 0) }) }),
      ] },
      { id: `${id}.drive`, name: "Differential drive", parts: [
        ...([["L", 0.47], ["R", -0.47]] as const).flatMap(([s, z]) => [
          a({ id: `${id}.wheel${s}`, name: `Drive wheel (${s})`, category: "mechanical", geo: { kind: "cyl", args: [0.12, 0.12, 0.08] }, pos: [0, 0.12, z], rot: [Math.PI / 2, 0, 0], color: "#111827", metalness: 0.1, roughness: 0.8,
            explodeVector: [0, -0.2, z * 1.4], explodeOrder: 2, assemblyAxis: "Z", material: "Polyurethane tread", motion: (rt) => ({ rot: [Math.PI / 2, wheel(rt), 0] }) }),
          a({ id: `${id}.motor${s}`, name: `Hub drive motor (${s})`, category: "electrical", geo: { kind: "cyl", args: [0.07, 0.07, 0.16] }, pos: [0, 0.12, z * 0.7], rot: [Math.PI / 2, 0, 0], color: "#1e3a8a", explodeVector: [0, -0.3, z * 0.9], explodeOrder: 3, assemblyAxis: "Z",
            telemetry: (rt) => ({ current: fmt(rt.act.current ?? 0, "A"), speed: fmt((rt.act.speed ?? 0) / 0.12 * 9.55, "rpm", 0) }) }),
        ]),
        a({ id: `${id}.casterF`, name: "Caster (front)", category: "mechanical", geo: { kind: "sphere", args: [0.06] }, pos: [0.5, 0.06, 0], color: "#475569", explodeVector: [0.3, -0.3, 0], explodeOrder: 2 }),
        a({ id: `${id}.casterB`, name: "Caster (rear)", category: "mechanical", geo: { kind: "sphere", args: [0.06] }, pos: [-0.5, 0.06, 0], color: "#475569", explodeVector: [-0.3, -0.3, 0], explodeOrder: 2 }),
      ] },
    ],
  };
}

// ------------------------------------------------------------------ 8. main-line PLC & electrical cabinet bank
const e = partFactory("PLC");
const fan = (rt: MachineRuntime) => rt.phase.fan ?? 0;
export const plc: MachineDef = {
  id: "PLC", type: "plc", name: "Main line PLC & electrical cabinets", zone: "control", position: PLC_POS, size: [4.4, 2.4, 0.8],
  description: "Four Rittal-style cabinets: incomer & breakers, safety PLC rack and I/O, drives (inverters) for the line motors, 24 V supplies and cooling.",
  controls: [
    { key: "temp", label: "Cabinet temperature", unit: "°C", min: 10, max: 70, step: 0.5 },
    { key: "voltage", label: "DC bus voltage", unit: "V", min: 0, max: 700, step: 1 },
  ],
  defaults: { temp: 31, voltage: 565 },
  faults: [
    { code: "PLC-FAN", partId: "PLC.fan2", label: "Cabinet cooling fan failure", severity: "warning" },
    { code: "PLC-VFD", partId: "PLC.vfd1", label: "Drive inverter #1 overcurrent trip", severity: "critical" },
    { code: "PLC-IO", partId: "PLC.io2", label: "PLC I/O module #2 fault", severity: "critical" },
    { code: "PLC-PSU", partId: "PLC.psu", label: "24 V supply undervoltage", severity: "critical" },
  ],
  subAssemblies: [
    { id: "PLC.enc", name: "Enclosures", parts: [0, 1, 2, 3].flatMap((i) => [
      e({ id: `PLC.cab${i}`, name: `Cabinet ${i + 1} enclosure`, category: "structural", geo: { kind: "box", args: [1.05, 2.1, 0.06] }, pos: [-1.6 + i * 1.07, 1.15, -0.3], color: "#cbd5e1", metalness: 0.3, explodeVector: [0, 0, -0.6], explodeOrder: 3 }),
      e({ id: `PLC.door${i}`, name: `Cabinet ${i + 1} door`, category: "structural", geo: { kind: "box", args: [1.0, 2.0, 0.04] }, pos: [-1.6 + i * 1.07, 1.15, 0.32], color: "#e2e8f0", metalness: 0.3, explodeVector: [0, 0, 1.4], explodeOrder: 0, assemblyAxis: "Z" }),
    ]) },
    { id: "PLC.power", name: "Power distribution", parts: [
      e({ id: "PLC.main", name: "Main incomer breaker 400 A", category: "electrical", geo: { kind: "box", args: [0.3, 0.45, 0.2] }, pos: [-1.6, 1.6, 0], color: "#1f2937", explodeVector: [0, 0, 0.8], explodeOrder: 1 }),
      e({ id: "PLC.mcb", name: "Miniature circuit breakers (×12)", category: "electrical", geo: { kind: "box", args: [0.8, 0.12, 0.12] }, pos: [-1.6, 1.0, 0], color: "#f8fafc", explodeVector: [0, 0, 0.8], explodeOrder: 1 }),
      e({ id: "PLC.psu", name: "24 V DC power supply 40 A", category: "electrical", geo: { kind: "box", args: [0.25, 0.2, 0.15] }, pos: [-1.6, 0.6, 0], color: "#2563eb", explodeVector: [0, 0, 0.8], explodeOrder: 1,
        telemetry: (rt) => ({ output: fmt(24.1 - (rt.phase.sag ?? 0) * 4, "V", 2), load: "62 %" }) }),
    ] },
    { id: "PLC.ctrl", name: "PLC rack", parts: [
      e({ id: "PLC.rack", name: "PLC backplane / rail", category: "structural", geo: { kind: "box", args: [0.9, 0.3, 0.05] }, pos: [-0.53, 1.6, -0.15], color: "#475569", explodeVector: [0, 0, 0.5], explodeOrder: 2 }),
      e({ id: "PLC.cpu", name: "Safety PLC CPU", category: "electrical", geo: { kind: "box", args: [0.15, 0.28, 0.18] }, pos: [-0.85, 1.6, 0], color: "#0f766e", explodeVector: [0, 0, 1.0], explodeOrder: 1,
        telemetry: () => ({ "scan time": "4.2 ms", mode: "RUN", "PROFINET devices": "37/37" }) }),
      ...[0, 1, 2, 3].map((i) => e({ id: `PLC.io${i + 1}`, name: `I/O module #${i + 1}`, category: "electrical", geo: { kind: "box", args: [0.1, 0.26, 0.16] }, pos: [-0.65 + i * 0.13, 1.6, 0], color: "#334155", explodeVector: [0, 0, 1.0 + i * 0.1], explodeOrder: 1,
        telemetry: () => ({ channels: "16 DI / 16 DO", status: "OK" }) })),
      e({ id: "PLC.hmi", name: "Line HMI touch panel", category: "electrical", geo: { kind: "box", args: [0.5, 0.35, 0.06] }, pos: [-0.53, 1.4, 0.36], color: "#0f172a", explodeVector: [0, 0, 1.6], explodeOrder: 0 }),
    ] },
    { id: "PLC.drives", name: "Drives & cooling", parts: [
      e({ id: "PLC.vfd1", name: "Inverter #1 (press 30 kW)", category: "electrical", geo: { kind: "box", args: [0.35, 0.6, 0.25] }, pos: [0.54, 1.3, 0], color: "#1d4ed8", explodeVector: [0, 0, 1.0], explodeOrder: 1,
        telemetry: (rt) => ({ "DC bus": fmt(rt.act.voltage ?? 565, "V", 0), "output current": "41 A", "heatsink": fmt((rt.act.temp ?? 31) + 12, "°C") }) }),
      e({ id: "PLC.vfd2", name: "Inverter #2 (conveyors)", category: "electrical", geo: { kind: "box", args: [0.3, 0.5, 0.22] }, pos: [1.6, 1.3, 0], color: "#1d4ed8", explodeVector: [0, 0, 1.0], explodeOrder: 1 }),
      ...[1, 2].map((i) => e({ id: `PLC.fan${i}`, name: `Roof cooling fan #${i}`, category: "mechanical", geo: { kind: "cyl", args: [0.18, 0.18, 0.08] }, pos: [-0.2 + (i - 1) * 1.8, 2.25, 0], color: "#64748b", explodeVector: [0, 0.6, 0], explodeOrder: 0,
        motion: (rt) => ({ rot: [0, fan(rt) * (i === 2 && (rt.phase.fanFail ?? 0) > 0 ? 0 : 1), 0] }),
        telemetry: (rt) => ({ speed: (i === 2 && (rt.phase.fanFail ?? 0) > 0) ? "0 rpm" : "2 750 rpm", "cabinet temp": fmt(rt.act.temp ?? 31, "°C") }) })),
    ] },
  ],
};
