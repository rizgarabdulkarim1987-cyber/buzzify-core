import { describe, expect, it } from 'vitest';
import { zonedLocalToUtc } from '@/server/domain/schedule-time';

describe('zonedLocalToUtc', () => {
  it('reads a wall-clock time in the menu’s zone', () => {
    expect(zonedLocalToUtc('2026-11-01T09:00', 'Asia/Baghdad').toISOString()).toBe('2026-11-01T06:00:00.000Z');
    expect(zonedLocalToUtc('2026-11-01T09:00', 'UTC').toISOString()).toBe('2026-11-01T09:00:00.000Z');
  });

  it('moves a time in a daylight-saving gap forward to the first valid minute', () => {
    // 02:30 does not exist in Berlin on that night: clocks go from 02:00 to 03:00 CEST.
    expect(zonedLocalToUtc('2027-03-28T02:30', 'Europe/Berlin').toISOString()).toBe('2027-03-28T01:00:00.000Z');
  });

  it('takes the earlier of the two instants of an hour that happens twice', () => {
    expect(zonedLocalToUtc('2026-10-25T02:30', 'Europe/Berlin').toISOString()).toBe('2026-10-25T00:30:00.000Z');
  });

  it('refuses something that is not a local time', () => {
    expect(() => zonedLocalToUtc('tomorrow', 'Asia/Baghdad')).toThrow();
    expect(() => zonedLocalToUtc('2026-13-01T09:00', 'Asia/Baghdad')).toThrow();
  });
});
