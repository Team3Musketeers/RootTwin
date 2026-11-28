// Keeps 3D labels out from under the HUD: screen rectangles of the side panels (refreshed at most every 300 ms)
// and a visibility test for a world point (in front of the camera, inside the canvas, not behind a panel).
import * as THREE from "three";

let rects: DOMRect[] = [], stamp = 0;
function panels() {
  const now = performance.now();
  if (now - stamp > 300) { stamp = now; rects = [...document.querySelectorAll("aside, header")].map((e) => e.getBoundingClientRect()); }
  return rects;
}
const v = new THREE.Vector3();
/** true when `world` projects to a free part of the canvas. */
export function labelVisible(world: THREE.Vector3, camera: THREE.Camera, canvas: HTMLCanvasElement) {
  v.copy(world).project(camera);
  if (v.z > 1 || Math.abs(v.x) > 0.98 || Math.abs(v.y) > 0.98) return false;
  const r = canvas.getBoundingClientRect(), x = r.left + ((v.x + 1) / 2) * r.width, y = r.top + ((1 - v.y) / 2) * r.height;
  return !panels().some((p) => x > p.left - 8 && x < p.right + 8 && y > p.top - 8 && y < p.bottom + 8);
}
