// Playable factory worker: hard hat (colour by role), hi-vis vest with reflective tape, workwear, safety boots.
// The local player walks with WASD (Shift = faster) relative to the camera, collides with machines, and the camera
// follows; other connected players are drawn from the multiplayer floor with a name / role / machine tag.
import { useEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";
import { MACHINE, MACHINES } from "../twin/registry";
import { useView } from "./context";
import { labelVisible } from "./hud";
import { WorkerBody, type Pose } from "./Humanoid";
import { cameraApi } from "./TwinCanvas";

const tmpW = new THREE.Vector3(), NO_KEYS = new Set<string>();
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
  const ring = useRef<THREE.MeshBasicMaterial>(null), tag = useRef<HTMLDivElement>(null), anchor = useRef<THREE.Group>(null);
  useFrame(({ clock, camera, gl }) => {
    const machine = Object.entries(v.sim.owner).find(([, who]) => who === name)?.[0];
    const faulty = machine && v.sim.machineFaults(machine).length > 0;
    const repairing = Object.values(v.sim.repairs).some((r) => r.by === name);
    ring.current?.color.set(repairing ? "#f59e0b" : faulty ? "#ff1a1a" : machine ? "#22c55e" : "#38bdf8");
    if (ring.current) ring.current.opacity = faulty ? 0.5 + 0.5 * Math.sin(clock.elapsedTime * 8) : 0.8;
    if (tag.current) {
      tag.current.textContent = `${self ? "You" : name}${repairing ? " · 🔧 repairing" : machine ? ` · operating ${machine}${faulty ? " ⚠" : ""}` : ""}`;
      tag.current.style.borderColor = repairing ? "#f59e0b" : faulty ? "#ff1a1a" : machine ? "#22c55e" : "#38bdf8";
      const wanted = !self || v.walk || !!machine || repairing;               // your own tag only when it says something
      tag.current.style.display = wanted && anchor.current && labelVisible(anchor.current.getWorldPosition(tmpW), camera, gl.domElement) ? "block" : "none";
    }
  });
  return (
    <>
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.012, 0]}><ringGeometry args={[0.38, 0.47, 40]} /><meshBasicMaterial ref={ring} transparent toneMapped={false} /></mesh>
      <group ref={anchor} position={[0, 2.15, 0]} />
      <Html position={[0, 2.15, 0]} center zIndexRange={[15, 0]} style={{ pointerEvents: "none" }}>
        <div ref={tag} className="whitespace-nowrap border-l-2 rounded-[3px] border border-white/10 bg-[#141820]/90 px-1.5 py-0.5 text-[10px] text-[#e6eaf0] shadow-sm backdrop-blur" />
      </Html>
    </>
  );
}

export function LocalWorker() {
  const v = useView();
  const g = useRef<THREE.Group>(null);
  const pose = useRef<Pose>({ walk: 0, speed: 0, work: 0 });
  const keys = useRef(new Set<string>());
  useEffect(() => {
    const down = (e: KeyboardEvent) => { if (!(e.target as HTMLElement).closest?.("input, select, textarea")) keys.current.add(e.key.toLowerCase()); };
    const up = (e: KeyboardEvent) => keys.current.delete(e.key.toLowerCase());
    const blur = () => keys.current.clear();
    window.addEventListener("keydown", down); window.addEventListener("keyup", up); window.addEventListener("blur", blur);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); window.removeEventListener("blur", blur); };
  }, []);
  useFrame((_, dt) => {
    if (!g.current) return;
    const k = v.walk ? keys.current : NO_KEYS, c = cameraApi.controls;   // keys only in worker mode; click-to-walk / claims always
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
      if (v.walk && !v.fp) c?.moveTo(player.x, 1.2, player.z, false);   // camera follows, the user can still orbit with the mouse
    }
    if (v.fp && c) {                                     // first person: the camera orbits a few cm around the eye = mouse look
      c.moveTo(player.x, 1.7, player.z, false);
      player.yaw = az + Math.PI;
    }
    player.speed = speed;
    pose.current.walk += dt * speed * 4.5;                // stride ~1.4 m per gait cycle
    pose.current.speed += (speed - pose.current.speed) * Math.min(1, dt * 8);
    const mine = Object.entries(v.sim.owner).find(([, who]) => who === v.floor.myName)?.[0];
    const atPanel = mine && Math.hypot(player.x - (MACHINE[mine].position[0] + MACHINE[mine].size[0] / 2 + 0.55), player.z - (MACHINE[mine].position[2] + MACHINE[mine].size[2] / 2 + 0.1)) < 1.3;
    const busy = atPanel || Object.values(v.sim.repairs).some((r) => r.by === v.floor.myName);
    pose.current.work += ((busy ? 1 : 0) - pose.current.work) * Math.min(1, dt * 4);
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
    <group ref={g} visible={!v.fp}>
      <WorkerBody hat={HAT[v.floor.me?.role ?? "technician"]} pose={pose} />
      {!v.fp && <Status name={v.floor.myName} self />}
    </group>
    </>
  );
}

function RemoteWorker({ id }: { id: string }) {
  const v = useView();
  const g = useRef<THREE.Group>(null);
  const pose = useRef<Pose>({ walk: 0, speed: 0, work: 0 });
  const p = v.floor.players.get(id)!;
  useFrame((_, dt) => {
    const cur = v.floor.players.get(id);
    if (!g.current || !cur) return;
    const o = g.current.position, d = Math.hypot(cur.x - o.x, cur.z - o.z);
    o.x += (cur.x - o.x) * Math.min(1, dt * 8); o.z += (cur.z - o.z) * Math.min(1, dt * 8);
    g.current.rotation.y = cur.yaw;
    const sp = dt > 0 ? (d * Math.min(1, dt * 8)) / dt : 0;
    pose.current.speed += (sp - pose.current.speed) * Math.min(1, dt * 6);
    pose.current.walk += dt * pose.current.speed * 4.5;
    const busy = Object.values(v.sim.repairs).some((r) => r.by === cur.name) || (pose.current.speed < 0.1 && Object.values(v.sim.owner).includes(cur.name));
    pose.current.work += ((busy ? 1 : 0) - pose.current.work) * Math.min(1, dt * 4);
  });
  return (
    <group ref={g} position={[p.x, 0, p.z]}>
      <WorkerBody hat={HAT[p.role] ?? HAT.operator} pose={pose} />
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
