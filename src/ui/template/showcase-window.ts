import { localDigits } from '@/lib/digits';
import type { Translate } from '@/lib/i18n';
import type { ShowcaseCardView } from '@/server/data/menu-view';

/** A run of this many days or more in a row reads as a range ("Monday–Friday") rather than a list. */
const RANGE_FROM = 3;

const clock = (minute: number) => `${String(Math.floor(minute / 60) % 24).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;

/**
 * A buffet card's days and hours in the guest's language and the menu's digits: "Every day" or "Monday–Friday" or
 * "Friday, Sunday" (bit 0 is Monday, as in the menu's schedule), and "All day" or "12:00–23:00". No days set leaves
 * the days out.
 */
export function formatWindow(
  when: NonNullable<ShowcaseCardView['when']>,
  t: Translate,
  numerals: 'latn' | 'arab',
): { days: string | null; hours: string } {
  const hours =
    when.startMinute === null || when.endMinute === null
      ? t('showcase.allDay')
      : localDigits(`${clock(when.startMinute)}–${clock(when.endMinute)}`, numerals);

  const on = [0, 1, 2, 3, 4, 5, 6].filter((day) => (when.daysOfWeek & (1 << day)) !== 0);
  if (on.length === 0) return { days: null, hours };
  if (on.length === 7) return { days: t('showcase.everyDay'), hours };

  const runs: number[][] = [];
  for (const day of on) {
    const last = runs.at(-1);
    if (last && last.at(-1) === day - 1) last.push(day);
    else runs.push([day]);
  }
  const name = (day: number) => t(`offers.weekday.${day}`);
  const days = runs
    .flatMap((run) => (run.length >= RANGE_FROM ? [`${name(run[0]!)}–${name(run.at(-1)!)}`] : run.map(name)))
    .join(', ');
  return { days, hours };
}
