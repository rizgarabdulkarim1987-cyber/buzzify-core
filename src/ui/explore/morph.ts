/**
 * Where the melt is, as a pure function of scroll progress (in scene units: scene i rests at i).
 *
 * Inside a small band around each scene the dish is the solid model. Between two scenes it is a
 * cloud of grains on its way from `from` to `to`, and `t` says how far (0 has just left `from`,
 * 1 has just arrived at `to`).
 */

/** Half-width, in scene units, of the band around each scene where the dish stays solid. */
export const REST_BAND = 0.06;

export interface MorphState {
  from: number;
  to: number;
  t: number;
  /** The scene shown as a solid model, or null while grains are in flight. */
  resting: number | null;
}

export function morphState(progress: number, count: number): MorphState {
  const last = Math.max(0, count - 1);
  const p = Math.min(last, Math.max(0, progress));
  const from = Math.min(last, Math.floor(p));
  if (from >= last) return { from: last, to: last, t: 0, resting: last };
  const to = from + 1;
  const fraction = p - from;
  if (fraction <= REST_BAND) return { from, to, t: 0, resting: from };
  if (fraction >= 1 - REST_BAND) return { from, to, t: 1, resting: to };
  return { from, to, t: (fraction - REST_BAND) / (1 - 2 * REST_BAND), resting: null };
}
