/** The moods a dated occasion can give the menu (plan feature `guest.occasionMoods`). */
export const OCCASION_MOODS = ['RAMADAN', 'NEWROZ', 'EID'] as const;
export type OccasionMood = (typeof OCCASION_MOODS)[number];

export function isOccasionMood(value: unknown): value is OccasionMood {
  return typeof value === 'string' && (OCCASION_MOODS as readonly string[]).includes(value);
}
