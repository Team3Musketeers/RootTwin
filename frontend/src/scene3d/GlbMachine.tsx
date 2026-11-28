// A whole machine replaced by a real .glb model (manifest { "url", "replace": true }): fitted to the machine footprint,
// grounded, shadows on, and still part of the twin - every mesh explodes away from the model centre (staggered by
// distance), turns to glass in X-ray mode, ghosts when another machine is isolated, and pulses red when its name is
// the id of a faulted part (GLTFLoader names: "PRS.brgIn" -> "PRSbrgIn").
import { useMemo } from "react";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { explodeProgress } from "../twin/explode";
import type { MachineDef } from "../twin/types";
import { useView } from "./context";
import { glbKey } from "./models";

const RED = new THREE.Color("#ff0a1e"), XRAY = new THREE.Color("#7dd3fc");

export function GlbMachine({ url, def, explodeRef }: { url: string; def: MachineDef; explodeRef: { current: number } }) {
  const v = useView();
  const { scene } = useGLTF(url, false, true);
  const { root, pieces } = useMemo(() => {
    const root = scene.clone(true);
    const box = new THREE.Box3().setFromObject(root), size = box.getSize(new THREE.Vector3());
    const s = Math.min(def.size[0] / size.x, def.size[1] / size.y, def.size[2] / size.z);   // fit inside the footprint
    root.scale.setScalar(s);
    root.position.set(-((box.min.x + box.max.x) / 2) * s, -box.min.y * s, -((box.min.z + box.max.z) / 2) * s);
    root.updateMatrixWorld(true);
    const centre = new THREE.Box3().setFromObject(root).getCenter(new THREE.Vector3());
    const meshes: THREE.Mesh[] = [];
    root.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
    const maxD = Math.max(...def.size);
    const pieces = meshes.map((m) => {
      m.castShadow = m.receiveShadow = true;
      m.material = (Array.isArray(m.material) ? m.material[0] : m.material).clone();
      const mat = m.material as THREE.MeshStandardMaterial;
      const c = new THREE.Box3().setFromObject(m).getCenter(new THREE.Vector3());
      const dir = c.clone().sub(centre);
      const dist = dir.length();
      dir.normalize().multiplyScalar(maxD * 0.45);
      if (m.parent) m.parent.worldToLocal(dir.add(m.getWorldPosition(new THREE.Vector3()))).sub(m.position);   // world offset -> parent space
      // part id this mesh stands for: its own name or the nearest named ancestor
      let id = "", o: THREE.Object3D | null = m;
      while (o && !id) { id = o.name; o = o.parent; }
      return { m, mat, home: m.position.clone(), dir, order: dist, key: id, base: { color: mat.color.clone(), opacity: mat.opacity, transparent: mat.transparent, emissive: mat.emissive?.clone() } };
    });
    const maxOrder = Math.max(1, ...pieces.map((p) => p.order));
    for (const p of pieces) p.order = Math.round((1 - p.order / maxOrder) * 6);              // inner pieces leave last
    return { root, pieces };
  }, [scene, def]);

  useFrame(({ clock }) => {
    const mine = v.machine === def.id, other = v.mode !== "factory" && v.machine !== null && !mine;
    const faulted = new Set(v.sim.machineFaults(def.id).map((f) => glbKey(f.partId)));
    for (const p of pieces) {
      const e = explodeProgress(explodeRef.current, p.order, 6);
      p.m.position.copy(p.home).addScaledVector(p.dir, e);
      const red = faulted.has(p.key);
      let opacity = p.base.opacity, transparent = p.base.transparent;
      p.mat.color.copy(red ? RED : p.base.color);
      if (p.mat.emissive) { p.mat.emissive.copy(red ? RED : p.base.emissive ?? new THREE.Color(0)); p.mat.emissiveIntensity = red ? 2 + 2 * Math.sin(clock.elapsedTime * 7) : 1; }
      if (!red && v.xray && (mine || v.mode === "factory")) { p.mat.color.lerp(XRAY, 0.6); opacity = 0.2; transparent = true; }
      if (other) { opacity = Math.min(opacity, v.sim.line.ghost); transparent = true; }
      if (p.mat.transparent !== transparent) { p.mat.transparent = transparent; p.mat.needsUpdate = true; }
      p.mat.opacity = opacity; p.mat.depthWrite = opacity >= 0.5;
    }
  });

  const onClick = (e: ThreeEvent<MouseEvent>) => { e.stopPropagation(); v.selectMachine(def.id); };
  return <primitive object={root} onClick={onClick} onDoubleClick={(e: ThreeEvent<MouseEvent>) => { e.stopPropagation(); v.isolate(def.id); }} />;
}
