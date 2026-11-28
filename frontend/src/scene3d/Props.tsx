// Shop-floor dressing with real CC0 photo-scanned assets (Poly Haven): tool chests and carts at the stations,
// barrels and a welding cart, cartons at the outfeed, fire extinguishers on the columns, a metal rack, wall piping.
import { Suspense } from "react";
import { ST } from "../twin/layout";
import { useAssetAvailable, useNormalizedModel } from "./assetLoader";
import { useView } from "./context";

type P = { id: string; pos: [number, number, number]; rot?: number; height: number };
const ph = (id: string) => `/models/polyhaven/${id}/${id}.gltf`;
export const PROPS: P[] = [
  { id: "metal_tool_chest", pos: [ST.cnc + 2.4, 0, -2.9], rot: Math.PI, height: 1.05 },
  { id: "tool_cart", pos: [ST.press - 2.3, 0, 2.8], rot: 0.3, height: 0.95 },
  { id: "portable_welding_cart", pos: [9.4, 0, -3.2], rot: Math.PI / 2, height: 1.1 },
  { id: "industrial_storage_cart", pos: [9.4, 0, 3.0], rot: -Math.PI / 2, height: 0.9 },
  { id: "hand_truck", pos: [ST.dispenser + 2.2, 0, 2.6], rot: -0.6, height: 1.2 },
  { id: "cardboard_box_01", pos: [29.6, 0, 3.4], height: 0.45 },
  { id: "cardboard_box_01", pos: [30.2, 0, 3.6], rot: 0.4, height: 0.45 },
  { id: "cardboard_box_01", pos: [29.9, 0.45, 3.5], rot: 1.2, height: 0.45 },
  { id: "Barrel_01", pos: [ST.press + 2.6, 0, -2.6], height: 0.9 },
  { id: "Barrel_01", pos: [ST.press + 3.3, 0, -2.4], rot: 1, height: 0.9 },
  { id: "plastic_crate_03", pos: [ST.vision + 1.6, 0, 2.9], height: 0.32 },
  { id: "power_box_01", pos: [-3.2, 0, -13.2], height: 1.2 },
  { id: "worn_metal_rack", pos: [ST.cnc - 2.5, 0, -6.4], height: 2.0 },
  ...[-36, -16, 4, 24].map((x): P => ({ id: "korean_fire_extinguisher_01", pos: [x + 0.45, 0, -15.5], height: 0.6 })),
  { id: "modular_industrial_pipes_01", pos: [-10, 6.5, -15.6], height: 1.6 },
];

function Model({ p }: { p: P }) {
  const obj = useNormalizedModel(ph(p.id), { height: p.height });
  return <primitive object={obj} position={p.pos} rotation-y={p.rot ?? 0} />;
}
function Prop({ p }: { p: P }) {
  const ok = useAssetAvailable(ph(p.id));
  return ok ? <Suspense fallback={null}><Model p={p} /></Suspense> : null;
}

export function Props() {
  const v = useView();
  return <group visible={v.mode === "factory"}>{PROPS.map((p, i) => <Prop key={i} p={p} />)}</group>;
}
