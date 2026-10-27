import { describe, expect, it } from 'vitest';
import { checkDigitStatus, looksNumericLossy, normalizeScan } from '@/server/domain/pharmacy/barcode';

describe('barcode handling', () => {
  it('0012345678905 keeps its zeros', () => {
    expect(normalizeScan('0012345678905')).toBe('0012345678905');
    expect(normalizeScan('  0012345678905  ')).toBe('0012345678905');
  });

  it('a scan ending in a carriage return is trimmed', () => {
    expect(normalizeScan('6281001234567\r')).toBe('6281001234567');
    expect(normalizeScan('6281001234567\r\n')).toBe('6281001234567');
    expect(normalizeScan('6281001234567\n')).toBe('6281001234567');
    expect(normalizeScan('6281001234567\t')).toBe('6281001234567');
  });

  it('Arabic-Indic digits are converted', () => {
    expect(normalizeScan('٠٠١٢٣٤٥٦٧٨٩٠٥')).toBe('0012345678905');
    expect(normalizeScan('۰۰۱۲')).toBe('0012');
  });

  it('a valid EAN-13 is valid and a one-digit-off one is invalid', () => {
    expect(checkDigitStatus('4006381333931')).toBe('valid');
    expect(checkDigitStatus('4006381333932')).toBe('invalid');
    expect(checkDigitStatus('0012345678905')).toBe('valid');
  });

  it('EAN-8 and UPC-A are checked by length', () => {
    expect(checkDigitStatus('96385074')).toBe('valid');
    expect(checkDigitStatus('96385075')).toBe('invalid');
    expect(checkDigitStatus('036000291452')).toBe('valid');
    expect(checkDigitStatus('036000291453')).toBe('invalid');
  });

  it('a 6-digit internal code is not-applicable and accepted', () => {
    expect(checkDigitStatus('123456')).toBe('not-applicable');
    expect(normalizeScan('123456')).toBe('123456');
  });

  it('1.23457E+12 is lossy', () => {
    expect(looksNumericLossy('1.23457E+12')).toBe(true);
    expect(looksNumericLossy('1.2E+11')).toBe(true);
    expect(looksNumericLossy('1.2e11')).toBe(true);
    expect(looksNumericLossy('6281001234567')).toBe(false);
    expect(looksNumericLossy('ABC123')).toBe(false);
  });

  it('a plain 7 to 11 digit integer is lossy only when it came from a numeric cell', () => {
    expect(looksNumericLossy('12345678905')).toBe(false);
    expect(looksNumericLossy('12345678905', true)).toBe(true);
    expect(looksNumericLossy('1234567', true)).toBe(true);
    expect(looksNumericLossy('123456', true)).toBe(false);
    expect(looksNumericLossy('6281001234567', true)).toBe(false);
  });

  it('a code with letters is kept as text', () => {
    expect(normalizeScan('AB-0012x')).toBe('AB-0012x');
    expect(checkDigitStatus('AB-0012x')).toBe('not-applicable');
    expect(checkDigitStatus('ABCDEFGH')).toBe('not-applicable');
  });

  it('empty and whitespace-only input normalise to an empty string and are refused by callers', () => {
    expect(normalizeScan('')).toBe('');
    expect(normalizeScan('  \r\n')).toBe('');
    expect(checkDigitStatus('')).toBe('not-applicable');
  });
});
