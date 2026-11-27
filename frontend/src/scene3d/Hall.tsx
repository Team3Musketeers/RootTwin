// Factory hall: reflective epoxy floor with markings, steel columns & roof trusses, light fixtures, cable trays,
// walls, high-bay racks, safety fences, catwalk. Repetitive elements are instanced (drei <Instances> = InstancedMesh).
import { useMemo } from "react";
import { Instance, Instances, Line, MeshReflectorMaterial } from "@react-three/drei";
import { AGV_PATH, HALL, RACK } from "../twin/layout";

const W = HALL.x1 - HALL.x0, D = HALL.z1 - HALL.z0, CX = (HALL.x0 + HALL.x1) / 2, CZ = (HALL.z0 + HALL.z1) / 2;

function Floor({ quality }: { quality: boolean }) {
  const agvLoop = useMemo(() => [...AGV_PATH, AGV_PATH[0]].map(([x, z]) => [x, 0.012, z] as [number, number, number]), []);
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position={[CX, 0, CZ]} receiveShadow>
        <planeGeometry args={[W, D]} />
        {quality
          ? <MeshReflectorMaterial resolution={512} mixBlur={1} mixStrength={2.2} blur={[300, 80]} roughness={0.75} depthScale={0.4}
                                   minDepthThreshold={0.4} maxDepthThreshold={1.2} color="#3a4250" metalness={0.35} mirror={0.35} />
          : <meshStandardMaterial color="#3a4250" roughness={0.6} metalness={0.2} />}
      </mesh>
      {/* walkway lines and AGV guide path */}
      {[-4.2, 4.2].map((z) => (
        <mesh key={z} rotation-x={-Math.PI / 2} position={[-5, 0.008, z]}><planeGeometry args={[58, 0.12]} /><meshBasicMaterial color="#facc15" /></mesh>
      ))}
      <Line points={agvLoop} color="#22d3ee" lineWidth={2} dashed dashSize={0.6} gapSize={0.4} transparent opacity={0.6} />
    </group>
  );
}

function Structure() {
  const cols = useMemo(() => {
    const out: [number, number, number][] = [];
    for (let x = HALL.x0; x <= HALL.x1 + 0.1; x += 10) for (const z of [HALL.z0 + 0.3, HALL.z1 - 0.3]) out.push([x, HALL.height / 2, z]);
    return out;
  }, []);
  const trussX = useMemo(() => cols.filter((_, i) => i % 2 === 0).map((c) => c[0]), [cols]);
  const lights = useMemo(() => {
    const out: [number, number, number][] = [];
    for (let x = HALL.x0 + 5; x < HALL.x1; x += 10) for (let z = HALL.z0 + 5; z < HALL.z1; z += 7) out.push([x, HALL.height - 1.6, z]);
    return out;
  }, []);
  return (
    <group>
      <Instances limit={64} castShadow>
        <boxGeometry args={[0.45, HALL.height, 0.45]} />
        <meshStandardMaterial color="#1e3a8a" metalness={0.6} roughness={0.4} />
        {cols.map((p, i) => <Instance key={i} position={p} />)}
      </Instances>
      {/* roof trusses: top & bottom chords + verticals */}
      <Instances limit={400}>
        <boxGeometry args={[0.16, 0.16, 1]} />
        <meshStandardMaterial color="#64748b" metalness={0.7} roughness={0.35} />
        {trussX.flatMap((x) => [
          <Instance key={`t${x}`} position={[x, HALL.height - 0.2, CZ]} scale={[1, 1, D]} />,
          <Instance key={`b${x}`} position={[x, HALL.height - 1.3, CZ]} scale={[1, 1, D]} />,
          ...Array.from({ length: 16 }, (_, i) => (
            <Instance key={`v${x}${i}`} position={[x, HALL.height - 0.75, HALL.z0 + 1 + i * 2]} scale={[1, 6.8, 0.6]} rotation={[0, 0, 0]} />)),
        ])}
        {/* purlins along x */}
        {Array.from({ length: 9 }, (_, i) => (
          <Instance key={`p${i}`} position={[CX, HALL.height - 0.1, HALL.z0 + 1.5 + i * 3.6]} rotation={[0, Math.PI / 2, 0]} scale={[1, 1, W]} />))}
      </Instances>
      {/* LED high-bay fixtures */}
      <Instances limit={64}>
        <boxGeometry args={[1.4, 0.1, 0.35]} />
        <meshStandardMaterial color="#f8fafc" emissive="#fff7e6" emissiveIntensity={2.2} toneMapped={false} />
        {lights.map((p, i) => <Instance key={i} position={p} />)}
      </Instances>
      {/* cable trays along the line */}
      {[-4.6, 4.6].map((z) => (
        <group key={z}>
          <mesh position={[-4, 6.2, z]}><boxGeometry args={[62, 0.1, 0.5]} /><meshStandardMaterial color="#94a3b8" metalness={0.8} roughness={0.3} /></mesh>
          <Instances limit={32}>
            <boxGeometry args={[0.05, HALL.height - 6.3, 0.05]} />
            <meshStandardMaterial color="#64748b" />
            {Array.from({ length: 16 }, (_, i) => <Instance key={i} position={[-34 + i * 4, 6.2 + (HALL.height - 6.3) / 2, z]} />)}
          </Instances>
        </group>
      ))}
      {/* walls: back and left only, so the cameras keep an open view */}
      <mesh position={[CX, HALL.height / 2, HALL.z0]} receiveShadow><boxGeometry args={[W, HALL.height, 0.2]} /><meshStandardMaterial color="#cbd5e1" roughness={0.8} /></mesh>
      <mesh position={[CX, HALL.height - 2.4, HALL.z0 + 0.12]}><boxGeometry args={[W - 4, 1.2, 0.05]} /><meshStandardMaterial color="#e0f2fe" emissive="#bae6fd" emissiveIntensity={0.6} /></mesh>
      <mesh position={[HALL.x0, HALL.height / 2, CZ]} receiveShadow><boxGeometry args={[0.2, HALL.height, D]} /><meshStandardMaterial color="#cbd5e1" roughness={0.8} /></mesh>
    </group>
  );
}

function Racks() {
  const { uprights, beams, loads } = useMemo(() => {
    const uprights: [number, number, number][] = [], beams: [number, number, number][] = [], loads: [number, number, number][] = [];
    const H = RACK.levels * RACK.level + 0.4;
    for (const x of RACK.xs) {
      for (let b = 0; b <= RACK.bays; b++) for (const dx of [-RACK.depth / 2, RACK.depth / 2]) uprights.push([x + dx, H / 2, RACK.z0 + b * RACK.bay]);
      for (let b = 0; b < RACK.bays; b++) for (let l = 0; l < RACK.levels; l++) {
        const z = RACK.z0 + (b + 0.5) * RACK.bay, y = 0.25 + l * RACK.level;
        for (const dx of [-RACK.depth / 2, RACK.depth / 2]) beams.push([x + dx, y, z]);
        if ((b * 7 + l * 3 + Math.round(x)) % 5 !== 0) loads.push([x, y + 0.55, z]);       // ~80 % occupied, deterministic
      }
    }
    return { uprights, beams, loads };
  }, []);
  return (
    <group>
      <Instances limit={256} castShadow>
        <boxGeometry args={[0.1, RACK.levels * RACK.level + 0.4, 0.1]} />
        <meshStandardMaterial color="#1d4ed8" metalness={0.5} roughness={0.4} />
        {uprights.map((p, i) => <Instance key={i} position={p} />)}
      </Instances>
      <Instances limit={256}>
        <boxGeometry args={[0.08, 0.12, RACK.bay]} />
        <meshStandardMaterial color="#f97316" metalness={0.4} roughness={0.5} />
        {beams.map((p, i) => <Instance key={i} position={p} />)}
      </Instances>
      <Instances limit={128} castShadow>
        <boxGeometry args={[1.0, 1.0, 1.9]} />
        <meshStandardMaterial color="#a16207" roughness={0.9} />
        {loads.map((p, i) => <Instance key={i} position={p} />)}
      </Instances>
    </group>
  );
}

// safety fence: posts + mesh panels, as runs of [x0,z0,x1,z1]
const FENCES: [number, number, number, number][] = [
  [10.6, -3.8, 17.4, -3.8], [10.6, 3.8, 17.4, 3.8], [10.6, -3.8, 10.6, -0.8], [10.6, 0.8, 10.6, 3.8], [17.4, -3.8, 17.4, -0.8], [17.4, 0.8, 17.4, 3.8],
  // palletizing cell: AGV gates between x 26.2 and 28.2 (front and back), conveyor opening at x 20.8
  [20.8, -4.6, 26.2, -4.6], [28.2, -4.6, 28.2, 2.2], [20.8, 2.2, 26.2, 2.2], [20.8, -4.6, 20.8, -0.8], [20.8, 0.8, 20.8, 2.2],
];
function Fences() {
  const { posts, panels } = useMemo(() => {
    const posts: [number, number, number][] = [], panels: { p: [number, number, number]; len: number; yaw: number }[] = [];
    for (const [x0, z0, x1, z1] of FENCES) {
      const len = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.round(len / 1.4)), yaw = Math.atan2(-(z1 - z0), x1 - x0);
      for (let i = 0; i <= n; i++) posts.push([x0 + ((x1 - x0) * i) / n, 1.1, z0 + ((z1 - z0) * i) / n]);
      for (let i = 0; i < n; i++) panels.push({ p: [x0 + ((x1 - x0) * (i + 0.5)) / n, 1.15, z0 + ((z1 - z0) * (i + 0.5)) / n], len: len / n - 0.08, yaw });
    }
    return { posts, panels };
  }, []);
  return (
    <group>
      <Instances limit={128}>
        <boxGeometry args={[0.06, 2.2, 0.06]} />
        <meshStandardMaterial color="#facc15" metalness={0.3} />
        {posts.map((p, i) => <Instance key={i} position={p} />)}
      </Instances>
      <Instances limit={128}>
        <boxGeometry args={[1, 1.9, 0.02]} />
        <meshStandardMaterial color="#a3e635" transparent opacity={0.45} metalness={0.2} roughness={0.6} />
        {panels.map((x, i) => <Instance key={i} position={x.p} rotation={[0, x.yaw, 0]} scale={[x.len, 1, 1]} />)}
      </Instances>
    </group>
  );
}

function Catwalk() {
  const x0 = -12, x1 = 8, z = -6.2, y = 3.6;
  return (
    <group>
      <mesh position={[(x0 + x1) / 2, y, z]} castShadow receiveShadow><boxGeometry args={[x1 - x0, 0.08, 1.4]} /><meshStandardMaterial color="#475569" metalness={0.6} roughness={0.5} /></mesh>
      <Instances limit={64}>
        <boxGeometry args={[0.08, 1, 0.08]} />
        <meshStandardMaterial color="#facc15" />
        {Array.from({ length: 11 }, (_, i) => [-0.68, 0.68].map((dz) => <Instance key={`${i}${dz}`} position={[x0 + i * 2, y + 0.5, z + dz]} />))}
        {Array.from({ length: 6 }, (_, i) => [-0.65, 0.65].map((dz) => <Instance key={`s${i}${dz}`} position={[x0 + i * 4, y / 2, z + dz]} scale={[1.5, y, 1.5]} />))}
      </Instances>
      {[-0.68, 0.68].map((dz) => (
        <mesh key={dz} position={[(x0 + x1) / 2, y + 1, z + dz]}><boxGeometry args={[x1 - x0, 0.06, 0.06]} /><meshStandardMaterial color="#facc15" /></mesh>
      ))}
      {/* stairs */}
      <mesh position={[x1 + 1.6, y / 2, z]} rotation={[0, 0, -Math.atan2(y, 3.2)]}><boxGeometry args={[Math.hypot(3.2, y), 0.1, 1.1]} /><meshStandardMaterial color="#475569" metalness={0.6} /></mesh>
    </group>
  );
}

export function Hall({ quality, structures }: { quality: boolean; structures: boolean }) {
  return (
    <group>
      <Floor quality={quality} />
      <group visible={structures}>
        <Structure />
        <Racks />
        <Fences />
        <Catwalk />
      </group>
    </group>
  );
}
