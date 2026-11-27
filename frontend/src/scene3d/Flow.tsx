// Material flow: conveyor rollers, workpieces (instanced, coloured by process stage), pallet, AGVs with their loads, welding arcs.
import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { BELT_Y, ST } from "../twin/layout";
import { SEGMENTS } from "../twin/machines/line";
import { PAL_PALLET } from "../twin/machines/cells";
import { MACHINE, AGV_IDS } from "../twin/registry";
import { palletSlot, type WpKind } from "../twin/sim";
import { objects, useView } from "./context";
import { MachineView } from "./MachineView";

const KIND_COLOR: Record<WpKind, THREE.Color> = {
  raw: new THREE.Color("#8b5a2b"), machined: new THREE.Color("#cbd5e1"), pressed: new THREE.Color("#60a5fa"), welded: new THREE.Color("#f97316"),
};
const tmp = new THREE.Object3D(), v3 = new THREE.Vector3();

function Rollers() {
  const v = useView();
  const ref = useRef<THREE.InstancedMesh>(null);
  const rollers = useMemo(() => SEGMENTS.flatMap((s) => {
    const n = Math.floor((s.x1 - s.x0) / 0.25);
    return Array.from({ length: n }, (_, i) => s.x0 + 0.125 + i * 0.25);
  }), []);
  useFrame(() => {
    const m = ref.current;
    if (!m) return;
    const a = (v.sim.rt.CNV.phase.belt ?? 0) / 0.05;
    rollers.forEach((x, i) => {
      tmp.position.set(x, BELT_Y - 0.06, 0); tmp.rotation.set(Math.PI / 2, a, 0); tmp.updateMatrix();
      m.setMatrixAt(i, tmp.matrix);
    });
    m.instanceMatrix.needsUpdate = true;
    m.visible = v.mode === "factory" || v.machine === "CNV";
  });
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, rollers.length]}>
      <cylinderGeometry args={[0.04, 0.04, 0.84, 10]} />
      <meshStandardMaterial color="#9ca3af" metalness={0.85} roughness={0.25} />
    </instancedMesh>
  );
}

function Workpieces() {
  const v = useView();
  const ref = useRef<THREE.InstancedMesh>(null);
  const CAP = 160;
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
      m.setColorAt(n, KIND_COLOR[w.kind]);
      n++;
    }
    m.count = n;
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    m.visible = v.mode === "factory";
  });
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, CAP]} castShadow frustumCulled={false}>
      <boxGeometry args={[0.5, 0.5, 0.5]} />
      <meshStandardMaterial metalness={0.5} roughness={0.45} />
    </instancedMesh>
  );
}

function Pallet() {
  const v = useView();
  return (
    <group position={[ST.palletizer + PAL_PALLET[0], 0, PAL_PALLET[2]]} visible={v.mode === "factory" || v.machine === "PAL"}>
      {[-0.55, 0, 0.55].map((z) => <mesh key={z} position={[0, 0.06, z]} castShadow><boxGeometry args={[1.6, 0.12, 0.2]} /><meshStandardMaterial color="#a16207" roughness={0.9} /></mesh>)}
      <mesh position={[0, 0.14, 0]} receiveShadow><boxGeometry args={[1.6, 0.04, 1.6]} /><meshStandardMaterial color="#ca8a04" roughness={0.9} /></mesh>
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
        <mesh position={[0, 0.3, 0]} castShadow><boxGeometry args={[1.0, 0.6, 0.75]} /><meshStandardMaterial color="#8b5a2b" roughness={0.9} /></mesh>
      </group>
      <group ref={pal} position={[0, 0.5, 0]}>
        <mesh position={[0, 0.07, 0]}><boxGeometry args={[1.2, 0.14, 0.9]} /><meshStandardMaterial color="#ca8a04" /></mesh>
        <mesh position={[0, 0.42, 0]} castShadow><boxGeometry args={[1.1, 0.55, 0.85]} /><meshStandardMaterial color="#f97316" metalness={0.4} roughness={0.4} /></mesh>
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
      <Rollers />
      <Workpieces />
      <Pallet />
      {AGV_IDS.map((id, i) => <Agv key={id} id={id} index={i} />)}
      <WeldArcs />
    </>
  );
}
