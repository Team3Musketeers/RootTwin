// Optional real CAD meshes: drop a .glb in public/models/ and list it in public/models/manifest.json as
// { "PRS": "/models/press.glb" }. Every mesh whose node name equals a part id (e.g. "PRS.brgIn") replaces that part's
// procedural geometry; the part keeps its metadata, exploded view, X-ray, selection and red fault behaviour.
// Export from Blender with node names = part ids, Y up, metres, origin at the part's mounting point.
import { useEffect, useState } from "react";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

let manifest: Promise<Record<string, string>> | null = null;   // fetched once
const loadManifest = () => (manifest ??= fetch("/models/manifest.json").then((r) => (r.ok ? r.json() : {})).catch(() => ({})) as Promise<Record<string, string>>);

/** Model url for a machine, or null (procedural CAD). */
export function useModelUrl(machineId: string) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => { loadManifest().then((m) => setUrl(m[machineId] ?? null)); }, [machineId]);
  return url;
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
