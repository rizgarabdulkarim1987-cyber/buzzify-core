/**
 * The orbit family's geometry (The Solar System, The Tannour, The Daf): every section is a circle, its dishes on one
 * ring round the centre. All numbers are percent of the circle's width (the circle is square), so the CSS places them
 * with container units and the ring scales with the screen.
 */

/** How many dishes one ring holds: the rest of a section continue as a compact list under its circle. */
export const ORBIT_CAP = 6;

/** The ring's radius: where the centres of the dishes' photos sit, from the circle's centre. */
export const ORBIT_RADIUS = 39;

/**
 * The room a dish's words take under its photo on a phone (two lines of name and the price, about 53px of a 343px
 * circle), so neighbours never cover them.
 */
export const ORBIT_LABEL = 16;

/** How a section's dishes split: the first `ring` go round the circle, the other `rest` into the list under it. */
export function orbitSplit(count: number, cap: number = ORBIT_CAP): { ring: number; rest: number } {
  const total = Math.max(0, Math.floor(count));
  const ring = Math.min(total, Math.max(1, cap));
  return { ring, rest: total - ring };
}

/**
 * Where the `at`th of `count` dishes sits on a ring of `radius`: the first at the top, the others clockwise at equal
 * steps. `x` runs from the inline start, so a right-to-left page mirrors the ring.
 */
export function orbitPlace(at: number, count: number, radius: number = ORBIT_RADIUS): { x: number; y: number } {
  const angle = ((-90 + (at * 360) / Math.max(1, count)) * Math.PI) / 180;
  return { x: round(50 + radius * Math.cos(angle)), y: round(50 + radius * Math.sin(angle)) };
}

/**
 * A dish's photo width on a ring of `count`: as large as the ring allows while two neighbours, at any turn of the ring
 * (the words always hang under the photo), keep the photo and the words of one clear of the other.
 */
export function orbitSize(count: number): number {
  if (count <= 5) return 24;
  if (count === 6) return 22;
  return 18;
}

/** The distance between two neighbours' centres on a ring of `count` (the chord), in percent of the circle's width. */
export function orbitChord(count: number, radius: number = ORBIT_RADIUS): number {
  return count < 2 ? Infinity : 2 * radius * Math.sin(Math.PI / count);
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
