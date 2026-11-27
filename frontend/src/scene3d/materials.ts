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
const texCache = new Map<string, THREE.Texture>();
const tex = (k: keyof typeof TEX) => { let t = texCache.get(k); if (!t) { t = TEX[k](); texCache.set(k, t); } return t; };

// ------------------------------------------------------------------ presets
type P = THREE.MeshPhysicalMaterialParameters;
const PRESETS: Record<MatName, () => P> = {
  robotOrange: () => ({ color: "#f06a0f", metalness: 0.15, roughness: 0.42, clearcoat: 0.6, clearcoatRoughness: 0.25, roughnessMap: tex("noise") }),
  robotYellow: () => ({ color: "#f2b705", metalness: 0.15, roughness: 0.42, clearcoat: 0.6, clearcoatRoughness: 0.25, roughnessMap: tex("noise") }),
  graphite: () => ({ color: "#2b2f36", metalness: 0.35, roughness: 0.55, clearcoat: 0.2, roughnessMap: tex("noise") }),
  castIron: () => ({ color: "#4a4f57", metalness: 0.55, roughness: 0.72, roughnessMap: tex("noise") }),
  steel: () => ({ color: "#a7adb5", metalness: 0.95, roughness: 0.32, roughnessMap: tex("brushed") }),
  chrome: () => ({ color: "#e8ecf1", metalness: 1, roughness: 0.06 }),
  brushedAlu: () => ({ color: "#c9ced6", metalness: 0.9, roughness: 0.38, roughnessMap: tex("brushed"), anisotropy: 0.6 }),
  anodized: () => ({ color: "#9aa3ad", metalness: 0.8, roughness: 0.45 }),
  copper: () => ({ color: "#c46a3a", metalness: 1, roughness: 0.28 }),
  brass: () => ({ color: "#c9a24a", metalness: 1, roughness: 0.3 }),
  rubber: () => ({ color: "#17191c", metalness: 0, roughness: 0.92 }),
  glass: () => ({ color: "#dbeafe", metalness: 0, roughness: 0.05, transmission: 0.92, thickness: 0.02, ior: 1.5, transparent: true, opacity: 0.35 }),
  smokedGlass: () => ({ color: "#0f172a", metalness: 0.2, roughness: 0.05, transparent: true, opacity: 0.75, clearcoat: 1 }),
  sheetWhite: () => ({ color: "#e8ebee", metalness: 0.25, roughness: 0.38, clearcoat: 0.5, clearcoatRoughness: 0.3 }),
  sheetGrey: () => ({ color: "#7d8691", metalness: 0.35, roughness: 0.45, clearcoat: 0.4 }),
  paintBlue: () => ({ color: "#1f4fae", metalness: 0.25, roughness: 0.4, clearcoat: 0.5 }),
  paintRed: () => ({ color: "#b3201f", metalness: 0.2, roughness: 0.45, clearcoat: 0.5, roughnessMap: tex("noise") }),
  paintGreen: () => ({ color: "#2f7d4f", metalness: 0.2, roughness: 0.45, clearcoat: 0.4 }),
  safetyYellow: () => ({ color: "#f5c400", metalness: 0.2, roughness: 0.45, clearcoat: 0.4 }),
  cabinet: () => ({ color: "#c9ccd1", metalness: 0.3, roughness: 0.5, roughnessMap: tex("noise") }),
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

export const isEmissivePreset = (m: MatName) => m.startsWith("led") || m === "screen" || m === "laser";

/** A fresh material per part (parts change colour individually for faults, selection, ghosting, X-ray). */
export function makeMaterial(name: MatName, tint?: string) {
  const p = PRESETS[name]();
  const m = new THREE.MeshPhysicalMaterial(p);
  if (tint) m.color.set(tint);
  m.userData.base = { color: m.color.clone(), emissive: m.emissive.clone(), emissiveIntensity: m.emissiveIntensity, opacity: m.opacity, transparent: m.transparent };
  return m;
}

export const beltTexture = () => tex("belt");
