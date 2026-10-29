/** Whole turns a spin makes before it settles, and how long that takes. */
export const TURNS = 5;
export const SPIN_MS = 4600;

/** The disc's rotation, in degrees, that brings slice `index` of `count` (slice 0 starts at the top, going clockwise) under the pointer at the top: its middle. */
export function angleFor(index: number, count: number): number {
  return 360 - (index + 0.5) * (360 / count);
}

/** The next rotation: past the current one by whole turns, ending on the winner. It only ever grows, so a second spin never runs backwards. */
export function nextRotation(current: number, index: number, count: number): number {
  return Math.ceil(current / 360) * 360 + TURNS * 360 + angleFor(index, count);
}
