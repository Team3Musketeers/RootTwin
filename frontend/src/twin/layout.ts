// Factory floor plan (metres, y up). The main line runs along +x at z = 0.
export const BELT_Y = 0.9;
export const ST = {          // station x positions on the main line
  dispenser: -24, vision: -15, cnc: -6, press: 4, welding: 14, palletizer: 24, lineEnd: 21.6,
} as const;
export const LINE_X0 = ST.dispenser + 1.4;           // first conveyor starts after the dispenser outlet
export const STOPS = [                                // stations where a workpiece stops on the line
  { machine: "VIS", x: ST.vision, time: 1.5 },
  { machine: "CNC", x: ST.cnc, time: 5 },
  { machine: "PRS", x: ST.press, time: 3.5 },
  { machine: "WLD", x: ST.welding, time: 6 },
] as const;
export const HALL = { x0: -46, x1: 34, z0: -16, z1: 16, height: 11 };
// high-bay racks: two rows along z facing the AGV aisle at x = -36
export const RACK = { xs: [-42.6, -39.2], z0: -11.7, bays: 9, levels: 5, bay: 2.6, level: 1.6, depth: 1.2 };
export const PLC_POS: [number, number, number] = [0, 0, -13];
export const AGV_PATH: [number, number][] = [   // closed loop on the floor (x, z): rack aisle -> dispenser -> outfeed -> back
  [-36, 9], [-36, -9], [-27, -9], [-27, -3], [-25, -3], [-20, -9], [18, -9], [27, -6], [27, 3.6], [22, 9], [-30, 9],
];
export const AGV_STOPS = [
  { name: "rack pick", at: [-36, 0] as [number, number], wait: 2.5 },
  { name: "dispenser drop", at: [-25, -3] as [number, number], wait: 3 },
  { name: "outfeed pick", at: [27, 0] as [number, number], wait: 3 },
];
