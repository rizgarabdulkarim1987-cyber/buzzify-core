import { describe, expect, it } from 'vitest';
import { normalizePhone } from '@/lib/phone';

describe('normalizePhone', () => {
  it('writes Arabic-Indic and Persian digits as ASCII and drops spaces and dashes', () => {
    expect(normalizePhone('٠٧٧٠ ١٢٣-٤٥٦٧')).toBe('07701234567');
    expect(normalizePhone('۰۷۷۰۱۲۳۴۵۶۷')).toBe('07701234567');
    expect(normalizePhone('+964 770 123 4567')).toBe('+9647701234567');
    expect(normalizePhone('(0770) 123.4567')).toBe('07701234567');
  });

  it('answers an empty string for anything that is not a phone number', () => {
    for (const bad of ['abc', '123', '1234567890123456', '+', '07 70 12 3 4 5 6 x', '', '   ']) expect(normalizePhone(bad)).toBe('');
  });
});
