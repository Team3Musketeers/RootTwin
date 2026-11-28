// Digital-twin data model: Zone -> Machine -> SubAssembly -> Part, plus runtime state and faults.

export type V3 = [number, number, number];
export type PartCategory = "mechanical" | "electrical" | "actuator" | "sensor" | "structural" | "tooling";

/** Declarative CAD shape, turned into a mesh by scene3d/cad.ts. All units metres, axes: cylinders/lathe/motor/bearing along +y. */
export type Shape =
  | { kind: "rbox"; size: V3; r?: number }                                     // filleted block (castings, panels)
  | { kind: "cyl"; r: number; r2?: number; h: number; seg?: number }
  | { kind: "sphere"; r: number }
  | { kind: "torus"; R: number; r: number }
  | { kind: "lathe"; pts: [number, number][] }                                  // turned part from (radius, y) profile
  | { kind: "gear"; m: number; z: number; w: number; helix?: number; bore?: number }   // involute gear, axis z
  | { kind: "motor"; r: number; len: number }                                   // finned AC motor
  | { kind: "bearing"; ri: number; ro: number; w: number; n?: number; taper?: boolean }
  | { kind: "bolts"; radius: number; n: number; size?: number }
  | { kind: "tube"; pts: V3[]; r: number; corrugated?: boolean }              // hose, cable, pipe
  | { kind: "helix"; r: number; pitch: number; turns: number; wire: number }   // spring, auger flight
  | { kind: "tslot"; len: number; s?: number }                                 // aluminium profile along x
  | { kind: "extrude"; outline: [number, number][]; depth: number; bevel?: number }   // filleted plate/link in XY, depth z
  | { kind: "compound"; items: { shape: Shape; pos?: V3; rot?: V3 }[] };

export type MatName =
  | "robotOrange" | "robotYellow" | "graphite" | "castIron" | "steel" | "chrome" | "brushedAlu" | "anodized" | "copper" | "brass"
  | "rubber" | "glass" | "smokedGlass" | "sheetWhite" | "sheetGrey" | "paintBlue" | "paintRed" | "paintGreen" | "safetyYellow"
  | "cabinet" | "plasticBlack" | "wood" | "belt" | "perforated" | "ledGreen" | "ledRed" | "ledBlue" | "ledWhite" | "screen" | "laser" | "oil"
  | "warnLabel" | "nameplate" | "hazard";       // decals: ISO 7010 warning label, machine nameplate, hazard stripes

/** Pose of a part relative to its parent, computed every frame from the machine runtime. */
export interface Motion { pos?: V3; rot?: V3 }

export interface Part {
  id: string;
  partNumber: string;
  name: string;
  category: PartCategory;
  material: string;
  description: string;
  maintenanceNotes: string;
  specs?: Record<string, string>;
  geo: Shape;
  mat: MatName;                  // PBR material preset (scene3d/materials.ts)
  housing?: boolean;             // outer casing: turns to glass in X-ray / cutaway mode
  tolerance?: string;            // e.g. "Ø40 k6", "±0.02 mm"
  pos: V3;                       // mounted position = joint/pivot (relative to parent part or machine origin)
  rot?: V3;
  meshPos?: V3;                  // geometry offset from the pivot (e.g. an arm link extends from its joint)
  meshRot?: V3;
  color?: string;                // optional tint over the material preset
  explodeVector: V3;             // direction * distance of the part when fully exploded (relative to parent)
  explodeOrder: number;          // 0 = peels away first (outer housings), higher = later (inner shafts, bearings)
  assemblyAxis: "X" | "Y" | "Z";
  parent?: string;               // kinematic parent (robots, spindle heads...) - moves with it
  motion?: (rt: MachineRuntime, t: number) => Motion;           // live animation (rotation, slide)
  telemetry?: (rt: MachineRuntime) => Record<string, string>;     // live readings shown on the part card
}

export interface SubAssembly { id: string; name: string; parts: Part[] }

export interface Control { key: string; label: string; unit: string; min: number; max: number; step: number }

export interface FaultSpec {
  code: string;                  // local fault code
  partId: string;
  label: string;                 // e.g. "Input bearing overheat"
  severity: "warning" | "critical";
  backendCodes?: string[];       // backend fault-catalogue codes that map onto this part
}

export type MachineType = "dispenser" | "agv" | "vision" | "cnc" | "press" | "welding" | "palletizer" | "plc";

export interface MachineDef {
  id: string;
  type: MachineType;
  name: string;
  zone: string;
  backendId?: string;            // machine id on the backend line (M1..M6) for faults, sensors, alarms
  position: V3;
  rotation?: number;             // yaw (rad)
  size: V3;                      // bounding box used for beacon placement / camera framing
  description: string;
  subAssemblies: SubAssembly[];
  controls: Control[];
  faults: FaultSpec[];
  defaults: Record<string, number>;
}

export interface Zone { id: string; name: string; color: string; center: V3; size: V3; machines: string[] }

export type MachineStatus = "RUN" | "HOLD" | "STOP" | "FAULT" | "IDLE";

export interface MachineRuntime {
  id: string;
  status: MachineStatus;
  manual: boolean;               // operator is driving setpoints (robots: joints) instead of the program
  set: Record<string, number>;   // setpoints (sliders / numeric inputs)
  act: Record<string, number>;   // actual values, smoothly following setpoints or the automatic program
  phase: Record<string, number>; // integrated angles/positions (spindle angle, conveyor travel...)
  cycles: number;
  busy: number;                  // 0..1 progress of the current station cycle
  stepOnce: boolean;
}

export type Severity = "warning" | "critical";
export interface Fault {
  id: string;
  machineId: string;
  partId: string;
  code: string;
  label: string;
  severity: Severity;
  t: number;
  source: "local" | "backend" | "player";       // player = caused by an operator mistake (trips the line interlock)
  acknowledged: boolean;
}

export type LineState = "RUNNING" | "PAUSED" | "ESTOP" | "STOPPED";

export interface TwinEvent { t: number; level: "info" | "warning" | "fault" | "success"; text: string }
