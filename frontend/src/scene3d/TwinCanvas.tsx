// The 3D canvas: environment & lights, hall, machines, flow, camera rig with smooth fly-to / fit, bloom for beacons.
import { Suspense } from "react";
import { advance, Canvas, useFrame } from "@react-three/fiber";
import { CameraControls, Environment } from "@react-three/drei";
import { Bloom, EffectComposer } from "@react-three/postprocessing";
import * as THREE from "three";
import { MACHINES } from "../twin/registry";
import { objects, ViewContext, type ViewState } from "./context";
import { Flow } from "./Flow";
import { Hall } from "./Hall";
import { MachineView } from "./MachineView";

export type CameraPreset = "overview" | "logistics" | "machining" | "assembly" | "packaging" | "control";
export const CAMERA_PRESETS: Record<CameraPreset, { label: string; pos: [number, number, number]; target: [number, number, number] }> = {
  overview: { label: "Factory overview", pos: [-8, 34, 40], target: [-4, 0, 0] },
  logistics: { label: "Logistics & AGVs", pos: [-24, 14, 20], target: [-33, 0, 0] },
  machining: { label: "Machining & press", pos: [-6, 9, 15], target: [-5, 1.5, 0] },
  assembly: { label: "Robotic welding cell", pos: [19, 7, 11], target: [14, 1.5, 0] },
  packaging: { label: "Palletizing & outfeed", pos: [30, 8, 9], target: [24.5, 1, -1.5] },
  control: { label: "Electrical & control", pos: [3, 4, -6], target: [0, 1.4, -13] },
};

/** Imperative camera API used by the HUD (presets, fly to machine/part, reset). */
export const cameraApi = {
  controls: null as CameraControls | null,
  preset(p: CameraPreset) { const c = CAMERA_PRESETS[p]; this.controls?.setLookAt(...c.pos, ...c.target, true); },
  fit(id: string, padding = 1.2) {
    const o = objects.get(id);
    if (!o || !this.controls) return;
    const box = new THREE.Box3().setFromObject(o);
    if (box.isEmpty()) return;
    const size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
    const dist = Math.max(size.x, size.y, size.z) * 1.6 * padding + 1.2;
    this.controls.setLookAt(center.x + dist * 0.75, center.y + dist * 0.55, center.z + dist * 0.9, center.x, center.y, center.z, true);
  },
};

if (import.meta.env.DEV) Object.assign(window, { __advance: advance, __objects: objects });   // dev-only: render frames from the console

function Ticker({ v }: { v: ViewState }) {
  useFrame((_, dt) => v.sim.tick(Math.min(dt, 0.1)));     // the render loop drives the simulation
  return null;
}

export function TwinCanvas({ view }: { view: ViewState }) {
  const structures = view.mode === "factory";
  return (
    <Canvas shadows dpr={[1, view.quality ? 1.75 : 1.25]} camera={{ position: CAMERA_PRESETS.overview.pos, fov: 40, near: 0.1, far: 400 }}
            gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping }} onPointerMissed={() => view.hover(null)}>
      <ViewContext.Provider value={view}>
        <color attach="background" args={["#0b1220"]} />
        <fog attach="fog" args={["#0b1220", 70, 160]} />
        <hemisphereLight args={["#e0f2fe", "#1e293b", 0.5 * view.sim.line.lighting]} />
        <directionalLight position={[18, 30, 14]} intensity={1.6 * view.sim.line.lighting} castShadow shadow-mapSize={[2048, 2048]} shadow-bias={-0.0004}
                          shadow-camera-left={-50} shadow-camera-right={50} shadow-camera-top={25} shadow-camera-bottom={-25} shadow-camera-far={90} />
        <Suspense fallback={null}>
          {/* CC0 HDRI (Poly Haven "Industrial Pipe and Valve 01"), shipped locally: reflections on metal and floor */}
          <Environment files="/hdri/industrial_pipe_and_valve_01_1k.hdr" environmentIntensity={0.55 * view.sim.line.lighting} />
        </Suspense>
        <Hall quality={view.quality} structures={structures} />
        {MACHINES.filter((m) => m.type !== "agv").map((m) => <MachineView key={m.id} def={m} />)}
        <Flow />
        <Ticker v={view} />
        <CameraControls ref={(c) => { cameraApi.controls = c; }} maxPolarAngle={Math.PI / 2.05} minDistance={1.5} maxDistance={120} smoothTime={0.45} />
        {view.quality && (
          <EffectComposer multisampling={4}>
            <Bloom intensity={0.7} luminanceThreshold={1} luminanceSmoothing={0.2} mipmapBlur />
          </EffectComposer>
        )}
      </ViewContext.Provider>
    </Canvas>
  );
}
