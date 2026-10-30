import { describe, expect, it } from 'vitest';
import { getTranslator } from '@/lib/messages';
import { formatWindow } from '@/ui/template/showcase-window';

/** A buffet card's days and hours, as the guest carousel writes them. */

const en = getTranslator('en');
const ar = getTranslator('ar');
const MON_FRI = 0b0011111;

describe('formatWindow', () => {
  it('says every day and all day for an open window', () => {
    expect(formatWindow({ startMinute: null, endMinute: null, daysOfWeek: 127 }, en, 'latn')).toEqual({ days: 'Every day', hours: 'All day' });
  });

  it('writes a run of three or more days as a range, and the hours as from–to', () => {
    expect(formatWindow({ startMinute: 12 * 60, endMinute: 23 * 60 + 30, daysOfWeek: MON_FRI }, en, 'latn')).toEqual({
      days: 'Monday–Friday',
      hours: '12:00–23:30',
    });
  });

  it('lists days that are not a run, Monday first', () => {
    // Bit 0 is Monday: Friday (4) and Sunday (6).
    expect(formatWindow({ startMinute: 18 * 60, endMinute: 60, daysOfWeek: (1 << 4) | (1 << 6) }, en, 'latn')).toEqual({
      days: 'Friday, Sunday',
      hours: '18:00–01:00',
    });
  });

  it('leaves the days out when none is set', () => {
    expect(formatWindow({ startMinute: 9 * 60, endMinute: 11 * 60, daysOfWeek: 0 }, en, 'latn').days).toBeNull();
  });

  it('uses the guest language and the menu digits', () => {
    expect(formatWindow({ startMinute: 12 * 60, endMinute: 23 * 60, daysOfWeek: 127 }, ar, 'arab')).toEqual({
      days: ar('showcase.everyDay'),
      hours: '١٢:٠٠–٢٣:٠٠',
    });
  });
});
