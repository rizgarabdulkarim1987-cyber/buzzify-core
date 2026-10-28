/**
 * The pure maths of the drift family (DriftBody.tsx): each section's row of dishes drifts sideways by itself, the row
 * moved through its own `scrollLeft`, so a guest can still drag it by hand and Arabic (RTL) mirrors it. A row's
 * position here is logical: `at` px from its inline start (0 shows its first dish), whatever the page's direction.
 */

/** How fast a row drifts, in px a second (the mockups' 0.35 px a frame). */
export const DRIFT_SPEED = 20;

/** The dabka's beat in seconds: its rows move one step a beat, and its dancers stamp on the same beat (dabka.css). */
export const DABKA_BEAT = 1.1;

/** How long a row waits after a hand let go of it (a drag's momentum, a wheel, a keyboard scroll) before it drifts again. */
export const DRIFT_REST_MS = 1500;

/**
 * Which way a section's row drifts: forward (towards its end) for the first section of the menu, back for the second,
 * and so on, by its place in the FULL menu, so a search that hides some sections never turns the others around.
 */
export function driftDirection(place: number): 1 | -1 {
  return place % 2 === 0 ? 1 : -1;
}

/** Where a row starts: at its first dish when it drifts forward, at its end when it drifts back. */
export function driftStart(direction: 1 | -1, max: number): number {
  return direction === 1 || max <= 0 ? 0 : max;
}

/**
 * One frame of drift: `at` moves `delta` px in `direction` and turns back at either end of the row (`max` is how far it
 * can scroll), so a row swings to and fro and never jumps. A row that fits needs no drift: it stays at 0.
 */
export function driftStep(at: number, direction: 1 | -1, delta: number, max: number): { at: number; direction: 1 | -1 } {
  if (max <= 0) return { at: 0, direction };
  let next = Math.min(Math.max(at, 0), max) + direction * delta;
  let turned = direction;
  if (next >= max) {
    next = Math.max(0, max - (next - max));
    turned = -1;
  } else if (next <= 0) {
    next = Math.min(max, -next);
    turned = 1;
  }
  return { at: next, direction: turned };
}

/**
 * The dabka's pace at `seconds`: a row steps on the beat instead of gliding. In each beat it moves only in the first
 * `move` share of it (a quick eased step), then stands; the pace averages 1 over a beat, so a dabka row covers the same
 * ground as a gliding one.
 */
export function beatPace(seconds: number, beat = DABKA_BEAT, move = 0.4): number {
  const phase = (((seconds % beat) + beat) % beat) / beat;
  if (phase >= move) return 0;
  return (Math.PI / (2 * move)) * Math.sin((Math.PI * phase) / move);
}

/** A logical position as the row's `scrollLeft`: RTL rows scroll from 0 to negative values in every current browser. */
export function toScrollLeft(at: number, rtl: boolean): number {
  return rtl ? -at : at;
}

/** A row's `scrollLeft` as a logical position (a hand may have moved it). */
export function fromScrollLeft(left: number, rtl: boolean): number {
  return rtl ? -left : left;
}
