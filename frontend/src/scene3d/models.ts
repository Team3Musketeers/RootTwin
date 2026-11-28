// Optional real CAD meshes, listed in public/models/manifest.json:
//   "PRS": "/models/press.glb"                          part override: every mesh named after a part id (e.g. "PRS.brgIn")
//                                                       replaces that part's procedural geometry (keeps everything else)
//   "CNC": { "url": "/models/cnc.glb", "replace": true } whole machine: the model replaces the procedural one, is fitted
//                                                       to the machine footprint, and each of its meshes still explodes,
//                                                       turns to glass in X-ray and goes red when named after a faulted part
// Export from Blender: Y up, metres; name meshes after part ids where you want part-level faults.
import { useEffect, useState } from "react";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

type Entry = string | { url: string; replace?: boolean };
let manifest: Promise<Record<string, Entry>> | null = null;   // fetched once
const loadManifest = () => (manifest ??= fetch("/models/manifest.json").then((r) => (r.ok ? r.json() : {})).catch(() => ({})) as Promise<Record<string, Entry>>);

/** Model for a machine: { url, replace } or null (procedural CAD). */
export function useModelUrl(machineId: string) {
  const [m, setM] = useState<{ url: string; replace: boolean } | null>(null);
  useEffect(() => { loadManifest().then((all) => {
    const e = all[machineId];
    setM(!e ? null : typeof e === "string" ? { url: e, replace: false } : { url: e.url, replace: !!e.replace });
  }); }, [machineId]);
  return m;
}

/** GLTFLoader strips . : / [ ] from node names, so "PRS.brgIn" arrives as "PRSbrgIn". */
export const glbKey = (partId: string) => partId.replace(/[[\].:/]/g, "");

/** sanitized part id -> geometry from a loaded glTF scene (node transforms baked relative to the node itself). */
export function useGlbParts(url: string) {
  const { scene } = useGLTF(url, false, true);         // Meshopt-compressed .glb supported (decoder bundled, no CDN)
  const [parts] = useState(() => {
    const out = new Map<string, THREE.BufferGeometry>();
    scene.updateMatrixWorld(true);
    scene.traverse((node) => {
      if (!node.name) return;
      const inv = node.matrixWorld.clone().invert(), geos: THREE.BufferGeometry[] = [];
      node.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const g = mesh.geometry.clone().applyMatrix4(inv.clone().multiply(mesh.matrixWorld));
        for (const k of Object.keys(g.attributes)) if (!["position", "normal", "uv"].includes(k)) g.deleteAttribute(k);
        geos.push(g.index ? g.toNonIndexed() : g);
      });
      const merged = geos.length ? mergeGeometries(geos) : null;
      if (merged) out.set(node.name, merged);
    });
    return out;
  });
  return parts;
}
