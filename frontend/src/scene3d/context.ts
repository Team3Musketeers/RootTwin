// Shared scene state: the simulation instance, view/selection state, and a registry of 3D objects (for camera framing).
import { createContext, useContext } from "react";
import type { Object3D } from "three";
import type { Action, FloorClient } from "../services/floor";
import type { TwinSim } from "../twin/sim";

export type ViewMode = "factory" | "isolate" | "exploded";

export interface ViewState {
  sim: TwinSim;
  mode: ViewMode;
  machine: string | null;          // selected machine
  part: string | null;             // selected part
  hoverPart: string | null;
  explode: number;                 // target explode factor for the selected machine (0..1)
  guides: boolean;
  xray: boolean;                   // housings become transparent (cutaway) so internals are visible while running
  labels: boolean;
  quality: boolean;
  selectMachine: (id: string | null) => void;
  selectPart: (id: string | null) => void;
  hover: (id: string | null) => void;
  isolate: (id: string) => void;
  walk: boolean;                   // worker mode: WASD avatar, panels need physical reach
  floor: FloorClient;              // multiplayer presence + claims
  act: (a: Action) => void;        // every operator action goes through here (shared with the other players)
}

export const ViewContext = createContext<ViewState | null>(null);
export const useView = () => useContext(ViewContext)!;

/** id -> Object3D (machines by machine id, parts by part id); filled by the renderers, read by the camera rig. */
export const objects = new Map<string, Object3D>();
