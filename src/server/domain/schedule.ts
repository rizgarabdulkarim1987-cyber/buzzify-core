import type { Daypart, DaypartWindow } from './types';

export const ALL_DAYS = 0b1111111;

const DAY_INDEX: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };

/** `day` is 0 for Monday through 6 for Sunday; `minute` is minutes since local midnight. */
export function localClock(now: Date, timeZone: string): { day: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return {
    day: DAY_INDEX[get('weekday')] ?? 0,
    minute: Number(get('hour')) * 60 + Number(get('minute')),
  };
}

export function currentDaypart(
  now: Date,
  windows: readonly DaypartWindow[],
  timeZone: string,
): Daypart | null {
  const { day, minute } = localClock(now, timeZone);
  const previous = (day + 6) % 7;
  const onDay = (mask: number, index: number) => (mask & (1 << index)) !== 0;

  for (const window of windows) {
    if (window.startMinute <= window.endMinute) {
      if (onDay(window.daysOfWeek, day) && minute >= window.startMinute && minute < window.endMinute) {
        return window.daypart;
      }
    } else {
      if (onDay(window.daysOfWeek, day) && minute >= window.startMinute) return window.daypart;
      if (onDay(window.daysOfWeek, previous) && minute < window.endMinute) return window.daypart;
    }
  }
  return null;
}
