// T08 / T11 - the 3D factory: machines, conveyors, buffers, flowing parts, workers, hotspots.
import { useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { CameraControls, ContactShadows, Environment, Html, Instance, Instances } from "@react-three/drei";
import { machineColor } from "./api.js";

const GAP = 4;                       // distance between machines along x
const X0 = -((6 - 1) * GAP) / 2;
const mx = (i) => X0 + i * GAP;

function partTarget(p) {
  if (p.where === "machine") return [mx(p.index) - 0.9 + 1.8 * p.progress, 0.75, 1.1];   // in front of the machine body
  return [mx(p.index) + GAP / 2 - 0.9 + (p.slot % 5) * 0.45, 0.72 + Math.floor(p.slot / 5) * 0.32, 0];
}

function Parts({ parts }) {
  // each part glides towards its latest position: snapshots arrive ~5x/s, the scene renders at 60 fps
  const refs = useRef({});
  const targets = useMemo(() => Object.fromEntries(parts.map((p) => [p.id, partTarget(p)])), [parts]);
  useFrame((_, dt) => {
    for (const [id, obj] of Object.entries(refs.current)) {
      const t = targets[id];
      if (!obj || !t) continue;
      const k = Math.min(1, dt * 8);
      obj.position.x += (t[0] - obj.position.x) * k;
      obj.position.y += (t[1] - obj.position.y) * k;
      obj.position.z += (t[2] - obj.position.z) * k;
    }
  });
  return (
    <Instances limit={400}>
      <boxGeometry args={[0.32, 0.32, 0.32]} />
      <meshStandardMaterial color="#d4ac0d" metalness={0.4} roughness={0.4} />
      {parts.map((p) => (
        <Instance key={p.id} position={partTarget(p)} ref={(o) => { if (o) refs.current[p.id] = o; else delete refs.current[p.id]; }} />
      ))}
    </Instances>
  );
}

function Machine({ m, i, selected, onSelect, alarm }) {
  const color = machineColor(m);
  const pulse = useRef();
  useFrame(({ clock }) => {
    if (pulse.current) pulse.current.emissiveIntensity = alarm ? 0.4 + 0.4 * Math.sin(clock.elapsedTime * 6) : selected ? 0.25 : 0;
  });
  return (
    <group position={[mx(i), 0, 0]}>
      <mesh castShadow position={[0, 0.9, 0]} onClick={(e) => { e.stopPropagation(); onSelect(m.id); }}
            onPointerOver={() => (document.body.style.cursor = "pointer")} onPointerOut={() => (document.body.style.cursor = "")}>
        <boxGeometry args={[2.2, 1.8, 1.8]} />
        <meshStandardMaterial ref={pulse} color={color} emissive={alarm ? "#ff2200" : "#ffffff"} metalness={0.3} roughness={0.5} />
      </mesh>
      <mesh position={[0, 1.95, 0]} castShadow>
        <cylinderGeometry args={[0.25, 0.25, 0.3, 16]} />
        <meshStandardMaterial color="#34495e" />
      </mesh>
      <Html position={[0, 2.8, 0]} center distanceFactor={12}>
        <button className={`hotspot ${alarm ? "alarm" : ""} ${selected ? "sel" : ""}`} style={{ background: color }}
                onClick={() => onSelect(m.id)} title={`${m.id} - ${m.status}`}>
          {m.id}{m.worker ? " 🔧" : ""}{alarm ? " ⚠" : ""}
        </button>
      </Html>
    </group>
  );
}

function Conveyors({ buffers }) {
  return buffers.map((b) => (
    <group key={b.index} position={[mx(b.index) + GAP / 2, 0, 0]}>
      <mesh receiveShadow position={[0, 0.5, 0]}>
        <boxGeometry args={[GAP - 2.2, 0.12, 0.9]} />
        <meshStandardMaterial color="#2c3e50" metalness={0.6} roughness={0.3} />
      </mesh>
      <Html position={[0, 0.15, 0.75]} center distanceFactor={14}>
        <span className="buffer-label">{b.level}/{b.capacity}</span>
      </Html>
    </group>
  ));
}

const SKILL_COLOR = { mechanic: "#E8892B", electrician: "#8E44AD", technician: "#16a085" };

function Workers({ workers }) {
  const refs = useRef({});
  useFrame((_, dt) => {
    for (const w of workers) {
      const o = refs.current[w.id];
      if (o) o.position.x += (mx(w.pos) - o.position.x) * Math.min(1, dt * 5);
    }
  });
  return workers.map((w, k) => (
    <group key={w.id} ref={(o) => (refs.current[w.id] = o)} position={[mx(w.pos), 0, 2 + k * 0.6]}>
      <mesh castShadow position={[0, 0.7, 0]}>
        <capsuleGeometry args={[0.22, 0.8, 4, 12]} />
        <meshStandardMaterial color={SKILL_COLOR[w.skill] ?? "#aaa"} />
      </mesh>
      <mesh position={[0, 1.4, 0]}>
        <sphereGeometry args={[0.2, 16, 16]} />
        <meshStandardMaterial color="#f5cba7" />
      </mesh>
      <Html position={[0, 1.9, 0]} center distanceFactor={14}>
        <span className="worker-label">{w.id}{w.task ? ` · ${w.task.phase}` : ""}</span>
      </Html>
    </group>
  ));
}

export default function Factory3D({ snapshot, selected, onSelect, alarms, station }) {
  const cam = useRef();
  useEffect(() => {
    if (!cam.current) return;
    if (station == null) cam.current.setLookAt(0, 11, 17, 0, 0.5, 0, true);
    else cam.current.setLookAt(mx(station) + 2.5, 4, 7, mx(station), 1, 0, true);
  }, [station]);
  const machines = snapshot?.machines ?? [];
  return (
    <Canvas shadows camera={{ position: [0, 11, 17], fov: 45 }} onPointerMissed={() => onSelect(null)}>
      <color attach="background" args={["#1b2631"]} />
      <hemisphereLight intensity={0.5} />
      <directionalLight position={[8, 14, 6]} intensity={1.2} castShadow shadow-mapSize={[1024, 1024]} />
      <Environment preset="warehouse" />
      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        <planeGeometry args={[60, 30]} />
        <meshStandardMaterial color="#566573" />
      </mesh>
      <ContactShadows position={[0, 0.01, 0]} opacity={0.5} scale={40} blur={2} far={4} />
      {machines.map((m, i) => (
        <Machine key={m.id} m={m} i={i} selected={selected === m.id} onSelect={onSelect} alarm={alarms.has(m.id)} />
      ))}
      <Conveyors buffers={snapshot?.buffers ?? []} />
      <Parts parts={snapshot?.parts ?? []} />
      <Workers workers={snapshot?.workers ?? []} />
      <CameraControls ref={cam} maxPolarAngle={Math.PI / 2.1} minDistance={4} maxDistance={45} />
    </Canvas>
  );
}
