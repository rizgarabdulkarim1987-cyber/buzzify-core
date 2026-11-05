import type { Locale } from '@/lib/locale';
import type { OccasionMood } from '@/lib/occasion-moods';
import { localDate } from './offers';
import { isOccasionLive, type CatalogOccasion } from './showcase';
import { resolveText } from './translate';

/** Whole days from `today` to `endsOn` (both `YYYY-MM-DD`); 0 on the last day itself. */
export function daysLeft(endsOn: string, today: string): number {
  const day = 24 * 60 * 60 * 1000;
  return Math.round((Date.parse(`${endsOn}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / day);
}

export interface LiveOccasionMood {
  mood: OccasionMood;
  name: string;
  daysLeft: number;
}

/**
 * The occasion that tints the menu now: of those live today in the menu's time zone that carry a mood, the one that
 * ends soonest (ties by id, so the answer is stable). Null when none does.
 */
export function liveOccasionMood(occasions: readonly CatalogOccasion[], now: Date, timeZone: string, locale: Locale, defaultLocale: Locale = 'en'): LiveOccasionMood | null {
  const today = localDate(now, timeZone);
  const live = occasions
    .filter((occasion) => occasion.mood && isOccasionLive(occasion, now, timeZone))
    .sort((a, b) => (a.endsOn < b.endsOn ? -1 : a.endsOn > b.endsOn ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const first = live[0];
  if (!first?.mood) return null;
  return { mood: first.mood, name: resolveText(first.translations, 'name', locale, defaultLocale), daysLeft: daysLeft(first.endsOn, today) };
}
