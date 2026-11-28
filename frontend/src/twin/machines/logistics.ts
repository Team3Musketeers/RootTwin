// AMR fleet and the main-line PLC / electrical cabinet bank (CAD-level parts).
import { at, bolts, comp, cy, fmt, hose, lathe, motorS, partFactory, rb, roundedRectOutline, Z, louvres } from "../build";
import { PLC_POS } from "../layout";
import type { MachineDef, MachineRuntime } from "../types";

const PI = Math.PI;

// ------------------------------------------------------------------ 2. AMR / AGV (3 identical vehicles)
export function agv(n: number): MachineDef {
  const a = partFactory(`AGV${n}`);
  const id = `AGV${n}`;
  const wheel = (rt: MachineRuntime) => rt.phase.wheel ?? 0;
  return {
    id, type: "agv", name: `AMR #${n} (latent lifting)`, zone: "logistics", position: [0, 0, 0], size: [1.4, 1.2, 1.0],
    description: "Autonomous mobile robot: natural-navigation safety LiDARs front/rear, differential drive, lifts carriers and Euro pallets from underneath.",
    controls: [
      { key: "speed", label: "Target speed", unit: "m/s", min: 0, max: 2, step: 0.05 },
      { key: "current", label: "Motor current", unit: "A", min: 0, max: 40, step: 0.1 },
      { key: "load", label: "Load weight", unit: "kg", min: 0, max: 1000, step: 5 },
      { key: "voltage", label: "Battery voltage", unit: "V", min: 40, max: 56, step: 0.1 },
    ],
    defaults: { speed: 1.2, current: 8, load: 0, voltage: 51.2 },
    faults: [
      { code: `${id}-LIDAR`, partId: `${id}.lidarF`, label: `AGV #${n} – LiDAR fault`, severity: "critical" },
      { code: `${id}-DRIVE`, partId: `${id}.motorL`, label: `AGV #${n} – drive motor fault`, severity: "critical" },
      { code: `${id}-BATT`, partId: `${id}.battery`, label: `AGV #${n} – battery low`, severity: "warning" },
    ],
    subAssemblies: [
      { id: `${id}.body`, name: "Chassis & lift", parts: [
        a({ id: `${id}.chassis`, name: "Chassis & body shell (MiR 250 class)", category: "structural", mat: "sheetGrey", pos: [0, 0.23, 0], rot: [PI / 2, 0, 0], explodeVector: [0, 0, 0], explodeOrder: 5, housing: true,
          geo: { kind: "extrude", outline: roundedRectOutline(1.04, 0.76, 0.1), depth: 0.3, bevel: 0.03 } }),
        a({ id: `${id}.skirt`, name: "Bumper skirt", category: "structural", mat: "graphite", pos: [0, 0.1, 0], rot: [PI / 2, 0, 0], explodeVector: [0, -0.25, 0], explodeOrder: 1, housing: true,
          geo: { kind: "extrude", outline: roundedRectOutline(1.08, 0.8, 0.12), depth: 0.07, bevel: 0.02 } }),
        a({ id: `${id}.deck`, name: "Lifting deck with rubber pads", category: "actuator", mat: "graphite", pos: [0, 0.39, 0], explodeVector: [0, 0.8, 0], explodeOrder: 0,
          geo: comp(at(cy(0.34, 0.04)), ...[[-0.2, -0.2], [-0.2, 0.2], [0.2, -0.2], [0.2, 0.2]].map(([x, z]) => at(rb(0.14, 0.02, 0.14, 0.008), [x, 0.03, z]))),
          motion: (rt) => ({ pos: [0, 0.39 + 0.08 * (rt.phase.lift ?? 0), 0] }), telemetry: (rt) => ({ height: fmt(80 * (rt.phase.lift ?? 0), "mm", 0), load: fmt(rt.act.load ?? 0, "kg", 0) }) }),
        a({ id: `${id}.liftAct`, name: "Lift actuator (ball screw jack)", category: "actuator", mat: "steel", pos: [0, 0.3, 0], explodeVector: [0, 0.45, 0], explodeOrder: 2, geo: comp(at(cy(0.08, 0.12)), at(cy(0.03, 0.1), [0, 0.08, 0])) }),
        a({ id: `${id}.led`, name: "LED status strip", category: "electrical", mat: "ledBlue", pos: [0, 0.2, 0], rot: [PI / 2, 0, 0], explodeVector: [0, 0.25, 0], explodeOrder: 0,
          geo: { kind: "extrude", outline: roundedRectOutline(1.06, 0.78, 0.1), depth: 0.02, bevel: 0 } }),
        a({ id: `${id}.estop`, name: "Emergency stop button", category: "sensor", mat: "paintRed", pos: [-0.42, 0.4, 0.28], explodeVector: [0, 0.4, 0], explodeOrder: 0,
          geo: comp(at(cy(0.04, 0.03, 0.045), [0, 0, 0]), at(lathe([[0, 0], [0.035, 0], [0.04, 0.02], [0.03, 0.035], [0, 0.04]]), [0, 0.015, 0])) }),
        a({ id: `${id}.display`, name: "Status display", category: "electrical", mat: "screen", pos: [-0.535, 0.26, 0], rot: [0, -PI / 2, 0], explodeVector: [-0.3, 0, 0], explodeOrder: 0, geo: rb(0.22, 0.1, 0.01, 0.004) }),
      ] },
      { id: `${id}.nav`, name: "Navigation & energy", parts: [
        a({ id: `${id}.lidarF`, name: "Safety LiDAR (front, 270°)", category: "sensor", mat: "safetyYellow", pos: [0.41, 0.25, 0.27], rot: [0, PI / 4, 0], explodeVector: [0.5, 0.4, 0.4], explodeOrder: 0,
          geo: comp(at(rb(0.12, 0.08, 0.12, 0.02), [0, -0.03, 0]), at(lathe([[0.055, 0], [0.06, 0], [0.06, 0.08], [0.05, 0.09], [0, 0.09]]), [0, 0.01, 0])),
          description: "SIL2 safety laser scanner used for navigation and personnel protection.", telemetry: (rt) => ({ "scan rate": "25 Hz", "nearest obstacle": (rt.phase.heat ?? 0) ? "no data" : "1.9 m" }) }),
        a({ id: `${id}.lidarWin`, name: "LiDAR optical window", category: "sensor", mat: "smokedGlass", parent: `${id}.lidarF`, pos: [0, 0.05, 0], explodeVector: [0, 0.2, 0], explodeOrder: 0, geo: cy(0.062, 0.05) }),
        a({ id: `${id}.lidarR`, name: "Safety LiDAR (rear)", category: "sensor", mat: "safetyYellow", pos: [-0.41, 0.25, -0.27], rot: [0, -3 * PI / 4, 0], explodeVector: [-0.5, 0.4, -0.4], explodeOrder: 0,
          geo: comp(at(rb(0.12, 0.08, 0.12, 0.02), [0, -0.03, 0]), at(lathe([[0.055, 0], [0.06, 0], [0.06, 0.08], [0.05, 0.09], [0, 0.09]]), [0, 0.01, 0])) }),
        a({ id: `${id}.ctrl`, name: "Navigation controller", category: "electrical", mat: "anodized", pos: [-0.3, 0.26, 0], explodeVector: [0, 0.6, -0.3], explodeOrder: 1,
          geo: comp(at(rb(0.3, 0.08, 0.26, 0.015)), ...Array.from({ length: 6 }, (_, i) => at(rb(0.3, 0.012, 0.01, 0.003), [0, 0.04, -0.1 + i * 0.04]))), telemetry: () => ({ localisation: "98 %", "Wi-Fi": "-54 dBm" }) }),
        a({ id: `${id}.battery`, name: "LiFePO4 battery pack 48 V", category: "electrical", mat: "paintGreen", pos: [0.2, 0.22, 0], explodeVector: [0, 0.45, 0.75], explodeOrder: 1,
          geo: comp(at(rb(0.46, 0.16, 0.46, 0.02)), at(cy(0.015, 0.03), [0.15, 0.09, 0.15]), at(cy(0.015, 0.03), [0.15, 0.09, -0.15])),
          maintenanceNotes: "Charge at 20 % SoC; check cell balance monthly.", telemetry: (rt) => ({ voltage: fmt(rt.act.voltage ?? 51, "V"), "state of charge": fmt(Math.max(5, ((rt.act.voltage ?? 51) - 44) / 0.1), "%", 0) }) }),
        a({ id: `${id}.contacts`, name: "Charging contacts", category: "electrical", mat: "copper", pos: [-0.53, 0.1, 0], explodeVector: [-0.3, 0, 0], explodeOrder: 0, geo: comp(at(rb(0.02, 0.04, 0.12, 0.005), [0, 0, -0.1]), at(rb(0.02, 0.04, 0.12, 0.005), [0, 0, 0.1])) }),
      ] },
      { id: `${id}.drive`, name: "Differential drive", parts: [
        ...([["L", 0.262], ["R", -0.262]] as const).flatMap(([s, z]) => [         // MiR 250 wheel track (x1.3)
          a({ id: `${id}.wheel${s}`, name: `Drive wheel (${s})`, category: "mechanical", mat: "rubber", pos: [0, 0.13, z], rot: Z, explodeVector: [0, -0.2, z * 1.4], explodeOrder: 3, assemblyAxis: "Z", material: "Polyurethane tread on aluminium rim",
            geo: comp(at(lathe([[0.06, -0.04], [0.11, -0.04], [0.12, -0.03], [0.12, 0.03], [0.11, 0.04], [0.06, 0.04]])), at(cy(0.065, 0.085)), at(bolts(0.04, 5, 0.008), [0, 0.045, 0])),
            motion: (rt) => ({ rot: [PI / 2, wheel(rt), 0] }) }),
          a({ id: `${id}.motor${s}`, name: `Hub drive motor (${s})`, category: "electrical", mat: "graphite", pos: [0, 0.13, z * 0.62], rot: Z, explodeVector: [0, -0.3, z * 0.9], explodeOrder: 4, assemblyAxis: "Z",
            geo: motorS(0.06, 0.14), telemetry: (rt) => ({ current: fmt((rt.act.current ?? 0) + (rt.phase.heat ?? 0) * 12, "A"), speed: fmt((rt.act.speed ?? 0) / 0.12 * 9.55, "rpm", 0) }) }),
        ]),
        ...([["F", 0.395], ["B", -0.385]] as const).map(([s, x]) => a({ id: `${id}.caster${s}`, name: `Swivel caster (${s === "F" ? "front" : "rear"})`, category: "mechanical", mat: "steel", pos: [x, 0.06, 0], explodeVector: [x * 0.6, -0.3, 0], explodeOrder: 2,
          geo: comp(at(cy(0.05, 0.04), [0, 0, 0], Z), at(rb(0.04, 0.08, 0.06, 0.01), [0, 0.06, 0]), at(cy(0.03, 0.02), [0, 0.1, 0])) })),
      ] },
    ],
  };
}

// ------------------------------------------------------------------ 8. main-line PLC & electrical cabinet bank
const e = partFactory("PLC");
const fan = (rt: MachineRuntime) => rt.phase.fan ?? 0;
const din = (len: number) => comp(at(rb(len, 0.035, 0.008, 0.002)), at(rb(len, 0.008, 0.02, 0.002), [0, 0.016, 0.008]), at(rb(len, 0.008, 0.02, 0.002), [0, -0.016, 0.008]));
export const plc: MachineDef = {
  id: "PLC", type: "plc", name: "Main line PLC & electrical cabinets", zone: "control", position: PLC_POS, size: [4.4, 2.4, 0.8],
  description: "Four Rittal-style cabinets: incomer & breakers, safety PLC rack and I/O, inverters for the line motors, 24 V supplies and roof fans.",
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
      e({ id: `PLC.cab${i}`, name: `Cabinet ${i + 1} enclosure & mounting plate`, category: "structural", mat: "cabinet", pos: [-1.6 + i * 1.07, 1.15, -0.05], explodeVector: [0, 0, -0.8], explodeOrder: 3, housing: true,
        geo: comp(at(rb(1.05, 2.1, 0.05, 0.01), [0, 0, -0.27]), at(rb(0.05, 2.1, 0.6, 0.01), [-0.5, 0, 0]), at(rb(0.05, 2.1, 0.6, 0.01), [0.5, 0, 0]), at(rb(1.05, 0.1, 0.62, 0.01), [0, -1.05, 0]), at(rb(0.9, 1.9, 0.01, 0.004), [0, 0, -0.22])) }),
      e({ id: `PLC.door${i}`, name: `Cabinet ${i + 1} door`, category: "structural", mat: "cabinet", pos: [-1.6 + i * 1.07, 1.15, 0.32], explodeVector: [0, 0, 1.5], explodeOrder: 0, assemblyAxis: "Z", housing: true,
        geo: comp(at(rb(1.0, 2.0, 0.03, 0.01)), at(rb(0.03, 0.22, 0.05, 0.01), [0.42, 0, 0.03]), at(louvres(0.4), [0, -0.75, 0.02]), at(rb(0.24, 0.06, 0.01, 0.003), [-0.25, 0.85, 0.02])) }),
    ]) },
    { id: "PLC.power", name: "Power distribution", parts: [
      e({ id: "PLC.main", name: "Main incomer breaker 400 A", category: "electrical", mat: "plasticBlack", pos: [-1.6, 1.6, 0], explodeVector: [0, 0, 0.9], explodeOrder: 1,
        geo: comp(at(rb(0.3, 0.45, 0.2, 0.02)), at(rb(0.06, 0.12, 0.06, 0.01), [0, 0.05, 0.12]), ...[-0.08, 0, 0.08].map((x) => at(cy(0.015, 0.06), [x, -0.25, 0.04]))) }),
      e({ id: "PLC.mcb", name: "Miniature circuit breakers (×12) on DIN rail", category: "electrical", mat: "sheetWhite", pos: [-1.6, 1.0, 0], explodeVector: [0, 0, 0.9], explodeOrder: 1,
        geo: comp(at(din(0.85), [0, 0, -0.06]), ...Array.from({ length: 12 }, (_, i) => at(rb(0.017, 0.09, 0.07, 0.003), [-0.4 + i * 0.07, 0, 0]))) }),
      e({ id: "PLC.psu", name: "24 V DC power supply 40 A", category: "electrical", mat: "brushedAlu", pos: [-1.6, 0.6, 0], explodeVector: [0, 0, 0.9], explodeOrder: 1,
        geo: comp(at(rb(0.25, 0.14, 0.13, 0.01)), ...Array.from({ length: 8 }, (_, i) => at(rb(0.004, 0.13, 0.12, 0.001), [-0.1 + i * 0.03, 0, 0]))),
        telemetry: (rt) => ({ output: fmt(24.1 - (rt.phase.sag ?? 0) * 4, "V", 2), load: "62 %" }) }),
    ] },
    { id: "PLC.ctrl", name: "PLC rack", parts: [
      e({ id: "PLC.rack", name: "PLC DIN rail & cable ducts", category: "structural", mat: "sheetGrey", pos: [-0.53, 1.6, -0.15], explodeVector: [0, 0, 0.5], explodeOrder: 2,
        geo: comp(at(din(0.9)), at(rb(0.9, 0.06, 0.08, 0.005), [0, 0.22, 0.03]), at(rb(0.9, 0.06, 0.08, 0.005), [0, -0.22, 0.03])) }),
      e({ id: "PLC.cpu", name: "Safety PLC CPU", category: "electrical", mat: "paintGreen", pos: [-0.85, 1.6, 0], explodeVector: [0, 0, 1.1], explodeOrder: 1,
        geo: comp(at(rb(0.14, 0.26, 0.17, 0.01)), at(rb(0.08, 0.04, 0.005, 0.002), [0, 0.08, 0.087])), telemetry: () => ({ "scan time": "4.2 ms", mode: "RUN", "PROFINET devices": "37/37" }) }),
      e({ id: "PLC.cpuLed", name: "CPU status LEDs", category: "electrical", mat: "ledGreen", parent: "PLC.cpu", pos: [0.03, 0.06, 0.088], explodeVector: [0, 0, 0.2], explodeOrder: 0, geo: comp(...[0, 1, 2].map((j) => at(cy(0.006, 0.004), [0, -j * 0.025, 0], Z))) }),
      ...[0, 1, 2, 3].map((i) => e({ id: `PLC.io${i + 1}`, name: `I/O module #${i + 1} (16 DI / 16 DO)`, category: "electrical", mat: "graphite", pos: [-0.65 + i * 0.13, 1.6, 0], explodeVector: [0, 0, 1.1 + i * 0.12], explodeOrder: 1,
        geo: comp(at(rb(0.1, 0.24, 0.15, 0.008)), ...Array.from({ length: 8 }, (_, j) => at(rb(0.06, 0.008, 0.005, 0.002), [0, -0.09 + j * 0.022, 0.077]))), telemetry: () => ({ channels: "16 DI / 16 DO", status: "OK" }) })),
      e({ id: "PLC.hmi", name: "Line HMI touch panel 15\"", category: "electrical", mat: "graphite", pos: [-0.53, 1.45, 0.37], explodeVector: [0, 0, 1.8], explodeOrder: 0, geo: rb(0.5, 0.36, 0.05, 0.02) }),
      e({ id: "PLC.hmiScreen", name: "HMI screen", category: "electrical", mat: "screen", parent: "PLC.hmi", pos: [0, 0, 0.027], explodeVector: [0, 0, 0.2], explodeOrder: 0, geo: rb(0.44, 0.29, 0.004, 0.002) }),
    ] },
    { id: "PLC.drives", name: "Drives & cooling", parts: [
      e({ id: "PLC.vfd1", name: "Inverter #1 (press 30 kW)", category: "electrical", mat: "paintBlue", pos: [0.54, 1.3, 0], explodeVector: [0, 0, 1.1], explodeOrder: 1,
        geo: comp(at(rb(0.34, 0.6, 0.18, 0.015)), ...Array.from({ length: 12 }, (_, i) => at(rb(0.004, 0.55, 0.07, 0.001), [-0.15 + i * 0.027, 0, -0.12])), at(rb(0.12, 0.08, 0.01, 0.003), [0, 0.18, 0.095])),
        telemetry: (rt) => ({ "DC bus": fmt(rt.act.voltage ?? 565, "V", 0), "output current": "41 A", heatsink: fmt((rt.act.temp ?? 31) + 12, "°C") }) }),
      e({ id: "PLC.vfd2", name: "Inverter #2 (conveyors)", category: "electrical", mat: "paintBlue", pos: [1.6, 1.3, 0], explodeVector: [0, 0, 1.1], explodeOrder: 1,
        geo: comp(at(rb(0.3, 0.5, 0.16, 0.015)), ...Array.from({ length: 10 }, (_, i) => at(rb(0.004, 0.45, 0.06, 0.001), [-0.13 + i * 0.028, 0, -0.1]))) }),
      ...[1, 2].map((i) => e({ id: `PLC.fan${i}`, name: `Roof cooling fan #${i}`, category: "mechanical", mat: "plasticBlack", pos: [-0.2 + (i - 1) * 1.8, 2.25, 0], explodeVector: [0, 0.7, 0], explodeOrder: 0,
        geo: comp(at(cy(0.2, 0.08)), ...Array.from({ length: 7 }, (_, j) => at(rb(0.16, 0.01, 0.05, 0.004), [Math.cos((j / 7) * PI * 2) * 0.09, 0.045, Math.sin((j / 7) * PI * 2) * 0.09], [0.4, -(j / 7) * PI * 2, 0]))),
        motion: (rt) => ({ rot: [0, fan(rt) * (i === 2 && (rt.phase.fanFail ?? 0) > 0 ? 0 : 1), 0] }),
        telemetry: (rt) => ({ speed: i === 2 && (rt.phase.fanFail ?? 0) > 0 ? "0 rpm" : "2 750 rpm", "cabinet temp": fmt((rt.act.temp ?? 31) + (rt.phase.fanFail ?? 0) * 18, "°C") }) })),
      e({ id: "PLC.cables", name: "Field cables to the line (cable tray)", category: "electrical", mat: "rubber", pos: [0, 0, 0], explodeVector: [0, 0.6, 0.5], explodeOrder: 0,
        geo: comp(...[-1.2, -0.4, 0.4, 1.2].map((x) => at(hose([[x, 2.15, -0.1], [x, 2.7, -0.1], [x * 0.5, 3.4, 2], [x * 0.3, 3.6, 6]], 0.025)))) }),
    ] },
  ],
};
