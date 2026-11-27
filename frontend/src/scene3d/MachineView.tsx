// Generic renderer: any MachineDef -> kinematic part tree with live motion, staggered exploded view,
// isolation ghosting, selection/hover highlight, pulsing red faulty parts, guide lines, callouts and a status beacon.
import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { Html, Line } from "@react-three/drei";
import * as THREE from "three";
import { explodeProgress } from "../twin/explode";
import type { MachineDef, Part } from "../twin/types";
import { objects, useView } from "./context";
import { geometryFor } from "./geometry";

const noRaycast = () => undefined;              // ghosted machines are not clickable
const RED = new THREE.Color("#ff1a1a"), CYAN = new THREE.Color("#38bdf8"), BLACK = new THREE.Color("#000000");

interface Node { part: Part; children: Node[] }
function tree(parts: Part[]): Node[] {
  const nodes = new Map(parts.map((p) => [p.id, { part: p, children: [] as Node[] }]));
  const roots: Node[] = [];
  for (const n of nodes.values()) (n.part.parent && nodes.get(n.part.parent) ? nodes.get(n.part.parent)!.children : roots).push(n);
  return roots;
}

function PartNode({ node, def, maxOrder, explodeRef }: { node: Node; def: MachineDef; maxOrder: number; explodeRef: { current: number } }) {
  const v = useView();
  const p = node.part;
  const group = useRef<THREE.Group>(null);
  const guide = useRef<any>(null);
  const label = useRef<HTMLDivElement>(null);
  const mat = useMemo(() => new THREE.MeshStandardMaterial({
    color: p.color, metalness: p.metalness ?? 0.6, roughness: p.roughness ?? 0.4,
    transparent: (p.opacity ?? 1) < 1, opacity: p.opacity ?? 1,
  }), [p]);
  useEffect(() => () => mat.dispose(), [mat]);
  useEffect(() => { if (group.current) objects.set(p.id, group.current); return () => { objects.delete(p.id); }; }, [p.id]);
  const mine = v.machine === def.id;
  const isolatedOther = v.mode !== "factory" && v.machine !== null && !mine;

  useFrame(({ clock }) => {
    const g = group.current;
    if (!g) return;
    const rt = v.sim.rt[def.id];
    const m = p.motion?.(rt, v.sim.t) ?? {};
    const e = explodeProgress(explodeRef.current, p.explodeOrder, maxOrder);
    const base = m.pos ?? p.pos;
    g.position.set(base[0] + p.explodeVector[0] * e, base[1] + p.explodeVector[1] * e, base[2] + p.explodeVector[2] * e);
    const r = m.rot ?? p.rot ?? [0, 0, 0];
    g.rotation.set(r[0], r[1], r[2]);
    // material state
    const fault = v.sim.partFault(p.id);
    const sel = v.part === p.id, hov = v.hoverPart === p.id;
    if (fault) {
      mat.emissive.copy(RED);
      mat.emissiveIntensity = (fault.severity === "critical" ? 1.6 : 0.9) * (0.55 + 0.45 * Math.sin(clock.elapsedTime * 7));
      mat.color.set(fault.severity === "critical" ? "#ff2d2d" : "#ff7a1a");
    } else {
      mat.color.set(p.color);
      mat.emissive.copy(sel ? CYAN : hov ? CYAN : BLACK);
      mat.emissiveIntensity = sel ? 0.6 : hov ? 0.3 : 0;
    }
    const ghost = isolatedOther ? v.sim.line.ghost : (v.mode !== "factory" && mine && v.part && !sel && !fault ? 0.35 : p.opacity ?? 1);
    if (mat.transparent !== ghost < 1) { mat.transparent = ghost < 1; mat.needsUpdate = true; }   // shader recompile only on change
    mat.opacity = ghost; mat.depthWrite = ghost >= 0.5;
    // guide line from the mounted position to the exploded position (in the parent's frame)
    if (guide.current) {
      const show = v.guides && mine && e > 0.02;
      guide.current.visible = show;
      if (show) guide.current.geometry.setPositions([base[0], base[1], base[2], g.position.x, g.position.y, g.position.z]);
    }
    if (label.current) label.current.style.display = v.labels && mine && (explodeRef.current > 0.25 || sel) ? "block" : "none";
  });

  const onClick = (ev: ThreeEvent<MouseEvent>) => {
    ev.stopPropagation();
    if (isolatedOther) return;
    if (mine && v.mode !== "factory") v.selectPart(p.id); else v.selectMachine(def.id);
  };
  return (
    <>
      <group ref={group}>
        <mesh geometry={geometryFor(p.geo)} material={mat} position={p.meshPos} rotation={p.meshRot} castShadow receiveShadow
              onClick={onClick} onDoubleClick={(ev) => { ev.stopPropagation(); if (!isolatedOther) v.isolate(def.id); }}
              onPointerOver={(ev) => { ev.stopPropagation(); if (!isolatedOther) { v.hover(p.id); document.body.style.cursor = "pointer"; } }}
              onPointerOut={() => { v.hover(null); document.body.style.cursor = ""; }}
              raycast={isolatedOther ? noRaycast : THREE.Mesh.prototype.raycast} />
        {mine && (
          <Html position={[0, 0, 0]} center zIndexRange={[20, 0]} style={{ pointerEvents: "none" }}>
            <div ref={label} style={{ display: "none" }} className="whitespace-nowrap rounded border border-white/20 bg-slate-950/85 px-1.5 py-0.5 text-[10px] text-slate-100 shadow">
              <span className="font-mono text-sky-300">{p.partNumber}</span> {p.name}
            </div>
          </Html>
        )}
        {node.children.map((c) => <PartNode key={c.part.id} node={c} def={def} maxOrder={maxOrder} explodeRef={explodeRef} />)}
      </group>
      {mine && <Line ref={guide} points={[[0, 0, 0], [0, 0, 0]]} color="#38bdf8" dashed dashSize={0.08} gapSize={0.06} lineWidth={1} visible={false} />}
    </>
  );
}

function Beacon({ def }: { def: MachineDef }) {
  const v = useView();
  const mat = useRef<THREE.MeshStandardMaterial>(null);
  const light = useRef<THREE.PointLight>(null);
  useFrame(({ clock }) => {
    const faults = v.sim.machineFaults(def.id), rt = v.sim.rt[def.id];
    const crit = faults.some((f) => f.severity === "critical");
    const col = crit ? "#ff1a1a" : faults.length ? "#f59e0b" : rt.status === "RUN" && v.sim.line.state === "RUNNING" ? "#22c55e" : "#64748b";
    const pulse = crit || faults.length ? 0.6 + 0.6 * Math.abs(Math.sin(clock.elapsedTime * 5)) : 0.8;
    if (mat.current) { mat.current.color.set(col); mat.current.emissive.set(col); mat.current.emissiveIntensity = pulse * 2; }
    if (light.current) { light.current.color.set(col); light.current.intensity = crit && v.mode === "factory" ? 3 * pulse : 0; }   // no red flood in close-ups
  });
  const y = def.size[1] + 0.35;
  return (
    <group position={[0, y, 0]}>
      <mesh position={[0, -0.25, 0]}><cylinderGeometry args={[0.04, 0.04, 0.5, 8]} /><meshStandardMaterial color="#334155" /></mesh>
      <mesh><cylinderGeometry args={[0.13, 0.13, 0.26, 16]} /><meshStandardMaterial ref={mat} toneMapped={false} /></mesh>
      <pointLight ref={light} distance={4} intensity={0} />
    </group>
  );
}

export function MachineView({ def, children, groupRef }: { def: MachineDef; children?: ReactNode; groupRef?: (g: THREE.Group | null) => void }) {
  const v = useView();
  const roots = useMemo(() => tree(def.subAssemblies.flatMap((s) => s.parts)), [def]);
  const maxOrder = useMemo(() => Math.max(...def.subAssemblies.flatMap((s) => s.parts.map((p) => p.explodeOrder))), [def]);
  const explodeRef = useRef(0);
  const group = useRef<THREE.Group>(null);
  useEffect(() => { if (group.current) objects.set(def.id, group.current); return () => { objects.delete(def.id); }; }, [def.id]);
  useFrame((_, dt) => {
    const target = v.machine === def.id && v.mode === "exploded" ? v.explode : 0;
    explodeRef.current += (target - explodeRef.current) * Math.min(1, dt * 4);     // smooth, frame-rate independent
  });
  return (
    <group ref={(g) => { (group as { current: THREE.Group | null }).current = g; groupRef?.(g); }}
           position={def.position} rotation={[0, def.rotation ?? 0, 0]}>
      {roots.map((n) => <PartNode key={n.part.id} node={n} def={def} maxOrder={maxOrder} explodeRef={explodeRef} />)}
      {def.id !== "CNV" && <Beacon def={def} />}
      {children}
    </group>
  );
}
