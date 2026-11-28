// Real AMR meshes: MiR 250 from DFKI-NI/mir_robot (BSD-3-Clause, public/models/amr/LICENSE-mir_robot.txt) mapped
// onto the twin's AGV parts, so driving, exploded view, X-ray and red faults keep working.
//
// Meshes are STL (no colour; our PBR presets paint them), metres, Z-up. Positions come from the MiR URDF
// (mir_v1.urdf.xacro, MiR 250 values), scaled x1.3 to carry Euro pallets. Static parts (body, casters, LiDARs) are
// baked at their absolute place and expressed in the part's own frame; drive wheels are centred on their axle (local
// Y, like the procedural ones) because they spin. The procedural skirt and LiDAR window are hidden (the shell has them).
import { useMemo } from "react";
import { useLoader } from "@react-three/fiber";
import * as THREE from "three";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { AGV_IDS, MACHINE } from "../twin/registry";
import { glbKey } from "./models";

export const AMR_DIR = "/models/amr/mir";
const S = 1.3;                                                    // MiR 250 -> pallet-carrying AMR
const files = ["mir_250_base", "wheel", "caster_wheel_base", "sick_lms-100"] as const;
const ZUP = new THREE.Matrix4().makeRotationX(-Math.PI / 2);      // MiR (x fwd, y left, z up) -> ours (x fwd, y up, z = -y_mir)

/** MiR-frame transform: translate t (metres, Z-up) after rotation rpy (URDF roll-pitch-yaw). */
const tf = (t: [number, number, number], rpy: [number, number, number] = [0, 0, 0]) =>
  new THREE.Matrix4().compose(new THREE.Vector3(...t), new THREE.Quaternion().setFromEuler(new THREE.Euler(rpy[0], rpy[1], rpy[2], "ZYX")), new THREE.Vector3(1, 1, 1));

function place(g: THREE.BufferGeometry, m: THREE.Matrix4) {
  const x = g.clone().applyMatrix4(m).applyMatrix4(new THREE.Matrix4().makeScale(S, S, S)).applyMatrix4(ZUP);
  for (const k of Object.keys(x.attributes)) if (k !== "position" && k !== "normal") x.deleteAttribute(k);
  return x.index ? x.toNonIndexed() : x;
}

/** Absolute (AGV-frame) geometry -> the frame of a part at rest (pos, rot). */
function toPart(g: THREE.BufferGeometry, partId: string) {
  const p = MACHINE[partId.split(".")[0]].subAssemblies.flatMap((s) => s.parts).find((x) => x.id === partId)!;
  const m = new THREE.Matrix4().compose(new THREE.Vector3(...p.pos), new THREE.Quaternion().setFromEuler(new THREE.Euler(...(p.rot ?? [0, 0, 0]))), new THREE.Vector3(1, 1, 1));
  return g.applyMatrix4(m.invert());
}

export function useAmrMeshes(): Map<string, THREE.BufferGeometry | null> {
  const stl = useLoader(STLLoader, files.map((f) => `${AMR_DIR}/${f}.stl`)) as THREE.BufferGeometry[];
  return useMemo(() => {
    const [base, wheel, casterBase, sick] = stl;
    const caster = (x: number, y: number) => mergeGeometries([
      place(casterBase, tf([x, y, 0.1565]).multiply(tf([0, 0, -0.0425], [24 * Math.PI / 180, 0, Math.PI / 2]))),
      place(wheel, tf([x - 0.0382, y, 0.1565 - 0.094])),
    ])!;
    // drive wheel: MiR wheel.stl has its axle along y; resize to the MiR 250 wheel (r 0.10, w 0.038) and keep it centred
    const drive = wheel.clone().applyMatrix4(new THREE.Matrix4().makeScale((0.1 / 0.062) * S, (0.038 / 0.032) * S, (0.1 / 0.062) * S));
    drive.computeVertexNormals();
    const out = new Map<string, THREE.BufferGeometry | null>();
    for (const id of AGV_IDS) {
      const set = (part: string, g: THREE.BufferGeometry | null) => { if (g) g.computeBoundingSphere(); out.set(glbKey(`${id}.${part}`), g); };
      set("chassis", toPart(place(base, new THREE.Matrix4()), `${id}.chassis`));
      set("wheelL", drive.clone()); set("wheelR", drive.clone());
      set("casterF", toPart(mergeGeometries([caster(0.3037, 0.188), caster(0.3037, -0.188)])!, `${id}.casterF`));
      set("casterB", toPart(mergeGeometries([caster(-0.296, 0.188), caster(-0.296, -0.188)])!, `${id}.casterB`));
      set("lidarF", toPart(place(sick, tf([0.315, -0.205, 0.1914], [0, 0, -Math.PI / 4])), `${id}.lidarF`));
      set("lidarR", toPart(place(sick, tf([-0.315, 0.205, 0.1914], [0, 0, (3 * Math.PI) / 4])), `${id}.lidarR`));
      set("skirt", null); set("lidarWin", null);
    }
    return out;
  }, [stl]);
}
