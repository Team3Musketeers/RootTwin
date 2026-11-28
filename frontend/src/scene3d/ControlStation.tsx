// Operator control station next to each machine (IEC 60204-1 / ISO 13850 colours): Start (green), Stop (red),
// Reset (blue), AUTO/MANUAL key selector, latching E-stop mushroom on a yellow plate, pilot lamp, and a spoked
// handwheel that adjusts the machine's main setpoint by dragging. Buttons are spring-returned (they dip and come back).
import { useMemo, useRef } from "react";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";
import type { MachineDef } from "../twin/types";
import { useView } from "./context";
import { cameraApi } from "./TwinCanvas";
import { labelVisible } from "./hud";
import { player } from "./Worker";

const REACH = 2.6;
const tmp = new THREE.Vector3();      // m: in worker mode you must stand at the panel to operate it

function Button({ color, pos, size = 0.028, onPress, label }: { color: string; pos: [number, number, number]; size?: number; onPress: () => void; label: string }) {
  const ref = useRef<THREE.Group>(null);
  const t = useRef(10);
  useFrame((_, dt) => { t.current += dt; if (ref.current) ref.current.position.y = pos[1] - 0.012 * Math.exp(-t.current * 9); });   // spring return
  return (
    <group ref={ref} position={pos}>
      <mesh name={label} onClick={(e) => { e.stopPropagation(); t.current = 0; onPress(); }} onPointerOver={(e) => { e.stopPropagation(); document.body.style.cursor = "pointer"; }}
            onPointerOut={() => { document.body.style.cursor = ""; }}>
        <cylinderGeometry args={[size, size, 0.022, 24]} />
        <meshPhysicalMaterial color={color} roughness={0.3} clearcoat={1} emissive={color} emissiveIntensity={0.15} />
      </mesh>
      <mesh position={[0, -0.012, 0]}><cylinderGeometry args={[size * 1.3, size * 1.3, 0.01, 24]} /><meshStandardMaterial color="#9ca3af" metalness={0.9} roughness={0.25} /></mesh>
    </group>
  );
}

export function ControlStation({ def }: { def: MachineDef }) {
  const v = useView();
  const rt = v.sim.rt[def.id];
  const wheelCtl = def.controls.find((c) => !/J\d$/.test(c.key) && c.key !== "grip");
  const local: [number, number, number] = [def.size[0] / 2 + 0.55, 0, def.size[2] / 2 + 0.1];
  const world = useMemo(() => new THREE.Vector3(def.position[0] + local[0], 0, def.position[2] + local[2]), [def]);   // machines are not rotated
  const lamp = useRef<THREE.MeshStandardMaterial>(null), wheel = useRef<THREE.Group>(null), key = useRef<THREE.Mesh>(null);
  const drag = useRef<{ x: number } | null>(null);
  const tag = useRef<HTMLDivElement>(null);

  /** Reach and ownership check before any physical action. */
  const can = () => {
    if (v.walk && Math.hypot(player.x - world.x, player.z - world.z) > REACH) { v.sim.log("warning", `Walk to the ${def.name} panel to operate it`); return false; }
    const owner = v.sim.owner[def.id];
    if (owner && owner !== v.floor.myName) { v.sim.log("warning", `${def.name} is operated by ${owner}`); return false; }
    return true;
  };
  const act = (a: Parameters<typeof v.act>[0], always = false) => { if (always || can()) v.act(a); };

  useFrame(({ clock, camera, gl }) => {
    const faulty = v.sim.machineFaults(def.id).length > 0;
    if (lamp.current) {
      lamp.current.color.set(faulty ? "#ff1a1a" : rt.status === "RUN" ? "#22c55e" : "#f59e0b");
      lamp.current.emissive.copy(lamp.current.color);
      lamp.current.emissiveIntensity = faulty ? 1.5 + Math.sin(clock.elapsedTime * 8) : 1.6;
    }
    if (wheel.current && wheelCtl) wheel.current.rotation.z = -((rt.set[wheelCtl.key] ?? 0) - wheelCtl.min) / (wheelCtl.max - wheelCtl.min) * Math.PI * 6;
    if (key.current) key.current.rotation.y = rt.manual ? Math.PI / 4 : -Math.PI / 4;
    if (tag.current) {                              // panel tag only for the machine in focus or the one the worker stands at
      const near = v.walk ? Math.hypot(player.x - world.x, player.z - world.z) < 4 : v.machine === def.id;
      tag.current.style.display = near && labelVisible(tmp.set(world.x, 1.5, world.z), camera, gl.domElement) ? "block" : "none";
    }
    if (tag.current && Math.round(clock.elapsedTime * 60) % 12 === 0) {      // ~5 Hz text refresh, no React render
      const o = v.sim.owner[def.id];
      tag.current.textContent = `${def.id} · ${rt.manual ? "MANUAL" : "AUTO"}${wheelCtl ? ` · ${wheelCtl.key} ${(rt.set[wheelCtl.key] ?? 0).toFixed(wheelCtl.step < 1 ? 2 : 0)}` : ""} · ${o ?? "unclaimed"}`;
      tag.current.style.color = o ? "#7dd3fc" : "#cbd5e1";
    }
  });

  const onWheelDown = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    if (!wheelCtl || !can()) return;
    drag.current = { x: e.clientX };
    (e.target as Element).setPointerCapture?.(e.pointerId);
    if (cameraApi.controls) cameraApi.controls.enabled = false;
  };
  const onWheelMove = (e: ThreeEvent<PointerEvent>) => {
    if (!drag.current || !wheelCtl) return;
    const dv = ((e.clientX - drag.current.x) / 400) * (wheelCtl.max - wheelCtl.min);
    if (Math.abs(dv) < wheelCtl.step) return;
    drag.current.x = e.clientX;
    const nv = Math.min(wheelCtl.max, Math.max(wheelCtl.min, Math.round(((rt.set[wheelCtl.key] ?? 0) + dv) / wheelCtl.step) * wheelCtl.step));
    v.act({ m: "set", id: def.id, key: wheelCtl.key, v: nv });
  };
  const onWheelUp = () => { drag.current = null; if (cameraApi.controls) cameraApi.controls.enabled = true; };

  return (
    <group position={local}>
      {/* pedestal + enclosure with a 30° sloped front */}
      <mesh position={[0, 0.5, 0]} castShadow><cylinderGeometry args={[0.04, 0.05, 1.0, 16]} /><meshStandardMaterial color="#4b5563" metalness={0.7} roughness={0.35} /></mesh>
      <mesh position={[0, 0.01, 0]}><cylinderGeometry args={[0.16, 0.18, 0.02, 24]} /><meshStandardMaterial color="#374151" metalness={0.6} roughness={0.4} /></mesh>
      <group position={[0, 1.08, 0]} rotation={[-Math.PI / 6, 0, 0]}>
        <mesh castShadow><boxGeometry args={[0.36, 0.06, 0.26]} /><meshPhysicalMaterial color="#c9ccd1" metalness={0.3} roughness={0.45} clearcoat={0.4} /></mesh>
        <Button color="#16a34a" pos={[-0.12, 0.04, 0.07]} label="I" onPress={() => act({ m: "start", id: def.id })} />
        <Button color="#dc2626" pos={[-0.05, 0.04, 0.07]} label="O" onPress={() => act({ m: "stop", id: def.id })} />
        <Button color="#2563eb" pos={[0.02, 0.04, 0.07]} label="R" onPress={() => act({ m: "reset", id: def.id })} />
        {/* AUTO / MANUAL key selector */}
        <group position={[0.11, 0.04, 0.07]}>
          <mesh onClick={(e) => { e.stopPropagation(); act({ m: "mode", id: def.id }); }}><cylinderGeometry args={[0.026, 0.026, 0.02, 24]} /><meshStandardMaterial color="#111827" roughness={0.4} /></mesh>
          <mesh ref={key} position={[0, 0.018, 0]}><boxGeometry args={[0.044, 0.016, 0.01]} /><meshStandardMaterial color="#d1d5db" metalness={0.8} roughness={0.3} /></mesh>
        </group>
        {/* E-stop: red mushroom on a yellow plate (always allowed, no ownership check) */}
        <mesh position={[0, 0.032, -0.07]}><boxGeometry args={[0.1, 0.004, 0.09]} /><meshStandardMaterial color="#facc15" roughness={0.5} /></mesh>
        <group position={[0, 0.05, -0.07]}>
          <mesh onClick={(e) => { e.stopPropagation(); act({ m: "estop", id: def.id }, true); }}><sphereGeometry args={[0.035, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2]} /><meshPhysicalMaterial color="#e11d1d" roughness={0.25} clearcoat={1} /></mesh>
          <mesh position={[0, -0.01, 0]}><cylinderGeometry args={[0.018, 0.02, 0.025, 16]} /><meshStandardMaterial color="#1f2937" /></mesh>
        </group>
        <mesh position={[-0.13, 0.04, -0.07]}><sphereGeometry args={[0.018, 16, 12]} /><meshStandardMaterial ref={lamp} toneMapped={false} /></mesh>
      </group>
      {/* handwheel (MPG / pressure valve) on the side: drag left-right to turn */}
      {wheelCtl && (
        <group position={[0.22, 0.9, 0]} rotation={[0, Math.PI / 2, 0]}>
          <group ref={wheel}>
            <mesh onPointerDown={onWheelDown} onPointerMove={onWheelMove} onPointerUp={onWheelUp} onPointerCancel={onWheelUp}><torusGeometry args={[0.11, 0.012, 10, 40]} /><meshStandardMaterial color="#9ca3af" metalness={0.95} roughness={0.2} /></mesh>
            {[0, 1, 2].map((i) => <mesh key={i} rotation={[0, 0, (i * Math.PI * 2) / 3]} position={[0, 0, 0]}><boxGeometry args={[0.22, 0.012, 0.012]} /><meshStandardMaterial color="#9ca3af" metalness={0.95} roughness={0.2} /></mesh>)}
            <mesh position={[0.1, 0, 0.04]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.012, 0.012, 0.07, 12]} /><meshStandardMaterial color="#111827" /></mesh>
          </group>
          <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0, -0.02]}><cylinderGeometry args={[0.025, 0.03, 0.05, 16]} /><meshStandardMaterial color="#4b5563" metalness={0.8} /></mesh>
        </group>
      )}
      <Html position={[0, 1.5, 0]} center zIndexRange={[12, 0]} style={{ pointerEvents: "none" }}>
        <div ref={tag} className="whitespace-nowrap rounded bg-slate-950/80 px-1.5 py-0.5 text-[9px]">{def.id}</div>
      </Html>
    </group>
  );
}
