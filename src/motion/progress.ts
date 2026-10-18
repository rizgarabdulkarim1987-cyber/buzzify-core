/** Slow at both ends: the shape of a journey a viewer watches from start to end. */
export const easeInOut = (x: number): number => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);

/**
 * The progress a progress-driven motion plays when nothing owns its progress (a gallery card, the Studio's "Auto"): from
 * 0 to 1 over `travel` seconds, a `hold` at 1, back to 0, a `hold` at 0, and again. A page transition seen this way
 * goes forward and back; a scroll motion reads as someone scrolling down and up.
 */
export function pingPong(seconds: number, travel: number, hold: number): number {
  if (seconds <= 0) return 0;
  const period = 2 * (travel + hold);
  const t = seconds % period;
  if (t < travel) return easeInOut(t / travel);
  if (t < travel + hold) return 1;
  if (t < 2 * travel + hold) return 1 - easeInOut((t - travel - hold) / travel);
  return 0;
}
