// Geometry factory for part primitives (incl. procedural spur gears). Cached: identical parts share one geometry.
import * as THREE from "three";
import type { Geo } from "../twin/types";

const cache = new Map<string, THREE.BufferGeometry>();

function gear(r: number, width: number, teeth: number): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  const tooth = Math.min(0.03, r * 0.18), steps = teeth * 4;
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    const rr = r + (i % 4 === 1 || i % 4 === 2 ? tooth : -tooth * 0.4);
    if (i === 0) shape.moveTo(rr * Math.cos(a), rr * Math.sin(a)); else shape.lineTo(rr * Math.cos(a), rr * Math.sin(a));
  }
  const hole = new THREE.Path();
  hole.absarc(0, 0, r * 0.25, 0, Math.PI * 2, true);
  shape.holes.push(hole);
  const g = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: false, curveSegments: 4 });
  g.translate(0, 0, -width / 2);
  return g;
}

export function geometryFor(geo: Geo): THREE.BufferGeometry {
  const key = `${geo.kind}:${geo.args.join(",")}`;
  let g = cache.get(key);
  if (g) return g;
  const a = geo.args;
  switch (geo.kind) {
    case "box": g = new THREE.BoxGeometry(a[0], a[1], a[2]); break;
    case "cyl": g = new THREE.CylinderGeometry(a[0], a[1], a[2], 28); break;
    case "cone": g = new THREE.ConeGeometry(a[0], a[1], 24); break;
    case "sphere": g = new THREE.SphereGeometry(a[0], 20, 14); break;
    case "torus": g = new THREE.TorusGeometry(a[0], a[1], 12, 32); break;
    case "capsule": g = new THREE.CapsuleGeometry(a[0], a[1], 6, 12); break;
    case "gear": g = gear(a[0], a[1], a[2]); break;
  }
  cache.set(key, g!);
  return g!;
}
