// PBR material library with procedural textures (no downloads): powder-coat, cast iron, brushed aluminium, chrome,
// copper, rubber, tempered glass, sheet metal, perforated guards, wood, textured belt, LEDs.
import * as THREE from "three";
import type { MatName } from "../twin/types";

// ------------------------------------------------------------------ procedural canvas textures
function canvasTex(size: number, draw: (c: CanvasRenderingContext2D, s: number) => void, repeat = 1, color = false) {
  const cv = document.createElement("canvas");
  cv.width = cv.height = size;
  draw(cv.getContext("2d")!, size);
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 8;
  if (color) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

const TEX = {
  noise: () => canvasTex(256, (c, s) => {          // speckled roughness for castings & powder coat
    const img = c.createImageData(s, s);
    for (let i = 0; i < s * s; i++) { const v = 150 + rnd() * 70; img.data.set([v, v, v, 255], i * 4); }
    c.putImageData(img, 0, 0);
  }, 3),
  brushed: () => canvasTex(512, (c, s) => {        // brushed metal streaks
    c.fillStyle = "#808080"; c.fillRect(0, 0, s, s);
    for (let i = 0; i < 1400; i++) { c.strokeStyle = `rgba(${rnd() > 0.5 ? 255 : 0},${rnd() > 0.5 ? 255 : 0},255,${0.04 + rnd() * 0.06})`; const y = rnd() * s; c.beginPath(); c.moveTo(0, y); c.lineTo(s, y + rnd() * 2); c.stroke(); }
  }, 2),
  perforated: () => canvasTex(128, (c, s) => {     // alpha map of a perforated sheet
    c.fillStyle = "#fff"; c.fillRect(0, 0, s, s); c.fillStyle = "#000";
    for (let y = 8; y < s; y += 16) for (let x = (y / 16) % 2 ? 16 : 8; x < s; x += 16) { c.beginPath(); c.arc(x, y, 5, 0, Math.PI * 2); c.fill(); }
  }, 6),
  belt: () => canvasTex(256, (c, s) => {           // rubber belt with chevrons
    c.fillStyle = "#1a1c1f"; c.fillRect(0, 0, s, s); c.strokeStyle = "#2c2f34"; c.lineWidth = 10;
    for (let x = -s; x < s * 2; x += 48) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x + 30, s / 2); c.lineTo(x, s); c.stroke(); }
  }, 1, true),
  wood: () => canvasTex(256, (c, s) => {
    c.fillStyle = "#b07a45"; c.fillRect(0, 0, s, s);
    for (let i = 0; i < 70; i++) { c.strokeStyle = `rgba(90,55,25,${0.15 + rnd() * 0.25})`; c.lineWidth = 1 + rnd() * 3; const y = rnd() * s; c.beginPath(); c.moveTo(0, y); c.bezierCurveTo(s / 3, y + 6, (2 * s) / 3, y - 6, s, y + 2); c.stroke(); }
  }, 1, true),
  screen: () => canvasTex(256, (c, s) => {         // HMI screen with trend lines
    c.fillStyle = "#071427"; c.fillRect(0, 0, s, s);
    c.strokeStyle = "#22d3ee"; c.lineWidth = 3; c.beginPath();
    for (let x = 0; x < s; x += 4) c.lineTo(x, s * 0.6 + Math.sin(x / 18) * 20 + rnd() * 6); c.stroke();
    c.fillStyle = "#22c55e"; c.fillRect(16, 16, 60, 18); c.fillStyle = "#94a3b8"; for (let i = 0; i < 5; i++) c.fillRect(16, 50 + i * 16, 90 + rnd() * 60, 8);
  }, 1, true),
};
/** Normal map from a procedural height field (Sobel): blur radius sets the feature size. */
function normalTex(size: number, height: (x: number, y: number) => number, strength: number, repeat: number) {
  const h = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) h[y * size + x] = height(x, y);
  const at = (x: number, y: number) => h[((y + size) % size) * size + ((x + size) % size)];
  return canvasTex(size, (c) => {
    const img = c.createImageData(size, size);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength, dy = (at(x, y + 1) - at(x, y - 1)) * strength, l = Math.hypot(dx, dy, 1);
      img.data.set([(-dx / l) * 127 + 128, (-dy / l) * 127 + 128, (1 / l) * 127 + 128, 255], (y * size + x) * 4);
    }
    c.putImageData(img, 0, 0);
  }, repeat);
}
/** Smooth value noise (tileable) for orange peel and cast porosity. */
function valueNoise(size: number, cell: number) {
  const n = size / cell, g = Array.from({ length: n * n }, rnd);
  const v = (i: number, j: number) => g[((j + n) % n) * n + ((i + n) % n)];
  return (x: number, y: number) => {
    const fx = x / cell, fy = y / cell, i = Math.floor(fx), j = Math.floor(fy), u = fx - i, w = fy - j;
    const s = (t: number) => t * t * (3 - 2 * t);
    return (v(i, j) * (1 - s(u)) + v(i + 1, j) * s(u)) * (1 - s(w)) + (v(i, j + 1) * (1 - s(u)) + v(i + 1, j + 1) * s(u)) * s(w);
  };
}
const NORMALS = {
  peel: () => { const a = valueNoise(256, 8), b = valueNoise(256, 32); return normalTex(256, (x, y) => a(x, y) * 0.6 + b(x, y) * 0.4, 1.2, 3); },   // powder-coat orange peel
  cast: () => { const a = valueNoise(256, 4), b = valueNoise(256, 16); return normalTex(256, (x, y) => a(x, y) + b(x, y) * 0.8 - (rnd() > 0.995 ? 3 : 0), 2.4, 3); },  // sand-cast porosity
  rubber: () => { const a = valueNoise(128, 4); return normalTex(128, (x, y) => a(x, y), 0.8, 4); },
};
/** Roughness with micro-scratches and wear (worn paint is glossier along the scratches). */
const scratches = () => canvasTex(512, (c, s) => {
  c.fillStyle = "#8c8c8c"; c.fillRect(0, 0, s, s);
  for (let i = 0; i < 9000; i++) { const v = 120 + rnd() * 50; c.fillStyle = `rgb(${v},${v},${v})`; c.fillRect(rnd() * s, rnd() * s, 2, 2); }
  for (let i = 0; i < 260; i++) {
    c.strokeStyle = `rgba(40,40,40,${0.25 + rnd() * 0.4})`; c.lineWidth = 0.6 + rnd();
    const x = rnd() * s, y = rnd() * s, a = rnd() * Math.PI, l = 8 + rnd() * 60;
    c.beginPath(); c.moveTo(x, y); c.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); c.stroke();
  }
}, 2);
const nCache = new Map<string, THREE.Texture>();
const nrm = (k: keyof typeof NORMALS) => { let t = nCache.get(k); if (!t) { t = NORMALS[k](); nCache.set(k, t); } return t; };
let scratchTex: THREE.Texture | null = null;
const scr = () => (scratchTex ??= scratches());
const PAINT = () => ({ normalMap: nrm("peel"), normalScale: new THREE.Vector2(0.35, 0.35), roughnessMap: scr() });

const texCache = new Map<string, THREE.Texture>();
const tex = (k: keyof typeof TEX) => { let t = texCache.get(k); if (!t) { t = TEX[k](); texCache.set(k, t); } return t; };

// ------------------------------------------------------------------ presets
type P = THREE.MeshPhysicalMaterialParameters;
const PRESETS: Record<MatName, () => P> = {
  robotOrange: () => ({ color: "#f06a0f", metalness: 0.15, roughness: 0.42, clearcoat: 0.6, clearcoatRoughness: 0.25, ...PAINT() }),
  robotYellow: () => ({ color: "#f2b705", metalness: 0.15, roughness: 0.42, clearcoat: 0.6, clearcoatRoughness: 0.25, ...PAINT() }),
  graphite: () => ({ color: "#2b2f36", metalness: 0.35, roughness: 0.55, clearcoat: 0.2, ...PAINT() }),
  castIron: () => ({ color: "#4a4f57", metalness: 0.55, roughness: 0.72, roughnessMap: tex("noise"), normalMap: nrm("cast"), normalScale: new THREE.Vector2(0.6, 0.6) }),
  steel: () => ({ color: "#a7adb5", metalness: 0.95, roughness: 0.32, roughnessMap: tex("brushed") }),
  chrome: () => ({ color: "#e8ecf1", metalness: 1, roughness: 0.06 }),
  brushedAlu: () => ({ color: "#c9ced6", metalness: 0.9, roughness: 0.38, roughnessMap: tex("brushed"), anisotropy: 0.6 }),
  anodized: () => ({ color: "#9aa3ad", metalness: 0.8, roughness: 0.45 }),
  copper: () => ({ color: "#c46a3a", metalness: 1, roughness: 0.28 }),
  brass: () => ({ color: "#c9a24a", metalness: 1, roughness: 0.3 }),
  rubber: () => ({ color: "#17191c", metalness: 0, roughness: 0.92, normalMap: nrm("rubber"), normalScale: new THREE.Vector2(0.4, 0.4) }),
  glass: () => ({ color: "#dbeafe", metalness: 0, roughness: 0.05, transmission: 0.92, thickness: 0.02, ior: 1.5, transparent: true, opacity: 0.35 }),
  smokedGlass: () => ({ color: "#0f172a", metalness: 0.2, roughness: 0.05, transparent: true, opacity: 0.75, clearcoat: 1 }),
  sheetWhite: () => ({ color: "#e8ebee", metalness: 0.25, roughness: 0.38, clearcoat: 0.5, clearcoatRoughness: 0.3 }),
  sheetGrey: () => ({ color: "#7d8691", metalness: 0.35, roughness: 0.45, clearcoat: 0.4, ...PAINT() }),
  paintBlue: () => ({ color: "#1f4fae", metalness: 0.25, roughness: 0.4, clearcoat: 0.5, ...PAINT() }),
  paintRed: () => ({ color: "#b3201f", metalness: 0.2, roughness: 0.45, clearcoat: 0.5, ...PAINT() }),
  paintGreen: () => ({ color: "#2f7d4f", metalness: 0.2, roughness: 0.45, clearcoat: 0.4, ...PAINT() }),
  safetyYellow: () => ({ color: "#f5c400", metalness: 0.2, roughness: 0.45, clearcoat: 0.4, ...PAINT() }),
  cabinet: () => ({ color: "#c9ccd1", metalness: 0.3, roughness: 0.5, ...PAINT() }),
  plasticBlack: () => ({ color: "#1d2127", metalness: 0, roughness: 0.55 }),
  wood: () => ({ map: tex("wood"), metalness: 0, roughness: 0.85 }),
  belt: () => ({ map: tex("belt"), metalness: 0, roughness: 0.85 }),
  perforated: () => ({ color: "#5d6670", metalness: 0.6, roughness: 0.45, alphaMap: tex("perforated"), transparent: true, alphaTest: 0.5, side: THREE.DoubleSide }),
  ledGreen: () => ({ color: "#22c55e", emissive: "#22c55e", emissiveIntensity: 3, toneMapped: false }),
  ledRed: () => ({ color: "#ef4444", emissive: "#ef4444", emissiveIntensity: 3, toneMapped: false }),
  ledBlue: () => ({ color: "#38bdf8", emissive: "#38bdf8", emissiveIntensity: 2.5, toneMapped: false }),
  ledWhite: () => ({ color: "#ffffff", emissive: "#fff7ed", emissiveIntensity: 3, toneMapped: false }),
  screen: () => ({ map: tex("screen"), emissiveMap: tex("screen"), emissive: "#ffffff", emissiveIntensity: 1.2, roughness: 0.2 }),
  laser: () => ({ color: "#ff2020", emissive: "#ff2020", emissiveIntensity: 4, transparent: true, opacity: 0.55, toneMapped: false }),
  oil: () => ({ color: "#d97706", metalness: 0, roughness: 0.1, transparent: true, opacity: 0.7 }),
};

// oil and dust collect near the floor: painted and cast surfaces darken and get glossier in the lowest ~0.5 m (world space)
const GRIMY = new Set<MatName>(["robotOrange", "robotYellow", "graphite", "castIron", "sheetGrey", "sheetWhite", "paintBlue", "paintRed", "paintGreen", "safetyYellow", "cabinet"]);
function addGrime(m: THREE.MeshPhysicalMaterial) {
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying float vGrimeY;")
      .replace("#include <project_vertex>", "#include <project_vertex>\nvGrimeY = (modelMatrix * vec4(transformed, 1.0)).y;");
    sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nvarying float vGrimeY;")
      .replace("#include <color_fragment>", "#include <color_fragment>\nfloat grime = 1.0 - smoothstep(0.02, 0.55, vGrimeY);\ndiffuseColor.rgb *= 1.0 - 0.45 * grime;")
      .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.3, grime * 0.6);");
  };
  m.customProgramCacheKey = () => "grime";
}

export const isEmissivePreset = (m: MatName) => m.startsWith("led") || m === "screen" || m === "laser";

/** A fresh material per part (parts change colour individually for faults, selection, ghosting, X-ray). */
export function makeMaterial(name: MatName, tint?: string) {
  const p = PRESETS[name]();
  const m = new THREE.MeshPhysicalMaterial(p);
  if (tint) m.color.set(tint);
  if (GRIMY.has(name)) addGrime(m);
  m.userData.base = { color: m.color.clone(), emissive: m.emissive.clone(), emissiveIntensity: m.emissiveIntensity, opacity: m.opacity, transparent: m.transparent };
  return m;
}

export const beltTexture = () => tex("belt");
