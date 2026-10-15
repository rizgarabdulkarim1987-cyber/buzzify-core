import { describe, expect, it } from 'vitest';
import { currentDaypart, localClock } from '@/server/domain/schedule';
import type { DaypartWindow } from '@/server/domain/types';

const TZ = 'Asia/Baghdad';
const windows: DaypartWindow[] = [
  { daypart: 'BREAKFAST', startMinute: 420, endMinute: 660, daysOfWeek: 127 },
  { daypart: 'LUNCH', startMinute: 660, endMinute: 960, daysOfWeek: 127 },
  { daypart: 'DINNER', startMinute: 960, endMinute: 1320, daysOfWeek: 127 },
  { daypart: 'LATE_NIGHT', startMinute: 1320, endMinute: 180, daysOfWeek: 127 },
];
// Local Baghdad time is UTC+3 with no daylight saving.
const at = (hour: number, minute = 0, day = 15) => new Date(Date.UTC(2026, 9, day, hour - 3, minute));

describe('localClock', () => {
  it('converts an instant to the restaurant timezone', () => {
    expect(localClock(at(10, 30), TZ)).toEqual({ day: 3, minute: 630 });
  });
});

describe('currentDaypart', () => {
  it('resolves ordinary windows with an inclusive start and exclusive end', () => {
    expect(currentDaypart(at(7, 0), windows, TZ)).toBe('BREAKFAST');
    expect(currentDaypart(at(10, 59), windows, TZ)).toBe('BREAKFAST');
    expect(currentDaypart(at(11, 0), windows, TZ)).toBe('LUNCH');
    expect(currentDaypart(at(21, 59), windows, TZ)).toBe('DINNER');
  });

  it('handles the window that wraps past midnight', () => {
    expect(currentDaypart(at(22, 0), windows, TZ)).toBe('LATE_NIGHT');
    expect(currentDaypart(at(23, 59), windows, TZ)).toBe('LATE_NIGHT');
    expect(currentDaypart(at(0, 30), windows, TZ)).toBe('LATE_NIGHT');
    expect(currentDaypart(at(2, 59), windows, TZ)).toBe('LATE_NIGHT');
  });

  it('returns null when no window applies', () => {
    expect(currentDaypart(at(3, 0), windows, TZ)).toBeNull();
    expect(currentDaypart(at(6, 59), windows, TZ)).toBeNull();
  });

  it('applies the day mask, including the previous day for wrapped windows', () => {
    // Monday only (bit 0). 2026-10-15 is a Thursday, 2026-10-12 a Monday.
    const mondayOnly: DaypartWindow[] = [{ daypart: 'LATE_NIGHT', startMinute: 1320, endMinute: 180, daysOfWeek: 1 }];
    expect(currentDaypart(at(23, 0, 15), mondayOnly, TZ)).toBeNull();
    expect(currentDaypart(at(23, 0, 12), mondayOnly, TZ)).toBe('LATE_NIGHT');
    expect(currentDaypart(at(1, 0, 13), mondayOnly, TZ)).toBe('LATE_NIGHT'); // Tuesday 01:00 belongs to Monday's window
  });

  it('returns null for an empty schedule', () => {
    expect(currentDaypart(at(12, 0), [], TZ)).toBeNull();
  });
});
