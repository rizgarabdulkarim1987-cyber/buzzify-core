import { describe, expect, it } from 'vitest';
import { formatMoney, minorUnitDigits } from '@/server/domain/billing/money';

describe('money', () => {
  it('knows minor unit digits per currency', () => {
    expect(minorUnitDigits('USD')).toBe(2);
    expect(minorUnitDigits('IQD')).toBe(0);
  });

  it('formats IQD without decimals', () => {
    expect(formatMoney(250000, 'IQD', 'en').replace(/\s/g, ' ')).toBe('IQD 250,000');
  });

  it('formats USD from integer cents', () => {
    expect(formatMoney(1999, 'USD', 'en')).toBe('$19.99');
    expect(formatMoney(0, 'USD', 'en')).toBe('$0.00');
  });

  it('formats Arabic and Sorani identically with ar-IQ', () => {
    expect(formatMoney(1999, 'USD', 'ckb')).toBe(formatMoney(1999, 'USD', 'ar'));
  });
});
