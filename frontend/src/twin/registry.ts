// All machines of the factory, zones, and fast lookups.
import { palletizer, welding } from "./machines/cells";
import { cnc, conveyors, dispenser, press, vision } from "./machines/line";
import { agv, plc } from "./machines/logistics";
import type { MachineDef, Part, Zone } from "./types";

export const AGV_IDS = ["AGV1", "AGV2", "AGV3"];
export const MACHINES: MachineDef[] = [dispenser, ...AGV_IDS.map((_, i) => agv(i + 1)), vision, conveyors, cnc, press, welding, palletizer, plc];
export const MACHINE: Record<string, MachineDef> = Object.fromEntries(MACHINES.map((m) => [m.id, m]));

export const ZONES: Zone[] = [
  { id: "logistics", name: "Logistics & AGVs", color: "#a855f7", center: [-33, 0, 0], size: [24, 0, 26], machines: ["DSP", ...AGV_IDS] },
  { id: "machining", name: "Infeed, machining & press", color: "#2563eb", center: [-6, 0, 0], size: [26, 0, 8], machines: ["VIS", "CNV", "CNC", "PRS"] },
  { id: "assembly", name: "Robotic welding cell", color: "#f97316", center: [14, 0, 0], size: [8, 0, 8], machines: ["WLD"] },
  { id: "packaging", name: "Palletizing & outfeed", color: "#14b8a6", center: [24.5, 0, -1], size: [8, 0, 8], machines: ["PAL"] },
  { id: "control", name: "Electrical & control", color: "#eab308", center: [0, 0, -13], size: [6, 0, 3], machines: ["PLC"] },
];

export const allParts = (m: MachineDef): Part[] => m.subAssemblies.flatMap((s) => s.parts);
const PARTS = new Map<string, Part>(MACHINES.flatMap((m) => allParts(m).map((p) => [p.id, p] as const)));
export const partById = (id: string) => PARTS.get(id);
export const machineOfPart = (partId: string) => MACHINES.find((m) => allParts(m).some((p) => p.id === partId));
export const zoneOf = (machineId: string) => ZONES.find((z) => z.machines.includes(machineId));
export const BACKEND_TO_MACHINE: Record<string, string> = Object.fromEntries(MACHINES.filter((m) => m.backendId).map((m) => [m.backendId!, m.id]));
