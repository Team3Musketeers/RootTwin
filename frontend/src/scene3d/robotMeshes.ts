// Real KUKA arm meshes (ROS-Industrial kuka_experimental, Apache-2.0: public/models/robots/LICENSE-kuka_experimental.txt)
// mapped onto the twin's 6-axis joint parts, so the joints, IK, exploded view, X-ray and red faults keep working.
//
// The URDF link meshes are in each link's own frame (metres, Z-up, robot facing +X, zero pose = arm stretched out
// horizontally). Our joint frames have the same origins (the arms use the KUKA dimensions, twin/kinematics.ts), but
// our zero pose has the lower arm vertical, so link_2 is turned +90° about the joint axis. A4 sits slightly below the
// A3-A4 line on a real KUKA (z offset), and our J6 frame is the tool flange, so links 4-6 get small offsets.
// The separate procedural motors / reducers are hidden (the castings include them); their faults light up the link
// that contains them.
import { useMemo } from "react";
import { useLoader } from "@react-three/fiber";
import * as THREE from "three";
import { ColladaLoader } from "three/examples/jsm/loaders/ColladaLoader.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { WELD_SCALE, PAL_SCALE } from "../twin/machines/cells";
import { glbKey } from "./models";

interface RobotSpec { prefix: string; dir: string; scale: number; a4dz: number; flange: number; paint: string }
/** machine id -> arms on it */
export const ROBOT_MODELS: Record<string, RobotSpec[]> = {
  WLD: [
    { prefix: "WLD.A", dir: "kr16_2", scale: WELD_SCALE, a4dz: -0.035, flange: 0.158, paint: "#f06a0f" },
    { prefix: "WLD.B", dir: "kr16_2", scale: WELD_SCALE, a4dz: -0.035, flange: 0.158, paint: "#f06a0f" },
  ],
  PAL: [{ prefix: "PAL.R", dir: "kr120r2500pro", scale: PAL_SCALE, a4dz: -0.041, flange: 0.215, paint: "#f2b705" }],
};
const LINKS = ["base_link", "link_1", "link_2", "link_3", "link_4", "link_5", "link_6"];
const PART = ["base", "j1", "j2", "j3", "j4", "j5", "j6"];
/** procedural extras that the real castings already contain -> the part whose mesh now shows them */
const HOSTS: Record<string, string> = { jbox: "base", j1m: "j1", j2m: "j2", j2r: "j2", cb: "j2", cbSpring: "j2", j3m: "j3", j3r: "j3", dress: "j3" };
export const hostedBy = new Map<string, string[]>();        // host part id -> hidden part ids (for red faults)
for (const specs of Object.values(ROBOT_MODELS)) for (const r of specs) for (const [hidden, host] of Object.entries(HOSTS)) {
  const k = `${r.prefix}.${host}`;
  hostedBy.set(k, [...(hostedBy.get(k) ?? []), `${r.prefix}.${hidden}`]);
}

/** link mesh (Collada scene) -> one geometry in our joint frame, KUKA paint replaced by the robot's colour. */
function bake(scene: THREE.Object3D, link: number, r: RobotSpec): THREE.BufferGeometry {
  scene.updateMatrixWorld(true);                              // ColladaLoader already turned Z-up into Y-up
  const paint = new THREE.Color(r.paint);
  const parts: THREE.BufferGeometry[] = [];
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    let g = m.geometry.clone().applyMatrix4(m.matrixWorld);
    g = g.index ? g.toNonIndexed() : g;
    for (const k of Object.keys(g.attributes)) if (k !== "position" && k !== "normal") g.deleteAttribute(k);
    if (!g.attributes.normal) g.computeVertexNormals();
    const mat = (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.MeshStandardMaterial;
    const c = mat.color ? mat.color.clone() : new THREE.Color(0.5, 0.5, 0.5);
    const orange = /RAL\s*2003/i.test(mat.name) || (c.r > 0.08 && c.r > 2.5 * c.g && c.r > 4 * c.b);   // KUKA RAL 2003 orange (linear RGB) -> this robot's paint
    const col = orange ? paint : c;
    const n = g.attributes.position.count, arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) arr.set([col.r, col.g, col.b], i * 3);
    g.setAttribute("color", new THREE.BufferAttribute(arr, 3));
    parts.push(g);
  });
  const g = mergeGeometries(parts)!;
  if (link === 2) g.rotateZ(Math.PI / 2);                                   // our zero pose: lower arm vertical
  if (link >= 4) g.translate(0, r.a4dz, 0);                                  // A4 below the A3-A4 line
  if (link === 6) g.translate(-r.flange, 0, 0);                             // our J6 frame is the tool flange
  if (link === 1) g.translate(0, 0.375, 0);                                  // link_1 frame is at the A2 height
  g.scale(r.scale, r.scale, r.scale);
  g.computeBoundingSphere();
  return g;
}

/** part id -> real geometry (null = procedural extra hidden because the casting contains it). Suspends while loading. */
export function useRobotMeshes(machineId: string): Map<string, THREE.BufferGeometry | null> {
  const specs = ROBOT_MODELS[machineId];
  const dirs = [...new Set(specs.map((r) => r.dir))];
  const urls = dirs.flatMap((d) => LINKS.map((l) => `/models/robots/${d}/${l}.dae`));
  const loaded = useLoader(ColladaLoader, urls) as unknown as { scene: THREE.Object3D }[];
  return useMemo(() => {
    const out = new Map<string, THREE.BufferGeometry | null>();
    for (const r of specs) {
      const base = dirs.indexOf(r.dir) * LINKS.length;
      LINKS.forEach((_, i) => out.set(glbKey(`${r.prefix}.${PART[i]}`), bake(loaded[base + i].scene, i, r)));
      for (const hidden of Object.keys(HOSTS)) out.set(glbKey(`${r.prefix}.${hidden}`), null);
    }
    return out;
  }, [loaded, specs, dirs]);
}
