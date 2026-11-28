// Factory hall: concrete floor (wear texture, yellow markings, hazard zones), open-top H-beam columns with floodlights,
// walls, high-bay racks, safety fences, catwalk. Repetitive elements are instanced (drei <Instances> = InstancedMesh).
import { Suspense, useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import { Instance, Instances, Line, MeshReflectorMaterial, useGLTF } from "@react-three/drei";
import { useAssetAvailable } from "./assetLoader";
import { AGV_PATH, HALL, RACK } from "../twin/layout";
import { euroPallet } from "../twin/machines/line";
import { MACHINES } from "../twin/registry";
import type { Shape } from "../twin/types";
import { geometryFor } from "./cad";
import { makeMaterial, realTexture } from "./materials";

/** Scanned PBR set (Poly Haven) when downloaded, else null -> procedural fallback. */
function useScanned(set: string, repeat: number) {
  const [maps, setMaps] = useState<{ map: THREE.Texture; normalMap: THREE.Texture; roughnessMap: THREE.Texture } | null>(null);
  useEffect(() => {
    Promise.all([realTexture(set, "diff", repeat, true), realTexture(set, "nor_gl", repeat), realTexture(set, "rough", repeat)])
      .then(([map, normalMap, roughnessMap]) => map && normalMap && roughnessMap && setMaps({ map, normalMap, roughnessMap }));
  }, [set, repeat]);
  return maps;
}

const W = HALL.x1 - HALL.x0, D = HALL.z1 - HALL.z0, CX = (HALL.x0 + HALL.x1) / 2, CZ = (HALL.z0 + HALL.z1) / 2;

// procedural epoxy: dark resin, aggregate speckle, tyre scuffs and wear patches (tiled across the hall)
function epoxyTexture() {
  const c = document.createElement("canvas"); c.width = c.height = 1024;
  const g = c.getContext("2d")!;
  g.fillStyle = "#2a3039"; g.fillRect(0, 0, 1024, 1024);
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 26000; i++) { const v = 34 + rnd() * 30; g.fillStyle = `rgba(${v},${v + 4},${v + 10},${0.25 + rnd() * 0.35})`; g.fillRect(rnd() * 1024, rnd() * 1024, 1.6, 1.6); }
  for (let i = 0; i < 18; i++) {                 // wear patches
    const x = rnd() * 1024, y = rnd() * 1024, r = 60 + rnd() * 160, gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, "rgba(90,96,104,0.22)"); gr.addColorStop(1, "rgba(90,96,104,0)"); g.fillStyle = gr; g.fillRect(x - r, y - r, 2 * r, 2 * r);
  }
  g.lineCap = "round";
  for (let i = 0; i < 40; i++) {                 // tyre scuffs
    g.strokeStyle = `rgba(8,10,14,${0.12 + rnd() * 0.18})`; g.lineWidth = 3 + rnd() * 6;
    const x = rnd() * 1024, y = rnd() * 1024, a = rnd() * Math.PI;
    g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + Math.cos(a) * 120, y + Math.sin(a) * 40, x + Math.cos(a) * 260, y + Math.sin(a) * 160); g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(W / 8, D / 8); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}
function hazardTexture() {
  const c = document.createElement("canvas"); c.width = c.height = 128;
  const g = c.getContext("2d")!;
  g.fillStyle = "#111"; g.fillRect(0, 0, 128, 128); g.fillStyle = "#facc15";
  for (let i = -128; i < 256; i += 64) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + 32, 0); g.lineTo(i + 160, 128); g.lineTo(i + 128, 128); g.fill(); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
// hazard-striped keep-out borders [cx, cz, w, d] around the press, welding cell and palletizer
const HAZARD: [number, number, number, number][] = [[-1, 0, 4.6, 5.2], [14, 0, 7.4, 8.2], [24.5, -1.2, 7.8, 7.4]];

function Floor({ quality }: { quality: boolean }) {
  const epoxy = useMemo(epoxyTexture, []);
  const concrete = useScanned("hangar_concrete_floor", W / 4);       // scanned hangar concrete, sealed dark
  const strips = useMemo(() => {             // each border strip gets its own texture clone so the stripe repeat follows its length
    const base = hazardTexture();
    return HAZARD.flatMap(([cx, cz, w, d]) => [[cx, cz - d / 2, w, 0], [cx, cz + d / 2, w, 0], [cx - w / 2, cz, d, Math.PI / 2], [cx + w / 2, cz, d, Math.PI / 2]].map(([x, z, len, rot]) => {
      const tex = base.clone(); tex.repeat.set(len / 0.6, 1); tex.needsUpdate = true;
      return { x, z, a: len, b: 0.16, rot, tex };
    }));
  }, []);
  const agvLoop = useMemo(() => [...AGV_PATH, AGV_PATH[0]].map(([x, z]) => [x, 0.012, z] as [number, number, number]), []);
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position={[CX, 0, CZ]} receiveShadow>
        <planeGeometry args={[W, D]} />
        {quality
          ? <MeshReflectorMaterial resolution={1024} mixBlur={1.2} mixStrength={1.1} blur={[400, 120]} roughness={0.68} depthScale={0.5}
                                   minDepthThreshold={0.3} maxDepthThreshold={1.3} {...(concrete ?? { map: epoxy })} color={concrete ? "#a8adb3" : "#b9c0c8"} metalness={0.05} mirror={0.22} key={concrete ? "c" : "e"} />
          : <meshStandardMaterial {...(concrete ?? { map: epoxy })} color={concrete ? "#a8adb3" : "#b9c0c8"} roughness={0.6} metalness={0.05} key={concrete ? "c" : "e"} />}
      </mesh>
      {/* walkway lines and AGV guide path */}
      {[-4.2, 4.2].map((z) => (
        <mesh key={z} rotation-x={-Math.PI / 2} position={[-5, 0.008, z]}><planeGeometry args={[58, 0.12]} /><meshBasicMaterial color="#facc15" /></mesh>
      ))}
      {strips.map(({ x, z, a, b, rot, tex }, i) => (
        <mesh key={i} rotation={[-Math.PI / 2, 0, rot]} position={[x, 0.009, z]}>
          <planeGeometry args={[a, b]} /><meshStandardMaterial map={tex} roughness={0.7} polygonOffset polygonOffsetFactor={-2} />
        </mesh>))}
      <Line points={agvLoop} color="#22d3ee" lineWidth={2} dashed dashSize={0.6} gapSize={0.4} transparent opacity={0.6} />
    </group>
  );
}

// column: H section 0.4 x 0.4 m extruded to the hall height; base plate; bracket and LED floodlight
const colGeo = {
  h: geometryFor({ kind: "extrude", outline: [[-0.2, -0.2], [0.2, -0.2], [0.2, -0.17], [0.02, -0.17], [0.02, 0.17], [0.2, 0.17], [0.2, 0.2], [-0.2, 0.2], [-0.2, 0.17], [-0.02, 0.17], [-0.02, -0.17], [-0.2, -0.17]], depth: HALL.height, bevel: 0.004 }).clone().rotateX(-Math.PI / 2).translate(0, HALL.height / 2, 0),   // extrusions are centred
  plate: geometryFor({ kind: "compound", items: [{ shape: { kind: "rbox", size: [0.7, 0.04, 0.7], r: 0.01 } }, ...[-0.27, 0.27].flatMap((x) => [-0.27, 0.27].map((z) => ({ shape: { kind: "cyl", r: 0.02, h: 0.06, seg: 8 } as Shape, pos: [x, 0.03, z] as [number, number, number] })))] }),
  bracket: geometryFor({ kind: "rbox", size: [0.08, 0.08, 0.9], r: 0.01 }),
  lamp: geometryFor({ kind: "compound", items: [{ shape: { kind: "rbox", size: [0.6, 0.08, 0.4], r: 0.02 } }, ...Array.from({ length: 6 }, (_, i) => ({ shape: { kind: "rbox", size: [0.012, 0.05, 0.36], r: 0.003 } as Shape, pos: [-0.25 + i * 0.1, 0.06, 0] as [number, number, number] }))] }),
};
const colMat = {
  steel: makeMaterial("paintBlue", "#3b4a66"), plate: makeMaterial("castIron"),
  lamp: new THREE.MeshStandardMaterial({ color: "#f8fafc", emissive: "#fff3dc", emissiveIntensity: 2.4, toneMapped: false, roughness: 0.3 }),
};

function Structure() {
  const iron = useScanned("corrugated_iron", 6);                   // cladding on the back and left walls
  const cols = useMemo(() => {
    const out: [number, number, number][] = [];
    for (let x = HALL.x0; x <= HALL.x1 + 0.1; x += 10) for (const z of [HALL.z0 + 0.3, HALL.z1 - 0.3]) out.push([x, HALL.height / 2, z]);
    return out;
  }, []);
  return (
    <group>
      {/* HEA 400 steel columns (H section) on base plates */}
      <Instances limit={64} castShadow receiveShadow geometry={colGeo.h} material={colMat.steel}>
        {cols.map(([x, , z], i) => <Instance key={i} position={[x, 0, z]} />)}
      </Instances>
      <Instances limit={64} receiveShadow geometry={colGeo.plate} material={colMat.plate}>
        {cols.map(([x, , z], i) => <Instance key={i} position={[x, 0.02, z]} />)}
      </Instances>
      {/* LED floodlights on column brackets, aimed at the line (open-top hall: nothing hangs in the air) */}
      <Instances limit={64} geometry={colGeo.bracket} material={colMat.steel}>
        {cols.map(([x, , z], i) => <Instance key={i} position={[x, 7.6, z - Math.sign(z) * 0.55]} />)}
      </Instances>
      <Instances limit={64} geometry={colGeo.lamp} material={colMat.lamp}>
        {cols.map(([x, , z], i) => <Instance key={i} position={[x, 7.45, z - Math.sign(z) * 0.95]} rotation={[Math.sign(z) * 0.5, 0, 0]} />)}
      </Instances>
      {/* walls: back and left only, so the cameras keep an open view */}
      <mesh position={[CX, HALL.height / 2, HALL.z0]} receiveShadow><boxGeometry args={[W, HALL.height, 0.2]} /><meshStandardMaterial {...(iron ?? {})} color="#cbd5e1" roughness={0.8} metalness={iron ? 0.5 : 0} key={iron ? "i" : "p"} /></mesh>
      <mesh position={[CX, HALL.height - 2.4, HALL.z0 + 0.12]}><boxGeometry args={[W - 4, 1.2, 0.05]} /><meshStandardMaterial color="#e0f2fe" emissive="#bae6fd" emissiveIntensity={0.6} /></mesh>
      <mesh position={[HALL.x0, HALL.height / 2, CZ]} receiveShadow><boxGeometry args={[0.2, HALL.height, D]} /><meshStandardMaterial {...(iron ?? {})} color="#cbd5e1" roughness={0.8} metalness={iron ? 0.5 : 0} key={iron ? "i" : "p"} /></mesh>
    </group>
  );
}

const loadGeo = { pallet: geometryFor(euroPallet), carton: geometryFor({ kind: "rbox", size: [1.14, 0.9, 0.78], r: 0.03 }) };
const loadMat = { pallet: makeMaterial("wood"), carton: makeMaterial("wood", "#c49a6c") };

function Racks() {
  const { uprights, beams, loads } = useMemo(() => {
    const uprights: [number, number, number][] = [], beams: [number, number, number][] = [], loads: [number, number, number][] = [];
    const H = RACK.levels * RACK.level + 0.4;
    for (const x of RACK.xs) {
      for (let b = 0; b <= RACK.bays; b++) for (const dx of [-RACK.depth / 2, RACK.depth / 2]) uprights.push([x + dx, H / 2, RACK.z0 + b * RACK.bay]);
      for (let b = 0; b < RACK.bays; b++) for (let l = 0; l < RACK.levels; l++) {
        const z = RACK.z0 + (b + 0.5) * RACK.bay, y = 0.25 + l * RACK.level;
        for (const dx of [-RACK.depth / 2, RACK.depth / 2]) beams.push([x + dx, y, z]);
        if ((b * 7 + l * 3 + Math.round(x)) % 5 !== 0) loads.push([x, y + 0.06, z]);       // ~80 % occupied, deterministic
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
      {/* Euro pallet (rotated: 1.2 m deep) + stretch-wrapped cartons */}
      <Instances limit={128} castShadow geometry={loadGeo.pallet} material={loadMat.pallet}>
        {loads.map((p, i) => <Instance key={i} position={p} rotation={[0, Math.PI / 2, 0]} />)}
      </Instances>
      <Instances limit={128} castShadow geometry={loadGeo.carton} material={loadMat.carton}>
        {loads.map((p, i) => { const h = 0.8 + ((i * 37) % 5) / 10; return <Instance key={i} position={[p[0], p[1] + 0.15 + 0.45 * h, p[2]]} rotation={[0, Math.PI / 2, 0]} scale={[1, h, 1]} />; })}
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
/** Real welded-mesh guarding panel ("Wire Mesh Panels" by GameDevMoot, CC BY 4.0), normalised to 1 m wide, 1 m high,
 *  base at y = 0, centred; each fence bay scales it to its length and to 1.9 m height. */
const FENCE_URL = "/models/sketchfab/fence/fence.glb";
function MeshPanels({ panels }: { panels: { p: [number, number, number]; len: number; yaw: number }[] }) {
  const { scene } = useGLTF(FENCE_URL, false, true);
  const { geometry, material } = useMemo(() => {
    scene.updateMatrixWorld(true);
    let mesh: THREE.Mesh | undefined;
    scene.traverse((o) => { if (!mesh && (o as THREE.Mesh).isMesh && /Large/i.test(o.name + (o.parent?.name ?? ""))) mesh = o as THREE.Mesh; });
    scene.traverse((o) => { if (!mesh && (o as THREE.Mesh).isMesh) mesh = o as THREE.Mesh; });
    const g = mesh!.geometry.clone().applyMatrix4(mesh!.matrixWorld);
    // stand the panel up: thinnest axis -> z (panel normal), then the longer remaining axis -> x (width)
    const dims = () => { g.computeBoundingBox(); return g.boundingBox!.getSize(new THREE.Vector3()); };
    let d = dims();
    if (d.y < d.x && d.y < d.z) { g.rotateX(Math.PI / 2); d = dims(); }
    if (d.x < d.y && d.x < d.z) { g.rotateY(Math.PI / 2); d = dims(); }
    g.computeBoundingBox();
    const b2 = g.boundingBox!, s2 = b2.getSize(new THREE.Vector3()), c = b2.getCenter(new THREE.Vector3());
    g.translate(-c.x, -b2.min.y, -c.z).scale(1 / s2.x, 1 / s2.y, 1);
    return { geometry: g, material: mesh!.material as THREE.Material };
  }, [scene]);
  return (
    <Instances limit={128} geometry={geometry} material={material} castShadow frustumCulled={false}>
      {panels.map((x, i) => <Instance key={i} position={[x.p[0], 0.08, x.p[2]]} rotation={[0, x.yaw, 0]} scale={[x.len, 1.95, 1]} />)}
    </Instances>
  );
}

function Fences() {
  const real = useAssetAvailable(FENCE_URL);
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
      <Instances limit={128} frustumCulled={false}>
        <boxGeometry args={[0.06, 2.2, 0.06]} />
        <meshStandardMaterial color="#facc15" metalness={0.3} />
        {posts.map((p, i) => <Instance key={i} position={p} />)}
      </Instances>
      {real ? <Suspense fallback={null}><MeshPanels panels={panels} /></Suspense> : (
        <Instances limit={128} frustumCulled={false}>
          <boxGeometry args={[1, 1.9, 0.02]} />
          <meshStandardMaterial color="#a3e635" transparent opacity={0.45} metalness={0.2} roughness={0.6} />
          {panels.map((x, i) => <Instance key={i} position={x.p} rotation={[0, x.yaw, 0]} scale={[x.len, 1, 1]} />)}
        </Instances>)}
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

/** Soft footprint shadow (occlusion + oil darkening) so machines sit on the floor instead of floating. */
export function footprintTexture() {
  const c = document.createElement("canvas"); c.width = c.height = 128;
  const g = c.getContext("2d")!;
  g.filter = "blur(10px)"; g.fillStyle = "rgba(0,0,0,0.85)"; g.fillRect(22, 22, 84, 84);
  g.filter = "blur(4px)"; g.fillStyle = "rgba(0,0,0,0.5)"; g.fillRect(30, 30, 68, 68);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function Grounding() {
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ map: footprintTexture(), transparent: true, depthWrite: false, opacity: 0.55, polygonOffset: true, polygonOffsetFactor: -4 }), []);
  return (
    <group>
      {MACHINES.filter((m) => m.type !== "agv").map((m) => (
        <mesh key={m.id} material={mat} rotation-x={-Math.PI / 2} position={[m.position[0], 0.006, m.position[2]]} scale={[m.size[0] * 1.35 + 0.6, m.size[2] * 1.35 + 0.6, 1]} renderOrder={1}>
          <planeGeometry />
        </mesh>))}
    </group>
  );
}

export function Hall({ quality, structures }: { quality: boolean; structures: boolean }) {
  return (
    <group>
      <Floor quality={quality} />
      <Grounding />
      <group visible={structures}>
        <Structure />
        <Racks />
        <Fences />
        <Catwalk />
      </group>
    </group>
  );
}
