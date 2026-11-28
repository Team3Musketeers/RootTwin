// Real 3D asset pipeline: glTF / glb loading (Meshopt-compressed files supported) with automatic normalisation -
// scaled to a real-world height, centred, standing on the floor (y = 0), shadows on, PBR materials kept and tuned
// for the hall's HDRI. Missing files are skipped (assets are fetched with scripts/fetch_polyhaven.py).
import { useEffect, useState } from "react";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";

const exists = new Map<string, Promise<boolean>>();
/** HEAD-check once per url so a missing optional asset never breaks the scene. */
export function useAssetAvailable(url: string) {
  const [ok, setOk] = useState(false);
  useEffect(() => {
    if (!exists.has(url)) exists.set(url, fetch(url, { method: "HEAD" }).then((r) => r.ok && !r.headers.get("content-type")?.includes("text/html")).catch(() => false));
    let live = true;
    exists.get(url)!.then((v) => live && setOk(v));
    return () => { live = false; };
  }, [url]);
  return ok;
}

/** Load a glTF and return a normalised clone: height `height` m (or uniform `scale`), centred in x/z, base at y = 0. */
export function useNormalizedModel(url: string, opts: { height?: number; scale?: number }) {
  const { scene } = useGLTF(url, false, true);          // no Draco (CDN), Meshopt decoder bundled
  const [obj] = useState(() => {
    const root = scene.clone(true);
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.castShadow = m.receiveShadow = true;
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const mat of mats as THREE.MeshStandardMaterial[]) if ("envMapIntensity" in mat) mat.envMapIntensity = 1.1;
    });
    const box = new THREE.Box3().setFromObject(root), size = box.getSize(new THREE.Vector3());
    const s = opts.scale ?? (opts.height ? opts.height / Math.max(size.y, 1e-6) : 1);
    const wrap = new THREE.Group();
    root.scale.setScalar(s);
    root.position.set(-((box.min.x + box.max.x) / 2) * s, -box.min.y * s, -((box.min.z + box.max.z) / 2) * s);
    wrap.add(root);
    return wrap;
  });
  return obj;
}
