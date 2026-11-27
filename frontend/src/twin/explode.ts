// Staggered exploded view: outer parts (low explodeOrder) move first, inner shafts/bearings last.
const ease = (x: number) => (x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2);

/** Progress (0..1) of one part for a global explode factor `e` (0..1). */
export function explodeProgress(e: number, order: number, maxOrder: number): number {
  if (maxOrder <= 0) return ease(Math.max(0, Math.min(1, e)));
  const window = 0.55;                                   // each part moves during 55 % of the slider travel
  const start = (order / maxOrder) * (1 - window);
  return ease(Math.max(0, Math.min(1, (e - start) / window)));
}
