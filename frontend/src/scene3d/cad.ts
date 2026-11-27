// CAD geometry toolkit: turns declarative shape specs into engineered meshes
// (filleted castings, lathe-turned parts, involute helical gears, finned motors, tapered roller bearings,
// bolt circles, hoses/cables, springs/augers, T-slot extrusions) merged into one BufferGeometry per part.
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import type { Shape, V3 } from "../twin/types";

const cache = new Map<string, THREE.BufferGeometry>();
const D = Math.PI / 180;

function place(g: THREE.BufferGeometry, pos?: V3, rot?: V3) {
  if (rot) g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rot[0], rot[1], rot[2])));
  if (pos) g.translate(pos[0], pos[1], pos[2]);
  return g;
}

/** Make every geometry share the same attribute set so they can be merged. */
function normalize(g: THREE.BufferGeometry) {
  let x = g.index ? g.toNonIndexed() : g;
  if (!x.attributes.uv) x.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array((x.attributes.position.count) * 2), 2));
  for (const k of Object.keys(x.attributes)) if (!["position", "normal", "uv"].includes(k)) x.deleteAttribute(k);
  if (!x.attributes.normal) x.computeVertexNormals();
  x = x.index ? x.toNonIndexed() : x;
  return x;
}
const merge = (gs: THREE.BufferGeometry[]) => mergeGeometries(gs.map(normalize), false)!;

// ------------------------------------------------------------------ primitives
/** Involute spur/helical gear: true involute flanks, root fillet approximation, bore; helix twists along the width. */
export function involuteGear(m: number, z: number, width: number, helixDeg = 0, bore = 0.25): THREE.BufferGeometry {
  const pa = 20 * D, rp = (m * z) / 2, rb = rp * Math.cos(pa), ra = rp + m, rf = Math.max(rp - 1.25 * m, rb * 0.92);
  const inv = (a: number) => Math.tan(a) - a;
  const aTip = Math.acos(rb / ra);
  const halfTooth = Math.PI / (2 * z) + inv(pa);           // half tooth angle at the base circle
  const shape = new THREE.Shape();
  const N = 6;
  for (let i = 0; i < z; i++) {
    const c = (i / z) * Math.PI * 2;
    const flank = (sign: number) => {
      const pts: [number, number][] = [];
      for (let k = 0; k <= N; k++) {
        const a = (k / N) * aTip, r = rb / Math.cos(a);
        const th = c + sign * (halfTooth - inv(a));
        pts.push([r * Math.cos(th), r * Math.sin(th)]);
      }
      return pts;
    };
    const right = flank(-1), left = flank(1).reverse();
    const rootA = c - halfTooth - 0.08, rootB = c + halfTooth + 0.08;
    const p0 = [rf * Math.cos(rootA), rf * Math.sin(rootA)] as const;
    if (i === 0) shape.moveTo(p0[0], p0[1]); else shape.lineTo(p0[0], p0[1]);
    for (const [x, y] of right) shape.lineTo(x, y);
    for (const [x, y] of left) shape.lineTo(x, y);
    shape.lineTo(rf * Math.cos(rootB), rf * Math.sin(rootB));
    const next = c + (2 * Math.PI) / z - halfTooth - 0.08;
    shape.absarc(0, 0, rf, rootB, next, false);
  }
  const hole = new THREE.Path();
  hole.absarc(0, 0, rp * bore, 0, Math.PI * 2, true);
  shape.holes.push(hole);
  const g = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: true, bevelThickness: m * 0.15, bevelSize: m * 0.1, bevelSegments: 1, curveSegments: 3, steps: helixDeg ? 6 : 1 });
  g.translate(0, 0, -width / 2);
  if (helixDeg) {                                             // twist slices around z for a helical gear
    const p = g.attributes.position as THREE.BufferAttribute;
    const twist = (Math.tan(helixDeg * D) * width) / rp;
    for (let i = 0; i < p.count; i++) {
      const zz = p.getZ(i) / width, a = twist * zz, x = p.getX(i), y = p.getY(i);
      p.setXY(i, x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a));
    }
    g.computeVertexNormals();
  }
  // hub
  const hub = new THREE.CylinderGeometry(rp * 0.42, rp * 0.42, width * 1.35, 24, 1, true);
  hub.rotateX(Math.PI / 2);
  return merge([g, hub]);
}

/** Lathe-turned solid from a (radius, y) profile. */
export function lathe(pts: [number, number][], seg = 40) {
  return new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg);
}

/** AC induction motor: cylindrical frame with radial cooling fins, end bells, shaft stub, terminal box, feet. Axis along +y. */
export function motor(r: number, len: number) {
  const body = lathe([[0, -len / 2], [r * 0.9, -len / 2], [r, -len / 2 + r * 0.15], [r, len / 2 - r * 0.15], [r * 0.9, len / 2], [r * 0.3, len / 2], [r * 0.3, len / 2 + r * 0.12], [0, len / 2 + r * 0.12]], 36);
  const fins: THREE.BufferGeometry[] = [];
  const nf = 18;
  for (let i = 0; i < nf; i++) {
    const a = (i / nf) * Math.PI * 2;
    const fin = new THREE.BoxGeometry(r * 0.22, len * 0.8, r * 0.035);
    fin.translate(r + r * 0.09, 0, 0);
    fin.rotateY(a);
    fins.push(fin);
  }
  const shaft = new THREE.CylinderGeometry(r * 0.16, r * 0.16, r * 0.6, 16); shaft.translate(0, len / 2 + r * 0.4, 0);
  const tbox = new RoundedBoxGeometry(r * 0.7, r * 0.55, r * 0.55, 2, r * 0.06); tbox.translate(0, len * 0.1, r * 1.15);
  const fan = lathe([[0, -len / 2 - r * 0.35], [r * 0.95, -len / 2 - r * 0.35], [r, -len / 2 - r * 0.05], [r * 0.9, -len / 2]], 36);
  return merge([body, ...fins, shaft, tbox, fan]);
}

/** Tapered (or deep-groove) roller bearing: inner + outer race and rolling elements, axis along +y. */
export function bearing(ri: number, ro: number, w: number, n = 14, taper = true) {
  const t = (ro - ri) * 0.25;
  const inner = lathe([[ri, -w / 2], [ri + t, -w / 2], [ri + t * (taper ? 1.3 : 1), w / 2], [ri, w / 2]], 32);
  const outer = lathe([[ro - t * (taper ? 1.3 : 1), -w / 2], [ro, -w / 2], [ro, w / 2], [ro - t, w / 2]], 32);
  const rollers: THREE.BufferGeometry[] = [];
  const rm = (ri + ro) / 2, rr = (ro - ri) * 0.22;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const rol = taper ? new THREE.CylinderGeometry(rr * 0.85, rr * 1.1, w * 0.8, 10) : new THREE.SphereGeometry(rr, 10, 8);
    if (taper) rol.rotateZ(0.18);
    rol.translate(rm, 0, 0); rol.rotateY(a);
    rollers.push(rol);
  }
  const cage = new THREE.TorusGeometry(rm, rr * 0.25, 6, 40); cage.rotateX(Math.PI / 2);
  return merge([inner, outer, ...rollers, cage]);
}

/** Hex bolt heads + washers on a circle (in the XZ plane, heads pointing +y). */
export function boltCircle(radius: number, n: number, size = 0.025) {
  const gs: THREE.BufferGeometry[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const head = new THREE.CylinderGeometry(size, size, size * 0.7, 6); head.translate(0, size * 0.45, 0);
    const washer = new THREE.CylinderGeometry(size * 1.35, size * 1.35, size * 0.15, 16);
    const b = merge([head, washer]); b.translate(radius * Math.cos(a), 0, radius * Math.sin(a));
    gs.push(b);
  }
  return merge(gs);
}

/** Hose / cable / pipe along a Catmull-Rom curve; corrugated variant for robot dress packs. */
export function tube(pts: V3[], r: number, corrugated = false) {
  const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p)));
  const g = new THREE.TubeGeometry(curve, Math.max(24, pts.length * 16), r, 12, false);
  if (corrugated) {
    const p = g.attributes.position as THREE.BufferAttribute, nrm = g.attributes.normal as THREE.BufferAttribute;
    const rings = Math.max(24, pts.length * 16) + 1;
    for (let i = 0; i < p.count; i++) {
      const ring = Math.floor(i / 13), k = 1 + 0.12 * Math.sin((ring / rings) * Math.PI * 2 * 30);
      p.setXYZ(i, p.getX(i) + nrm.getX(i) * r * (k - 1), p.getY(i) + nrm.getY(i) * r * (k - 1), p.getZ(i) + nrm.getZ(i) * r * (k - 1));
    }
    g.computeVertexNormals();
  }
  return g;
}

/** Helical coil (spring, auger flight, cable wrap) along +y. */
export function helix(r: number, pitch: number, turns: number, wire: number) {
  const pts: THREE.Vector3[] = [];
  const steps = Math.ceil(turns * 24);
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * turns * Math.PI * 2;
    pts.push(new THREE.Vector3(r * Math.cos(a), (i / steps) * turns * pitch - (turns * pitch) / 2, r * Math.sin(a)));
  }
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), steps * 2, wire, 8, false);
}

/** Aluminium T-slot profile (s x s) extruded along +x, centred. */
export function tslot(len: number, s = 0.045) {
  const h = s / 2, slot = s * 0.18, lip = s * 0.12;
  const shape = new THREE.Shape();
  const pts: [number, number][] = [];
  const side = (rot: number) => {                    // one side with a T-slot opening, rotated by rot*90°
    const raw: [number, number][] = [[-h, h], [-slot, h], [-slot, h - lip], [-slot * 1.6, h - lip], [-slot * 1.6, h - lip * 2.2], [slot * 1.6, h - lip * 2.2], [slot * 1.6, h - lip], [slot, h - lip], [slot, h]];
    for (const [x, y] of raw) { const c = Math.cos(rot * Math.PI / 2), s2 = Math.sin(rot * Math.PI / 2); pts.push([x * c - y * s2, x * s2 + y * c]); }
  };
  [0, 3, 2, 1].forEach(side);
  shape.moveTo(pts[0][0], pts[0][1]);
  for (const [x, y] of pts.slice(1)) shape.lineTo(x, y);
  const hole = new THREE.Path(); hole.absarc(0, 0, s * 0.12, 0, Math.PI * 2, true); shape.holes.push(hole);
  const g = new THREE.ExtrudeGeometry(shape, { depth: len, bevelEnabled: false, curveSegments: 6 });
  g.translate(0, 0, -len / 2); g.rotateY(Math.PI / 2);
  return g;
}

/** Extruded outline (e.g. robot link side profile) with bevelled (filleted) edges, centred on its depth. */
export function extrudeOutline(outline: [number, number][], depth: number, bevel = 0.02) {
  const s = new THREE.Shape(outline.map(([x, y]) => new THREE.Vector2(x, y)));
  const g = new THREE.ExtrudeGeometry(s, { depth: Math.max(0.001, depth - 2 * bevel), bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 10 });
  g.translate(0, 0, -(depth - 2 * bevel) / 2);
  return g;
}

// ------------------------------------------------------------------ spec -> geometry
function build(s: Shape): THREE.BufferGeometry {
  switch (s.kind) {
    case "rbox": return new RoundedBoxGeometry(s.size[0], s.size[1], s.size[2], 3, Math.min(s.r ?? 0.015, Math.min(...s.size) / 2.2));
    case "cyl": return new THREE.CylinderGeometry(s.r, s.r2 ?? s.r, s.h, s.seg ?? 36);
    case "sphere": return new THREE.SphereGeometry(s.r, 28, 18);
    case "torus": return new THREE.TorusGeometry(s.R, s.r, 14, 48);
    case "lathe": return lathe(s.pts);
    case "gear": return involuteGear(s.m, s.z, s.w, s.helix ?? 0, s.bore ?? 0.25);
    case "motor": return motor(s.r, s.len);
    case "bearing": return bearing(s.ri, s.ro, s.w, s.n, s.taper ?? true);
    case "bolts": return boltCircle(s.radius, s.n, s.size);
    case "tube": return tube(s.pts, s.r, s.corrugated);
    case "helix": return helix(s.r, s.pitch, s.turns, s.wire);
    case "tslot": return tslot(s.len, s.s);
    case "extrude": return extrudeOutline(s.outline, s.depth, s.bevel);
    case "compound": return merge(s.items.map((it) => place(build(it.shape).clone(), it.pos, it.rot)));
  }
}

export function geometryFor(s: Shape): THREE.BufferGeometry {
  const key = JSON.stringify(s);
  let g = cache.get(key);
  if (!g) { g = normalize(build(s)); g.computeBoundingSphere(); cache.set(key, g); }
  return g;
}
