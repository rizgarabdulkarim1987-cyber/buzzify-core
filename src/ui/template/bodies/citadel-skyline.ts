/**
 * The Erbil Citadel's scene (CitadelBody), taken from its mockup: a dusk sky behind the citadel mound, its wall and the
 * houses on it, whose windows light one after another. The scene is the shape's own and the same on every palette (a
 * sunset behind a dark wall); the menu under it takes the palette. The pure data and rules are unit-tested.
 */
export const SKY = {
  skyTop: '#24164A',
  skyMid: '#7A3550',
  skyLow: '#E98A4A',
  skyHorizon: '#F5C27A',
  mound: '#3A2230',
  wall: '#4A2C3A',
  front: '#2A1622',
  windowUpper: '#FFD27A',
  windowLower: '#FFC35A',
  bird: '#2A1730',
} as const;

/** The scene's drawing box (the SVG's viewBox). */
export const SCENE = { width: 430, height: 150 } as const;

/** The wall's face: the windows stand inside it (x from 50 to 380, y from 52 down to the mound's front). */
export const WALL = { left: 50, right: 380, top: 52, bottom: 130 } as const;

/** The top-left corners of the upper windows along the wall; each has a lower one under it. */
export const WINDOW_AT: readonly (readonly [number, number])[] = [
  [70, 70],
  [96, 62],
  [124, 70],
  [150, 58],
  [178, 66],
  [206, 54],
  [232, 62],
  [262, 58],
  [290, 66],
  [318, 60],
  [346, 70],
];

export interface SceneWindow {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Which of the two rows: the upper windows are paler. */
  row: 'upper' | 'lower';
  /** The window lights this long after the scene appears, in milliseconds: they light one after another. */
  delay: number;
}

/** The first window lights this soon after the scene appears, and each next one this much later. */
export const LIGHT_FIRST = 400;
export const LIGHT_STEP = 140;
/** A window's own light-up (glow, dim, glow), once. */
export const LIGHT_MS = 1600;

/** Every window of the scene: for each house an upper window and a lower one a little later. */
export function sceneWindows(): SceneWindow[] {
  return WINDOW_AT.flatMap(([x, y], at) => [
    { x, y, w: 7, h: 9, row: 'upper' as const, delay: LIGHT_FIRST + at * LIGHT_STEP },
    { x: x + 4, y: y + 18, w: 6, h: 8, row: 'lower' as const, delay: LIGHT_FIRST + 200 + at * LIGHT_STEP },
  ]);
}

/** When the last window has finished lighting, in milliseconds: the scene is at rest by then. */
export function sceneEndsAt(): number {
  return Math.max(...sceneWindows().map((window) => window.delay)) + LIGHT_MS;
}

/** The birds: where each flies (px from the hero's top), for how long, and when it starts (ms); each crosses once. */
export const BIRDS: readonly { top: number; ms: number; delay: number }[] = [
  { top: 14, ms: 4200, delay: 300 },
  { top: 30, ms: 4000, delay: 600 },
  { top: 8, ms: 3800, delay: 900 },
];
