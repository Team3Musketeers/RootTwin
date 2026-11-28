// Generic renderer: any MachineDef -> kinematic CAD part tree with live motion, staggered exploded view, X-ray cutaway,
// isolation ghosting, selection/hover highlight, emissive crimson faulty parts, CAD axis guides, leader-line callouts, beacon.
import { Suspense, useEffect, useMemo, useRef, type ReactNode } from "react";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { Html, Line } from "@react-three/drei";
import * as THREE from "three";
import { explodeProgress } from "../twin/explode";
import type { MachineDef, Part } from "../twin/types";
import { geometryFor } from "./cad";
import { objects, useView } from "./context";
import { labelVisible } from "./hud";
import { isEmissivePreset, makeMaterial } from "./materials";
import { useAssetAvailable } from "./assetLoader";
import { GlbMachine } from "./GlbMachine";
import { hostedBy, ROBOT_MODELS, useRobotMeshes } from "./robotMeshes";
import { glbKey, useGlbParts, useModelUrl } from "./models";

const noRaycast = () => undefined;              // ghosted machines are not clickable
const tmpV = new THREE.Vector3(), tmpQ = new THREE.Quaternion();
const CRIMSON = new THREE.Color("#ff0a1e"), AMBER = new THREE.Color("#ff6a00"), CYAN = new THREE.Color("#38bdf8"), XRAY = new THREE.Color("#7dd3fc"), GHOST = new THREE.Color("#94a3b8");

interface Node { part: Part; children: Node[] }
function tree(parts: Part[]): Node[] {
  const nodes = new Map(parts.map((p) => [p.id, { part: p, children: [] as Node[] }]));
  const roots: Node[] = [];
  for (const n of nodes.values()) (n.part.parent && nodes.get(n.part.parent) ? nodes.get(n.part.parent)!.children : roots).push(n);
  return roots;
}

type Glb = Map<string, THREE.BufferGeometry | null> | null;     // null value = part hidden (contained in a real casting)
function PartNode({ node, def, maxOrder, explodeRef, glb }: { node: Node; def: MachineDef; maxOrder: number; explodeRef: { current: number }; glb: Glb }) {
  const v = useView();
  const p = node.part;
  const group = useRef<THREE.Group>(null);
  const guide = useRef<any>(null);
  const leader = useRef<any>(null);
  const label = useRef<HTMLDivElement>(null);
  const ring = useRef<THREE.Mesh>(null);
  const real = glb?.get(glbKey(p.id));
  const hidden = real === null;
  const geometry = useMemo(() => real ?? geometryFor(p.geo), [p.geo, real]);   // real CAD mesh when provided
  const vcol = !!geometry.attributes.color;                                     // real castings carry their paint per vertex
  const mat = useMemo(() => {
    const m = makeMaterial(p.mat, p.color);
    if (vcol) { m.vertexColors = true; m.color.set("#ffffff"); (m.userData.base as { color: THREE.Color }).color.set("#ffffff"); }
    return m;
  }, [p.mat, p.color, vcol]);
  useEffect(() => () => mat.dispose(), [mat]);
  useEffect(() => { if (group.current) objects.set(p.id, group.current); return () => { objects.delete(p.id); }; }, [p.id]);
  const mine = v.machine === def.id;
  const isolatedOther = v.mode !== "factory" && v.machine !== null && !mine;
  const base = mat.userData.base as { color: THREE.Color; emissive: THREE.Color; emissiveIntensity: number; opacity: number; transparent: boolean };
  const ringR = useMemo(() => { if (!geometry.boundingSphere) geometry.computeBoundingSphere(); return Math.max(0.12, geometry.boundingSphere!.radius * 1.25); }, [geometry]);
  const labelOffset = useMemo(() => {
    const e = new THREE.Vector3(...p.explodeVector);
    return (e.lengthSq() > 0 ? e.normalize().multiplyScalar(0.25) : new THREE.Vector3()).add(new THREE.Vector3(0, 0.3, 0));
  }, [p.explodeVector]);

  useFrame(({ clock, camera, gl }) => {
    const g = group.current;
    if (!g) return;
    const rt = v.sim.rt[def.id];
    const m = p.motion?.(rt, v.sim.t) ?? {};
    const e = explodeProgress(explodeRef.current, p.explodeOrder, maxOrder);
    const pos = m.pos ?? p.pos;
    g.position.set(pos[0] + p.explodeVector[0] * e, pos[1] + p.explodeVector[1] * e, pos[2] + p.explodeVector[2] * e);
    const r = m.rot ?? p.rot ?? [0, 0, 0];
    g.rotation.set(r[0], r[1], r[2]);
    // --- material state: fault > selection > X-ray > ghost > base
    const fault = v.sim.partFault(p.id) ?? (glb ? hostedBy.get(p.id)?.map((h) => v.sim.partFault(h)).find(Boolean) : undefined);
    const sel = v.part === p.id, hov = v.hoverPart === p.id;
    let opacity = base.opacity, transparent = base.transparent;
    if (vcol && mat.vertexColors === !!fault) { mat.vertexColors = !fault; mat.needsUpdate = true; }   // pure crimson on painted castings
    if (fault) {
      const pulse = 0.55 + 0.45 * Math.sin(clock.elapsedTime * 7);
      mat.color.copy(fault.severity === "critical" ? CRIMSON : AMBER);
      mat.emissive.copy(fault.severity === "critical" ? CRIMSON : AMBER);
      mat.emissiveIntensity = (fault.severity === "critical" ? 4 : 2) * pulse;              // > 1: picked up by the bloom pass
      opacity = 1; transparent = false;
    } else {
      mat.color.copy(base.color);
      if (sel || hov) { mat.emissive.copy(CYAN); mat.emissiveIntensity = sel ? 0.55 : 0.25; }
      else { mat.emissive.copy(base.emissive); mat.emissiveIntensity = base.emissiveIntensity; }
      if (v.xray && p.housing && (mine || v.mode === "factory")) { mat.color.copy(XRAY); opacity = 0.12; transparent = true; }
      if (isolatedOther) { opacity = Math.min(opacity, v.sim.line.ghost); transparent = true; }
      else if (v.mode !== "factory" && mine && v.part && !sel && !isEmissivePreset(p.mat)) {
        mat.color.lerp(GHOST, 0.75);                      // desaturate context parts so only the selected / faulty part carries colour
        opacity = Math.min(opacity, 0.3); transparent = true;
      }
    }
    if (mat.transparent !== transparent) { mat.transparent = transparent; mat.needsUpdate = true; }   // shader recompile only on change
    mat.opacity = opacity; mat.depthWrite = opacity >= 0.5;
    if (p.mat === "belt" && mat.map) mat.map.offset.x = -(v.sim.rt.CNV.phase.belt ?? 0) * 0.5;   // moving belt texture
    // --- CAD axis guide (mounted -> exploded position, extended) and leader-line callout
    const showGuide = v.guides && mine && e > 0.02;
    if (guide.current) {
      guide.current.visible = showGuide;
      if (showGuide) guide.current.geometry.setPositions([pos[0] - p.explodeVector[0] * 0.15, pos[1] - p.explodeVector[1] * 0.15, pos[2] - p.explodeVector[2] * 0.15, g.position.x, g.position.y, g.position.z]);
    }
    // target ring around a faulted part: always faces the camera, drawn through housings, pulses
    if (ring.current) {
      const r = ring.current, on = !!fault && !isolatedOther && !hidden;
      r.visible = on;
      if (on) {
        g.getWorldQuaternion(tmpQ).invert();
        r.quaternion.copy(tmpQ.multiply(camera.quaternion));
        r.scale.setScalar(1 + 0.18 * Math.sin(clock.elapsedTime * 5));
        (r.material as THREE.MeshBasicMaterial).color.copy(fault!.severity === "critical" ? CRIMSON : AMBER);
      }
    }
    // callouts: only hovered / selected / faulted parts (all of them with the "All labels" toggle), never under the HUD
    let showLabel = mine && (sel || hov || !!fault || (v.labels && explodeRef.current > 0.25));
    if (showLabel) showLabel = labelVisible(g.localToWorld(tmpV.copy(labelOffset)), camera, gl.domElement);
    if (leader.current) leader.current.visible = showLabel;
    if (label.current) {
      label.current.style.display = showLabel ? "block" : "none";
      label.current.style.borderColor = fault ? "#ef4444" : sel ? "#38bdf8" : "#64748b";
    }
  });

  const onClick = (ev: ThreeEvent<MouseEvent>) => {
    ev.stopPropagation();
    if (isolatedOther) return;
    if (mine && v.mode !== "factory") v.selectPart(p.id); else v.selectMachine(def.id);
  };
  return (
    <>
      <group ref={group}>
        <mesh visible={!hidden} geometry={geometry} material={mat} position={p.meshPos} rotation={p.meshRot} castShadow={!isEmissivePreset(p.mat) && p.mat !== "glass"} receiveShadow
              onClick={onClick} onDoubleClick={(ev) => { ev.stopPropagation(); if (!isolatedOther) v.isolate(def.id); }}
              onPointerOver={(ev) => { ev.stopPropagation(); if (!isolatedOther) { v.hover(p.id); document.body.style.cursor = "pointer"; } }}
              onPointerOut={() => { v.hover(null); document.body.style.cursor = ""; }}
              raycast={isolatedOther ? noRaycast : THREE.Mesh.prototype.raycast} />
        <mesh ref={ring} visible={false} renderOrder={20}>
          <torusGeometry args={[ringR, ringR * 0.04, 8, 48]} />
          <meshBasicMaterial transparent opacity={0.9} depthTest={false} toneMapped={false} />
        </mesh>
        {mine && (
          <>
            <Line ref={leader} points={[[0, 0, 0], labelOffset.toArray() as [number, number, number]]} color="#8a94a6" lineWidth={0.75} transparent opacity={0.8} visible={false} />
            <Html position={labelOffset.toArray() as [number, number, number]} zIndexRange={[20, 0]} style={{ pointerEvents: "none" }}>
              <div ref={label} style={{ display: "none" }} className="-translate-y-1/2 whitespace-nowrap border-l-2 rounded-[3px] border border-white/10 bg-[#141820]/90 px-1.5 py-0.5 text-[10px] text-[#e6eaf0] shadow-sm backdrop-blur">
                <span style={{ fontFamily: "var(--font-mono)", color: "#8a94a6" }}>{p.partNumber}</span> {p.name}
              </div>
            </Html>
          </>
        )}
        {node.children.map((c) => <PartNode key={c.part.id} node={c} def={def} maxOrder={maxOrder} explodeRef={explodeRef} glb={glb} />)}
      </group>
      {mine && <Line ref={guide} points={[[0, 0, 0], [0, 0, 0]]} color="#22d3ee" dashed dashSize={0.06} gapSize={0.04} lineWidth={1.2} visible={false} />}
    </>
  );
}

function Beacon({ def }: { def: MachineDef }) {
  const v = useView();
  const mats = [useRef<THREE.MeshStandardMaterial>(null), useRef<THREE.MeshStandardMaterial>(null), useRef<THREE.MeshStandardMaterial>(null)];
  const light = useRef<THREE.PointLight>(null);
  useFrame(({ clock }) => {
    const faults = v.sim.machineFaults(def.id), rt = v.sim.rt[def.id];
    const crit = faults.some((f) => f.severity === "critical");
    const pulse = 0.5 + 0.5 * Math.abs(Math.sin(clock.elapsedTime * 5));
    const on = [crit ? pulse : 0, !crit && faults.length ? pulse : 0, !faults.length && rt.status === "RUN" && v.sim.line.state === "RUNNING" ? 1 : 0];   // red / amber / green stack
    mats.forEach((m, i) => { if (m.current) m.current.emissiveIntensity = 0.05 + on[i] * 3.2; });
    if (light.current) light.current.intensity = crit && v.mode === "factory" ? 3 * pulse : 0;
  });
  const y = def.size[1] + 0.3;
  const colors = ["#ff1a1a", "#ffb020", "#22c55e"];
  return (
    <group position={[0, y, 0]}>
      <mesh position={[0, -0.25, 0]}><cylinderGeometry args={[0.02, 0.02, 0.5, 8]} /><meshStandardMaterial color="#9ca3af" metalness={0.9} roughness={0.3} /></mesh>
      {colors.map((c, i) => (
        <mesh key={c} position={[0, 0.25 - i * 0.1, 0]}>
          <cylinderGeometry args={[0.055, 0.055, 0.09, 20]} />
          <meshStandardMaterial ref={mats[i]} color={c} emissive={c} emissiveIntensity={0.05} toneMapped={false} roughness={0.3} />
        </mesh>
      ))}
      <mesh position={[0, 0.32, 0]}><cylinderGeometry args={[0.05, 0.055, 0.04, 20]} /><meshStandardMaterial color="#1f2937" /></mesh>
      <pointLight ref={light} color="#ff1a1a" distance={4} intensity={0} position={[0, 0.25, 0]} />
    </group>
  );
}

function RobotParts({ id, children }: { id: string; children: (glb: Glb) => ReactNode }) {
  return <>{children(useRobotMeshes(id))}</>;
}

function GlbParts({ url, children }: { url: string; children: (glb: Glb) => ReactNode }) {
  return <>{children(useGlbParts(url))}</>;
}

export function MachineView({ def, children, groupRef }: { def: MachineDef; children?: ReactNode; groupRef?: (g: THREE.Group | null) => void }) {
  const v = useView();
  const roots = useMemo(() => tree(def.subAssemblies.flatMap((s) => s.parts)), [def]);
  const maxOrder = useMemo(() => Math.max(...def.subAssemblies.flatMap((s) => s.parts.map((p) => p.explodeOrder))), [def]);
  const explodeRef = useRef(0);
  const group = useRef<THREE.Group>(null);
  const model = useModelUrl(def.id);
  const parts = (glb: Glb) => roots.map((n) => <PartNode key={n.part.id} node={n} def={def} maxOrder={maxOrder} explodeRef={explodeRef} glb={glb} />);
  const robots = useAssetAvailable(ROBOT_MODELS[def.id] ? `/models/robots/${ROBOT_MODELS[def.id][0].dir}/base_link.dae` : "/models/robots/none");
  useEffect(() => { if (group.current) objects.set(def.id, group.current); return () => { objects.delete(def.id); }; }, [def.id]);
  useFrame((_, dt) => {
    const target = v.machine === def.id && v.mode === "exploded" ? v.explode : 0;
    explodeRef.current += (target - explodeRef.current) * Math.min(1, dt * 4);     // smooth, frame-rate independent
  });
  return (
    <group ref={(g) => { (group as { current: THREE.Group | null }).current = g; groupRef?.(g); }}
           position={def.position} rotation={[0, def.rotation ?? 0, 0]}>
      {robots ? <Suspense fallback={parts(null)}><RobotParts id={def.id}>{parts}</RobotParts></Suspense>
        : !model ? parts(null)
        : model.replace ? <Suspense fallback={parts(null)}><GlbMachine url={model.url} def={def} explodeRef={explodeRef} /></Suspense>
        : <Suspense fallback={parts(null)}><GlbParts url={model.url}>{parts}</GlbParts></Suspense>}
      {def.id !== "CNV" && def.type !== "agv" && <Beacon def={def} />}
      {children}
    </group>
  );
}
