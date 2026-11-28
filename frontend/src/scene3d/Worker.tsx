// Playable factory worker: hard hat (colour by role), hi-vis vest with reflective tape, workwear, safety boots.
// The local player walks with WASD (Shift = faster) relative to the camera, collides with machines, and the camera
// follows; other connected players are drawn from the multiplayer floor with a name / role / machine tag.
import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";
import { MACHINES } from "../twin/registry";
import { useView } from "./context";
import { cameraApi } from "./TwinCanvas";

export const HAT: Record<string, string> = { operator: "#facc15", technician: "#2563eb", maintenance: "#f97316", supervisor: "#f8fafc" };

/** Local player state (read by the HUD and the control stations for the reach check). */
export const player = { x: -14, z: 6.2, yaw: Math.PI, speed: 0, goal: null as { x: number; z: number } | null };

// machine footprints (world AABB, rotation ignored: all machines are axis-aligned) the worker cannot walk through
const OBSTACLES = MACHINES.filter((m) => m.type !== "agv" && m.id !== "CNV").map((m) => ({
  x0: m.position[0] - m.size[0] / 2, x1: m.position[0] + m.size[0] / 2, z0: m.position[2] - m.size[2] / 2, z1: m.position[2] + m.size[2] / 2,
}));
const R = 0.32;   // body radius
export function blocked(x: number, z: number) {
  return OBSTACLES.some((o) => x > o.x0 - R && x < o.x1 + R && z > o.z0 - R && z < o.z1 + R);
}

/** Ground ring + floating tag showing what a worker is doing: blue idle, green operating, pulsing red if their machine is faulted. */
function Status({ name, self }: { name: string; self?: boolean }) {
  const v = useView();
  const ring = useRef<THREE.MeshBasicMaterial>(null), tag = useRef<HTMLDivElement>(null);
  useFrame(({ clock }) => {
    const machine = Object.entries(v.sim.owner).find(([, who]) => who === name)?.[0];
    const faulty = machine && v.sim.machineFaults(machine).length > 0;
    const repairing = Object.values(v.sim.repairs).some((r) => r.by === name);
    ring.current?.color.set(repairing ? "#f59e0b" : faulty ? "#ff1a1a" : machine ? "#22c55e" : "#38bdf8");
    if (ring.current) ring.current.opacity = faulty ? 0.5 + 0.5 * Math.sin(clock.elapsedTime * 8) : 0.8;
    if (tag.current) {
      tag.current.textContent = `${self ? "You" : name}${repairing ? " · 🔧 repairing" : machine ? ` · operating ${machine}${faulty ? " ⚠" : ""}` : ""}`;
      tag.current.style.borderColor = repairing ? "#f59e0b" : faulty ? "#ff1a1a" : machine ? "#22c55e" : "#38bdf8";
    }
  });
  return (
    <>
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.012, 0]}><ringGeometry args={[0.38, 0.47, 40]} /><meshBasicMaterial ref={ring} transparent toneMapped={false} /></mesh>
      <Html position={[0, 2.15, 0]} center zIndexRange={[15, 0]} style={{ pointerEvents: "none" }}>
        <div ref={tag} className="whitespace-nowrap rounded border-l-2 bg-slate-950/85 px-1.5 py-0.5 text-[10px] text-white shadow" />
      </Html>
    </>
  );
}

function Body({ hat, walk }: { hat: string; walk: { current: number } }) {
  const legL = useRef<THREE.Group>(null), legR = useRef<THREE.Group>(null), armL = useRef<THREE.Group>(null), armR = useRef<THREE.Group>(null);
  const m = useMemo(() => ({
    wear: new THREE.MeshStandardMaterial({ color: "#1e3a5f", roughness: 0.85 }),
    vest: new THREE.MeshStandardMaterial({ color: "#d4ff1e", emissive: "#a3e635", emissiveIntensity: 0.25, roughness: 0.7 }),
    tape: new THREE.MeshStandardMaterial({ color: "#e5e7eb", metalness: 0.6, roughness: 0.2, emissive: "#ffffff", emissiveIntensity: 0.15 }),
    skin: new THREE.MeshStandardMaterial({ color: "#c68863", roughness: 0.7 }),
    boot: new THREE.MeshStandardMaterial({ color: "#111827", roughness: 0.6 }),
    hat: new THREE.MeshPhysicalMaterial({ color: hat, roughness: 0.35, clearcoat: 0.8 }),
  }), [hat]);
  useEffect(() => () => Object.values(m).forEach((x) => x.dispose()), [m]);
  useFrame(() => {
    const s = Math.sin(walk.current) * 0.55;
    if (legL.current) legL.current.rotation.x = s;
    if (legR.current) legR.current.rotation.x = -s;
    if (armL.current) armL.current.rotation.x = -s * 0.8;
    if (armR.current) armR.current.rotation.x = s * 0.8;
  });
  const leg = (ref: React.RefObject<THREE.Group>, x: number) => (
    <group ref={ref} position={[x, 0.9, 0]}>
      <mesh position={[0, -0.42, 0]} material={m.wear} castShadow><capsuleGeometry args={[0.075, 0.68, 4, 10]} /></mesh>
      <mesh position={[0, -0.86, 0.04]} material={m.boot} castShadow><boxGeometry args={[0.13, 0.1, 0.27]} /></mesh>
    </group>
  );
  const arm = (ref: React.RefObject<THREE.Group>, x: number) => (
    <group ref={ref} position={[x, 1.42, 0]}>
      <mesh position={[0, -0.3, 0]} material={m.wear} castShadow><capsuleGeometry args={[0.055, 0.48, 4, 10]} /></mesh>
      <mesh position={[0, -0.6, 0]} material={m.skin}><sphereGeometry args={[0.055, 12, 10]} /></mesh>
    </group>
  );
  return (
    <group>
      {leg(legL, -0.1)}{leg(legR, 0.1)}{arm(armL, -0.25)}{arm(armR, 0.25)}
      <mesh position={[0, 1.18, 0]} material={m.vest} castShadow><capsuleGeometry args={[0.19, 0.42, 6, 16]} /></mesh>
      {[1.02, 1.24].map((y) => <mesh key={y} position={[0, y, 0]} material={m.tape}><cylinderGeometry args={[0.197, 0.197, 0.035, 20, 1, true]} /></mesh>)}
      <mesh position={[0, 1.57, 0]} material={m.skin}><cylinderGeometry args={[0.05, 0.06, 0.08, 12]} /></mesh>
      <mesh position={[0, 1.7, 0]} material={m.skin} castShadow><sphereGeometry args={[0.11, 20, 16]} /></mesh>
      {/* hard hat: shell + peak + ridge */}
      <mesh position={[0, 1.75, 0]} material={m.hat} castShadow><sphereGeometry args={[0.13, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2]} /></mesh>
      <mesh position={[0, 1.75, 0.06]} rotation={[-0.1, 0, 0]} material={m.hat}><cylinderGeometry args={[0.15, 0.15, 0.012, 24, 1, false, -Math.PI / 2, Math.PI]} /></mesh>
      <mesh position={[0, 1.86, 0]} rotation={[0, 0, Math.PI / 2]} material={m.hat}><capsuleGeometry args={[0.012, 0.16, 4, 8]} /></mesh>
    </group>
  );
}

export function LocalWorker() {
  const v = useView();
  const g = useRef<THREE.Group>(null);
  const walk = useRef(0);
  const keys = useRef(new Set<string>());
  useEffect(() => {
    const down = (e: KeyboardEvent) => { if (!(e.target as HTMLElement).closest?.("input, select, textarea")) keys.current.add(e.key.toLowerCase()); };
    const up = (e: KeyboardEvent) => keys.current.delete(e.key.toLowerCase());
    const blur = () => keys.current.clear();
    window.addEventListener("keydown", down); window.addEventListener("keyup", up); window.addEventListener("blur", blur);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); window.removeEventListener("blur", blur); };
  }, []);
  useFrame((_, dt) => {
    if (!g.current || !v.walk) return;
    const k = keys.current, c = cameraApi.controls;
    const f = (k.has("w") || k.has("arrowup") ? 1 : 0) - (k.has("s") || k.has("arrowdown") ? 1 : 0);
    const r = (k.has("d") || k.has("arrowright") ? 1 : 0) - (k.has("a") || k.has("arrowleft") ? 1 : 0);
    const az = c?.azimuthAngle ?? 0;
    let dx = -Math.sin(az) * f + Math.cos(az) * r, dz = -Math.cos(az) * f - Math.sin(az) * r;
    if (f || r) player.goal = null;                    // keys override click-to-walk
    else if (player.goal) {
      dx = player.goal.x - player.x; dz = player.goal.z - player.z;
      if (Math.hypot(dx, dz) < 0.15) { player.goal = null; dx = dz = 0; }
    }
    const len = Math.hypot(dx, dz);
    const speed = len ? (k.has("shift") ? 3.4 : 1.6) : 0;
    if (len) {
      dx /= len; dz /= len;
      const step = Math.min(dt, 0.1) * speed;
      const nx = player.x + dx * step, nz = player.z + dz * step;
      const bx = blocked(nx, player.z), bz = blocked(player.x, nz);
      if (!bx) player.x = nx;                            // slide along walls
      if (!bz) player.z = nz;
      if (bx && bz) player.goal = null;                  // walked into a machine: stop
      const target = Math.atan2(dx, dz);
      player.yaw += Math.atan2(Math.sin(target - player.yaw), Math.cos(target - player.yaw)) * Math.min(1, dt * 10);
      if (!v.fp) c?.moveTo(player.x, 1.2, player.z, false);   // camera follows, the user can still orbit with the mouse
    }
    if (v.fp && c) {                                     // first person: the camera orbits a few cm around the eye = mouse look
      c.moveTo(player.x, 1.7, player.z, false);
      player.yaw = az + Math.PI;
    }
    player.speed = speed;
    walk.current += dt * speed * 4.5;
    if (!speed) walk.current *= 0.8;
    g.current.position.set(player.x, 0, player.z);
    g.current.rotation.y = player.yaw;
    v.floor.pose(player.x, player.z, player.yaw);
  });
  return (
    <>
    {v.walk && (                                         // click on the floor to walk there
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.006, 0]} onClick={(e) => { e.stopPropagation(); player.goal = { x: e.point.x, z: e.point.z }; }}>
        <planeGeometry args={[200, 200]} /><meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>)}
    <group ref={g} visible={v.walk && !v.fp}>
      <Body hat={HAT[v.floor.me?.role ?? "technician"]} walk={walk} />
      {v.walk && !v.fp && <Status name={v.floor.myName} self />}
    </group>
    </>
  );
}

function RemoteWorker({ id }: { id: string }) {
  const v = useView();
  const g = useRef<THREE.Group>(null);
  const walk = useRef(0);
  const p = v.floor.players.get(id)!;
  useFrame((_, dt) => {
    const cur = v.floor.players.get(id);
    if (!g.current || !cur) return;
    const o = g.current.position, d = Math.hypot(cur.x - o.x, cur.z - o.z);
    o.x += (cur.x - o.x) * Math.min(1, dt * 8); o.z += (cur.z - o.z) * Math.min(1, dt * 8);
    g.current.rotation.y = cur.yaw;
    walk.current = d > 0.02 ? walk.current + dt * 7 : walk.current * 0.8;
  });
  return (
    <group ref={g} position={[p.x, 0, p.z]}>
      <Body hat={HAT[p.role] ?? HAT.operator} walk={walk} />
      <Status name={p.name} />
    </group>
  );
}

export function Workers() {
  const v = useView();
  return (
    <>
      <LocalWorker />
      {[...v.floor.players.keys()].map((id) => <RemoteWorker key={id} id={id} />)}
    </>
  );
}
