import { describe, expect, it } from 'vitest';
import { formatMoney, minorUnitDigits } from '@/server/domain/money';

describe('money', () => {
  it('knows minor unit digits per currency', () => {
    expect(minorUnitDigits('USD')).toBe(2);
    expect(minorUnitDigits('IQD')).toBe(0);
  });

  it('formats USD from integer cents', () => {
    expect(formatMoney(900, 'USD', 'en')).toBe('$9.00');
    expect(formatMoney(0, 'USD', 'en')).toBe('$0.00');
  });

  it('formats IQD without decimals', () => {
    const text = formatMoney(15000, 'IQD', 'en');
    expect(text).toMatch(/15,000/);
    expect(text).not.toMatch(/\./);
  });

  it('honours the numeral system', () => {
    const latin = formatMoney(1250, 'USD', 'ar', 'latn');
    const arabic = formatMoney(1250, 'USD', 'ar', 'arab');
    expect(latin).toMatch(/12\.50|12,50/);
    expect(arabic).toMatch(/[٠-٩]/);
  });

  it('does not throw for Sorani', () => {
    expect(() => formatMoney(500, 'USD', 'ckb')).not.toThrow();
  });
});
