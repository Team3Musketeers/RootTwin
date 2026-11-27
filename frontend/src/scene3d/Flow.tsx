// Material flow: CAD workpiece blanks (instanced, tinted by process stage), Euro pallets, pallet, AGVs with their loads, welding arcs.
import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { BELT_Y, ST } from "../twin/layout";
import { euroPallet } from "../twin/machines/line";
import { PAL_PALLET } from "../twin/machines/cells";
import { MACHINE, AGV_IDS } from "../twin/registry";
import { palletSlot, type WpKind } from "../twin/sim";
import type { MatName, Shape } from "../twin/types";
import { geometryFor } from "./cad";
import { objects, useView } from "./context";
import { makeMaterial } from "./materials";
import { MachineView } from "./MachineView";

const tmp = new THREE.Object3D(), v3 = new THREE.Vector3();

// CAD load shapes: a machined housing blank (raw casting -> machined -> pressed bushing -> welded bracket), Euro pallet loads
const BLANK: Shape = { kind: "compound", items: [
  { shape: { kind: "rbox", size: [0.5, 0.26, 0.42], r: 0.04 }, pos: [0, -0.12, 0] },
  { shape: { kind: "cyl", r: 0.13, h: 0.16, seg: 32 }, pos: [0, 0.07, 0] },
  { shape: { kind: "torus", R: 0.13, r: 0.018 }, pos: [0, 0.15, 0], rot: [Math.PI / 2, 0, 0] },
  { shape: { kind: "cyl", r: 0.03, h: 0.27, seg: 12 }, pos: [0.19, -0.12, 0.15] },
  { shape: { kind: "cyl", r: 0.03, h: 0.27, seg: 12 }, pos: [-0.19, -0.12, -0.15] },
] };
const RAW_LOAD: Shape = { kind: "compound", items: [
  ...[[-0.3, -0.2], [0.3, -0.2], [-0.3, 0.2], [0.3, 0.2]].map(([x, z]) => ({ shape: { kind: "rbox", size: [0.52, 0.3, 0.36], r: 0.05 } as Shape, pos: [x, 0.3, z] as [number, number, number] })),
] };
const CARTON: Shape = { kind: "rbox", size: [1.12, 0.58, 0.76], r: 0.03 }, WRAP: Shape = { kind: "rbox", size: [1.16, 0.62, 0.8], r: 0.05 };   // cartons + stretch film
const BLANK_COLOR: Record<WpKind, THREE.Color> = {     // tints over brushed aluminium
  raw: new THREE.Color("#6b5a4a"), machined: new THREE.Color("#ffffff"), pressed: new THREE.Color("#9cc3ff"), welded: new THREE.Color("#ffb37a"),
};

function Load({ shape, mat, tint, ...rest }: { shape: Shape; mat: MatName; tint?: string; position?: [number, number, number] }) {
  const geometry = useMemo(() => geometryFor(shape), [shape]);
  const material = useMemo(() => makeMaterial(mat, tint), [mat, tint]);
  return <mesh geometry={geometry} material={material} castShadow receiveShadow {...rest} />;
}

function Workpieces() {
  const v = useView();
  const ref = useRef<THREE.InstancedMesh>(null);
  const CAP = 160;
  const geometry = useMemo(() => geometryFor(BLANK), []);
  const material = useMemo(() => makeMaterial("brushedAlu"), []);
  useFrame(() => {
    const m = ref.current;
    if (!m) return;
    let n = 0;
    const tool = objects.get("PAL.R.tool");
    for (const w of v.sim.wps) {
      if (n >= CAP) break;
      if (w.where === "line") tmp.position.set(w.x, BELT_Y + 0.25, 0);
      else if (w.where === "robot" && tool) { tool.getWorldPosition(v3); tmp.position.set(v3.x, v3.y - 0.33, v3.z); }
      else if (w.where === "pallet") { const p = palletSlot(w.slot); tmp.position.set(ST.palletizer + p[0], p[1], p[2]); }
      else continue;
      tmp.rotation.set(0, 0, 0); tmp.scale.setScalar(1); tmp.updateMatrix();
      m.setMatrixAt(n, tmp.matrix);
      m.setColorAt(n, BLANK_COLOR[w.kind]);
      n++;
    }
    m.count = n;
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    m.visible = v.mode === "factory";
  });
  return (
    <instancedMesh ref={ref} args={[geometry, material, CAP]} castShadow frustumCulled={false} />
  );
}

function Pallet() {
  const v = useView();
  return (
    <group position={[ST.palletizer + PAL_PALLET[0], 0, PAL_PALLET[2]]} visible={v.mode === "factory" || v.machine === "PAL"}>
      {/* two Euro pallets (EPAL 1200 x 800) side by side = 1.2 x 1.6 m pattern area */}
      <Load shape={euroPallet} mat="wood" position={[0, 0, -0.4]} />
      <Load shape={euroPallet} mat="wood" position={[0, 0, 0.4]} />
    </group>
  );
}

function Agv({ id, index }: { id: string; index: number }) {
  const v = useView();
  const group = useRef<THREE.Group | null>(null);
  const raw = useRef<THREE.Group>(null), pal = useRef<THREE.Group>(null);
  useFrame(() => {
    const a = v.sim.agvs[index], g = group.current;
    if (!g || !a) return;
    if (!(v.mode !== "factory" && v.machine === id)) { g.position.set(a.pos[0], 0, a.pos[2]); g.rotation.y = a.yaw; }
    else { g.position.set(-33, 0, 2); g.rotation.y = 0; }             // isolated AGVs park in the logistics area for inspection
    if (raw.current) raw.current.visible = a.carrying === "raw" && v.mode === "factory";
    if (pal.current) pal.current.visible = a.carrying === "pallet" && v.mode === "factory";
  });
  return (
    <MachineView def={MACHINE[id]} groupRef={(g) => { group.current = g; }}>
      <group ref={raw} position={[0, 0.5, 0]}>
        <Load shape={euroPallet} mat="wood" />
        <Load shape={RAW_LOAD} mat="castIron" />
      </group>
      <group ref={pal} position={[0, 0.5, 0]}>
        <Load shape={euroPallet} mat="wood" />
        <Load shape={CARTON} mat="wood" tint="#c49a6c" position={[0, 0.46, 0]} />
        <Load shape={WRAP} mat="smokedGlass" position={[0, 0.46, 0]} />
      </group>
    </MachineView>
  );
}

function WeldArcs() {
  const v = useView();
  const lights = [useRef<THREE.PointLight>(null), useRef<THREE.PointLight>(null)];
  const sparks = [useRef<THREE.Mesh>(null), useRef<THREE.Mesh>(null)];
  useFrame(({ clock }) => {
    const on = (v.sim.rt.WLD.phase.arc ?? 0) > 0 && v.sim.line.state === "RUNNING";
    ["WLD.A.tool", "WLD.B.tool"].forEach((id, i) => {
      const tool = objects.get(id), l = lights[i].current, s = sparks[i].current;
      if (!tool || !l || !s) return;
      tool.getWorldPosition(v3);
      // torch tip = tool origin + half length along the torch axis (pointing down when welding)
      l.position.set(v3.x, v3.y - 0.2, v3.z); s.position.copy(l.position);
      const flicker = 0.6 + 0.4 * Math.sin(clock.elapsedTime * 60 + i * 2) * Math.sin(clock.elapsedTime * 23);
      l.intensity = on ? 18 * flicker : 0;
      s.visible = on;
      s.scale.setScalar(0.6 + flicker * 0.6);
    });
  });
  return (
    <>
      {[0, 1].map((i) => (
        <group key={i}>
          <pointLight ref={lights[i]} color="#bfdbfe" distance={7} intensity={0} />
          <mesh ref={sparks[i]} visible={false}><sphereGeometry args={[0.06, 10, 8]} /><meshBasicMaterial color="#e0f2fe" toneMapped={false} /></mesh>
        </group>
      ))}
    </>
  );
}

export function Flow() {
  return (
    <>
      <Workpieces />
      <Pallet />
      {AGV_IDS.map((id, i) => <Agv key={id} id={id} index={i} />)}
      <WeldArcs />
    </>
  );
}
