// Articulated technician: hierarchical humanoid rig with real joint pivots
//   pelvis -> spine -> chest -> neck -> head ; chest -> shoulder -> elbow -> wrist ; pelvis -> hip -> knee -> ankle
// Segments are tapered lathe profiles (no capsule dummies). Clothing: dark coverall, hi-vis vest with reflective tape
// and pockets, utility belt, gloves, steel-toe boots, safety glasses and a contoured hard hat (colour = role).
// Animation: stride with knee / elbow bend synced to walking speed, idle breathing, and a "work" pose (reach and press)
// when operating or repairing. A real rigged worker can replace it: public/models/worker.glb (see WorkerGlb).
import { Suspense, useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useAnimations, useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { useAssetAvailable } from "./assetLoader";

/** Tapered limb segment hanging down from its joint (length L, radius r0 at the joint -> r1 at the end). */
function limb(L: number, r0: number, r1: number, bulge = 0.12) {
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= 12; i++) {
    const t = i / 12, r = r0 + (r1 - r0) * t + Math.sin(t * Math.PI) * bulge * r0;          // muscle bulge mid-segment
    pts.push(new THREE.Vector2(Math.max(0.001, i === 0 || i === 12 ? r * 0.6 : r), -t * L));
  }
  return new THREE.LatheGeometry(pts, 20);
}
/** Revolved torso / pelvis profile from [radius, y] pairs, squashed front-to-back. */
function trunk(profile: [number, number][], depth = 0.62) {
  const g = new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), 28);
  g.scale(1, 1, depth);
  return g;
}

export interface Pose { walk: number; speed: number; work: number }   // stride phase, m/s, 0..1 working

function useMats(hat: string) {
  const m = useMemo(() => ({
    coverall: new THREE.MeshStandardMaterial({ color: "#26303f", roughness: 0.9 }),
    vest: new THREE.MeshStandardMaterial({ color: "#c8f41a", emissive: "#9bd31a", emissiveIntensity: 0.18, roughness: 0.75 }),
    tape: new THREE.MeshStandardMaterial({ color: "#d7dbe0", metalness: 0.7, roughness: 0.25, emissive: "#ffffff", emissiveIntensity: 0.12 }),
    skin: new THREE.MeshStandardMaterial({ color: "#c89273", roughness: 0.65 }),
    glove: new THREE.MeshStandardMaterial({ color: "#3a3f46", roughness: 0.8 }),
    boot: new THREE.MeshStandardMaterial({ color: "#16191d", roughness: 0.55 }),
    toe: new THREE.MeshStandardMaterial({ color: "#5b616a", metalness: 0.6, roughness: 0.4 }),
    belt: new THREE.MeshStandardMaterial({ color: "#111317", roughness: 0.5 }),
    buckle: new THREE.MeshStandardMaterial({ color: "#b8bec7", metalness: 0.9, roughness: 0.25 }),
    hair: new THREE.MeshStandardMaterial({ color: "#2b1d14", roughness: 0.9 }),
    glass: new THREE.MeshPhysicalMaterial({ color: "#1d2733", roughness: 0.05, metalness: 0.3, transparent: true, opacity: 0.75 }),
    hat: new THREE.MeshPhysicalMaterial({ color: hat, roughness: 0.32, clearcoat: 0.9, clearcoatRoughness: 0.2 }),
  }), [hat]);
  useEffect(() => () => Object.values(m).forEach((x) => x.dispose()), [m]);
  return m;
}

const G = {
  thigh: limb(0.44, 0.085, 0.06), shin: limb(0.42, 0.058, 0.043, 0.18), upper: limb(0.29, 0.052, 0.043), fore: limb(0.26, 0.044, 0.033, 0.15),
  chest: trunk([[0.001, 0], [0.15, 0.0], [0.17, 0.08], [0.2, 0.22], [0.21, 0.32], [0.17, 0.4], [0.07, 0.44], [0.001, 0.45]]),
  vest: trunk([[0.001, 0.02], [0.165, 0.02], [0.182, 0.09], [0.212, 0.22], [0.22, 0.32], [0.18, 0.39], [0.09, 0.425], [0.001, 0.43]], 0.66),
  pelvis: trunk([[0.001, -0.1], [0.12, -0.1], [0.16, -0.04], [0.16, 0.04], [0.15, 0.08], [0.001, 0.08]], 0.7),
  head: (() => { const g = new THREE.SphereGeometry(0.1, 28, 22); g.scale(0.92, 1.18, 1.05); return g; })(),
  jaw: (() => { const g = new THREE.SphereGeometry(0.075, 20, 14, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2); g.scale(1, 0.9, 1.05); return g; })(),
  crown: (() => { const g = new THREE.SphereGeometry(0.128, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2); g.scale(1, 0.85, 1.1); return g; })(),
  brim: (() => { const s = new THREE.Shape(); s.absellipse(0, 0, 0.15, 0.19, 0, Math.PI * 2); s.holes.push(new THREE.Path().absellipse(0, 0.012, 0.12, 0.14, 0, Math.PI * 2) as THREE.Path);
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.008, bevelEnabled: true, bevelSize: 0.004, bevelThickness: 0.003, bevelSegments: 2 }); g.rotateX(Math.PI / 2); return g; })(),
  hand: (() => { const g = new THREE.SphereGeometry(0.05, 14, 10); g.scale(0.75, 1.15, 0.45); return g; })(),
  boot: (() => { const s = new THREE.Shape(); s.moveTo(-0.05, -0.09); s.lineTo(0.05, -0.09); s.quadraticCurveTo(0.065, 0.12, 0.0, 0.17); s.quadraticCurveTo(-0.065, 0.12, -0.05, -0.09);
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.09, bevelEnabled: true, bevelSize: 0.015, bevelThickness: 0.015, bevelSegments: 3 }); g.rotateX(Math.PI / 2); g.translate(0, 0.09, 0); return g; })(),
};

export function Humanoid({ hat, pose }: { hat: string; pose: { current: Pose } }) {
  const m = useMats(hat);
  const r = {
    pelvis: useRef<THREE.Group>(null), chest: useRef<THREE.Group>(null), head: useRef<THREE.Group>(null),
    shL: useRef<THREE.Group>(null), shR: useRef<THREE.Group>(null), elL: useRef<THREE.Group>(null), elR: useRef<THREE.Group>(null),
    hipL: useRef<THREE.Group>(null), hipR: useRef<THREE.Group>(null), knL: useRef<THREE.Group>(null), knR: useRef<THREE.Group>(null),
    anL: useRef<THREE.Group>(null), anR: useRef<THREE.Group>(null),
  };
  useFrame(({ clock }) => {
    const { walk: ph, speed, work } = pose.current, t = clock.elapsedTime;
    const amp = Math.min(1, speed / 1.6), run = Math.min(1, Math.max(0, (speed - 1.8) / 1.6));
    const s = Math.sin(ph), c = Math.cos(ph);
    const set = (g: React.RefObject<THREE.Group>, x: number, z = 0) => { if (g.current) { g.current.rotation.x = x; g.current.rotation.z = z; } };
    // legs: hip swing, knee bends while the leg swings forward, ankle keeps the sole flat
    const thighL = -s * 0.55 * amp, thighR = s * 0.55 * amp;
    const kneeL = (0.08 + Math.max(0, c) * (0.9 + run * 0.5)) * amp + (1 - amp) * 0.04, kneeR = (0.08 + Math.max(0, -c) * (0.9 + run * 0.5)) * amp + (1 - amp) * 0.04;
    set(r.hipL, thighL); set(r.hipR, thighR); set(r.knL, kneeL); set(r.knR, kneeR);
    set(r.anL, -(thighL + kneeL) * 0.85); set(r.anR, -(thighR + kneeR) * 0.85);
    // arms: counter-swing with relaxed elbows; work pose = right hand reaching forward to a panel, small press motion
    const breathe = Math.sin(t * 1.7);
    set(r.shL, s * 0.45 * amp + (1 - amp) * breathe * 0.03, 0.07);
    set(r.elL, -(0.25 + Math.max(0, s) * 0.35) * amp - (1 - amp) * 0.12);
    const reach = work * (1 - amp);
    set(r.shR, (-s * 0.45 * amp) * (1 - reach) + reach * (-1.05 + Math.sin(t * 3) * 0.06), -0.07 * (1 - reach) - reach * 0.12);
    set(r.elR, (-(0.25 + Math.max(0, -s) * 0.35) * amp - (1 - amp) * 0.12) * (1 - reach) + reach * -0.55);
    // trunk: walking bob and twist, idle breathing, slight lean forward when working
    if (r.pelvis.current) { r.pelvis.current.position.y = 0.94 + Math.abs(c) * 0.03 * amp + (1 - amp) * breathe * 0.004; r.pelvis.current.rotation.y = s * 0.08 * amp; }
    if (r.chest.current) { r.chest.current.rotation.y = -s * 0.12 * amp; r.chest.current.rotation.x = 0.05 * amp + reach * 0.12; r.chest.current.scale.setScalar(1 + (1 - amp) * breathe * 0.008); }
    if (r.head.current) r.head.current.rotation.y = (1 - amp) * Math.sin(t * 0.4) * 0.25 * (1 - reach);
  });
  const leg = (side: 1 | -1, hip: React.RefObject<THREE.Group>, knee: React.RefObject<THREE.Group>, ankle: React.RefObject<THREE.Group>) => (
    <group ref={hip} position={[side * 0.09, -0.04, 0]}>
      <mesh geometry={G.thigh} material={m.coverall} castShadow />
      <group ref={knee} position={[0, -0.44, 0]}>
        <mesh geometry={G.shin} material={m.coverall} castShadow />
        <group ref={ankle} position={[0, -0.42, 0]}>
          <mesh geometry={G.boot} material={m.boot} position={[0, -0.09, 0.02]} castShadow />
          <mesh material={m.toe} position={[0, -0.06, 0.15]} scale={[1, 0.55, 0.8]}><sphereGeometry args={[0.052, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2]} /></mesh>
        </group>
      </group>
    </group>
  );
  const arm = (side: 1 | -1, sh: React.RefObject<THREE.Group>, el: React.RefObject<THREE.Group>) => (
    <group ref={sh} position={[side * 0.215, 0.37, 0]}>
      <mesh material={m.coverall}><sphereGeometry args={[0.058, 16, 12]} /></mesh>
      <mesh geometry={G.upper} material={m.coverall} castShadow />
      <group ref={el} position={[0, -0.29, 0]}>
        <mesh material={m.coverall}><sphereGeometry args={[0.045, 12, 10]} /></mesh>
        <mesh geometry={G.fore} material={m.coverall} castShadow />
        <group position={[0, -0.27, 0]}>
          <mesh geometry={G.hand} material={m.glove} position={[0, -0.05, 0.005]} castShadow />
          <mesh material={m.glove} position={[side * -0.03, -0.035, 0.025]} rotation={[0.4, 0, side * 0.6]} scale={[0.5, 1.1, 0.5]}><sphereGeometry args={[0.025, 10, 8]} /></mesh>
          <mesh material={m.glove} position={[0, 0.01, 0]}><cylinderGeometry args={[0.038, 0.034, 0.05, 14]} /></mesh>
        </group>
      </group>
    </group>
  );
  return (
    <group ref={r.pelvis} position={[0, 0.94, 0]}>
      <mesh geometry={G.pelvis} material={m.coverall} castShadow />
      <mesh material={m.belt} position={[0, 0.06, 0]} scale={[1, 1, 0.7]}><torusGeometry args={[0.158, 0.02, 8, 32]} /></mesh>
      <mesh material={m.buckle} position={[0, 0.06, 0.112]}><boxGeometry args={[0.05, 0.035, 0.01]} /></mesh>
      <mesh material={m.belt} position={[0.13, 0.03, 0.06]} rotation={[0, 0.6, 0]}><boxGeometry args={[0.06, 0.08, 0.035]} /></mesh>
      {leg(-1, r.hipL, r.knL, r.anL)}{leg(1, r.hipR, r.knR, r.anR)}
      <group ref={r.chest} position={[0, 0.08, 0]}>
        <mesh geometry={G.chest} material={m.coverall} castShadow />
        <mesh geometry={G.vest} material={m.vest} castShadow />
        {[0.12, 0.25].map((y) => <mesh key={y} material={m.tape} position={[0, y, 0]} scale={[1, 1, 0.66]}><cylinderGeometry args={[y < 0.2 ? 0.2 : 0.22, y < 0.2 ? 0.2 : 0.22, 0.035, 32, 1, true]} /></mesh>)}
        {[-1, 1].map((sd) => <mesh key={sd} material={m.tape} position={[sd * 0.1, 0.3, 0.1]} rotation={[0.25, 0, 0]}><boxGeometry args={[0.035, 0.2, 0.012]} /></mesh>)}
        {[-1, 1].map((sd) => <mesh key={`p${sd}`} material={m.vest} position={[sd * 0.085, 0.07, 0.135]}><boxGeometry args={[0.08, 0.07, 0.02]} /></mesh>)}
        {arm(-1, r.shL, r.elL)}{arm(1, r.shR, r.elR)}
        <mesh material={m.skin} position={[0, 0.47, 0]}><cylinderGeometry args={[0.045, 0.055, 0.09, 16]} /></mesh>
        <group ref={r.head} position={[0, 0.6, 0.01]}>
          <mesh geometry={G.head} material={m.skin} castShadow />
          <mesh geometry={G.jaw} material={m.skin} position={[0, -0.04, 0.012]} />
          <mesh material={m.skin} position={[0, -0.005, 0.108]} rotation={[0.25, 0, 0]}><coneGeometry args={[0.018, 0.045, 10]} /></mesh>
          {[-1, 1].map((sd) => <mesh key={sd} material={m.skin} position={[sd * 0.093, 0, 0]} scale={[0.4, 1, 0.75]}><sphereGeometry args={[0.03, 10, 8]} /></mesh>)}
          <mesh material={m.hair} position={[0, 0.02, -0.03]} scale={[0.96, 0.95, 0.98]}><sphereGeometry args={[0.105, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.62]} /></mesh>
          {/* safety glasses */}
          <mesh material={m.glass} position={[0, 0.025, 0.085]} rotation={[0, 0, 0]}><cylinderGeometry args={[0.105, 0.105, 0.04, 24, 1, true, -0.9, 1.8]} /></mesh>
          {/* hard hat: contoured crown, brim, centre ridge, headband */}
          <group position={[0, 0.07, 0.005]}>
            <mesh geometry={G.crown} material={m.hat} castShadow />
            <mesh geometry={G.brim} material={m.hat} position={[0, 0.006, 0.012]} />
            <mesh material={m.hat} position={[0, 0.1, 0]} rotation={[Math.PI / 2, 0, 0]} scale={[1, 1, 1]}><capsuleGeometry args={[0.013, 0.18, 4, 10]} /></mesh>
            <mesh material={m.belt} position={[0, 0.003, 0]} scale={[1, 1, 1.1]}><torusGeometry args={[0.122, 0.006, 6, 32]} /></mesh>
          </group>
        </group>
      </group>
    </group>
  );
}

/** Optional real rigged worker (public/models/worker.glb): plays its walk / idle clips and gets a hard hat on the head bone. */
function WorkerGlbModel({ hat, pose }: { hat: string; pose: { current: Pose } }) {
  const { scene, animations } = useGLTF("/models/worker.glb", false, true);
  const root = useMemo(() => {
    const s = scene.clone(true), box = new THREE.Box3().setFromObject(s), h = box.max.y - box.min.y || 1;
    s.scale.setScalar(1.75 / h); s.position.y = (-box.min.y * 1.75) / h;
    s.traverse((o) => { (o as THREE.Mesh).castShadow = true; });
    let headBone: THREE.Object3D | undefined;
    s.traverse((o) => { if (!headBone && /head/i.test(o.name) && (o as THREE.Bone).isBone) headBone = o; });
    if (headBone) {                                            // attach a hard hat in the bone's space (assumes Y-up rig)
      const helmet = new THREE.Mesh(G.crown, new THREE.MeshPhysicalMaterial({ color: hat, roughness: 0.32, clearcoat: 0.9 }));
      helmet.position.y = 0.12 / s.scale.y; helmet.scale.setScalar(1 / s.scale.y);
      headBone.add(helmet);
    }
    return s;
  }, [scene, hat]);
  const { actions, names } = useAnimations(animations, root);
  const current = useRef<string | null>(null);
  useFrame(() => {
    const want = pose.current.speed > 0.1 ? names.find((n) => /walk|run/i.test(n)) : names.find((n) => /idle/i.test(n));
    if (want && want !== current.current) { actions[current.current ?? ""]?.fadeOut(0.2); actions[want]?.reset().fadeIn(0.2).play(); current.current = want; }
  });
  return <primitive object={root} />;
}

/** Real worker.glb when it is present, else the procedural articulated technician. */
export function WorkerBody({ hat, pose }: { hat: string; pose: { current: Pose } }) {
  const glb = useAssetAvailable("/models/worker.glb");
  return glb ? <Suspense fallback={<Humanoid hat={hat} pose={pose} />}><WorkerGlbModel hat={hat} pose={pose} /></Suspense> : <Humanoid hat={hat} pose={pose} />;
}
