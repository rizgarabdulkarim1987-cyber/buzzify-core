/**
 * The Ramadan Nights scene (LanternsBody), taken from its mockup: bunting along the top, a crescent moon and four
 * hanging lanterns that sway and flicker. The night itself (the sky, the moon, the gold) is the template's palette
 * (lanterns.css, so Customize reaches it); only the scene's own colours are fixed here: the bunting's flags and the
 * lanterns' lit glass, which are the same on every palette. Every animation of the scene ends within five seconds.
 */
export const BUNTING = ['#E9A51B', '#C2185B', '#2F9E7A', '#5C6BC0'] as const;

/** How many flags hang on the bunting. */
export const FLAGS = 12;

/** The flag at `index`: its colour, in a cycle of four. */
export function flagColour(index: number): string {
  return BUNTING[((index % BUNTING.length) + BUNTING.length) % BUNTING.length]!;
}

/** The lit glass of a lantern: its core, its middle and its edge, its halo and its cap. */
export const GLASS = { core: '#FFF3C4', mid: '#F0A830', edge: '#8A4A10', halo: 'rgb(255 200 90 / 0.65)', cap: '#C9A24A' } as const;

/** The hanging lanterns: where each hangs (percent along the sky), how long its cord is (px) and where its sway starts (ms). */
export const LANTERNS: readonly { at: number; cord: number; swing: number }[] = [
  { at: 58, cord: 44, swing: 0 },
  { at: 74, cord: 64, swing: 1100 },
  { at: 86, cord: 32, swing: 500 },
  { at: 30, cord: 54, swing: 1600 },
];

/** A swing to one side and back is this long, and the lanterns and the bunting swing this many times, then hang still. */
export const SWAY_MS = 1400;
export const SWAY_TIMES = 3;
/** A lantern's flicker: one dim and bright is this long, this many times. */
export const FLICKER_MS = 1600;
export const FLICKER_TIMES = 3;

/** When the last motion of the scene is over, in milliseconds. */
export function sceneEndsAt(): number {
  return Math.max(SWAY_MS * SWAY_TIMES, FLICKER_MS * FLICKER_TIMES);
}
