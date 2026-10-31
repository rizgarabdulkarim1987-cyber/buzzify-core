/**
 * Seasonal particles (docs/superpowers/specs/2026-11-01-project-6-seasonal-particles-design.md): one effect a menu may float
 * over its pages. The list is shared by the database check, the Studio's picker and the guests' canvas.
 */

export const SEASON_EFFECTS = ['snow', 'leaves', 'petals', 'sparks', 'confetti'] as const;
export type SeasonEffect = (typeof SEASON_EFFECTS)[number];

export function isSeasonEffect(value: unknown): value is SeasonEffect {
  return typeof value === 'string' && (SEASON_EFFECTS as readonly string[]).includes(value);
}

/** The effect guests see: the stored one when it is a known effect and the plan holds the feature, else none. */
export function guestSeason(stored: unknown, allowed: boolean): SeasonEffect | null {
  return allowed && isSeasonEffect(stored) ? stored : null;
}
