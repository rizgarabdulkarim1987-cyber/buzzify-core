import { describe, expect, it } from 'vitest';
import { defaultPriceStep, formatPriceInput, minorUnitDigits, parsePriceInput, rescaleMinor, roundToStep } from '@/lib/money-input';
import { minorUnitDigits as fromDomain } from '@/server/domain/money';

describe('parsePriceInput', () => {
  it.each([
    ['4.50', 'USD', 450],
    ['4,50', 'USD', 450],
    ['4.5', 'USD', 450],
    ['4', 'USD', 400],
    ['0.05', 'USD', 5],
    ['.5', 'USD', 50],
    ['1,234.5', 'USD', 123450],
    ['1.234,5', 'USD', 123450],
    ['1,234,567', 'USD', 123456700],
    ['4.500', 'USD', 450],
    ['6000', 'IQD', 6000],
    ['6,000', 'IQD', 6000],
    ['6 000', 'IQD', 6000],
    ['6 000', 'IQD', 6000],
    ['٦٠٠٠', 'IQD', 6000],
    ['۶,۰۰۰', 'IQD', 6000],
    ['٦٬٠٠٠', 'IQD', 6000],
    ['٤٫٥', 'USD', 450],
    ['  4.50  ', 'USD', 450],
  ])('reads %j %s as %i', (text, currency, minor) => expect(parsePriceInput(text, currency)).toEqual({ ok: true, minor }));

  it.each([
    ['', 'EMPTY'],
    ['   ', 'EMPTY'],
    ['abc', 'NOT_A_NUMBER'],
    ['4.5.0x', 'NOT_A_NUMBER'],
    ['1,23,4', 'NOT_A_NUMBER'],
    ['4 50', 'NOT_A_NUMBER'],
    [',', 'NOT_A_NUMBER'],
    ['+4', 'NOT_A_NUMBER'],
    ['-1', 'NEGATIVE'],
    ['4.555', 'TOO_PRECISE'],
    ['99999999999', 'TOO_LARGE'],
  ])('refuses %j', (text, reason) => expect(parsePriceInput(text, 'USD')).toEqual({ ok: false, reason }));

  it('refuses decimals a currency without minor units cannot hold', () => {
    expect(parsePriceInput('6000.5', 'IQD')).toEqual({ ok: false, reason: 'TOO_PRECISE' });
    expect(parsePriceInput('6000.00', 'IQD')).toEqual({ ok: true, minor: 6000 });
  });
});

describe('formatPriceInput', () => {
  it('writes the major unit with a point and no grouping', () => {
    expect(formatPriceInput(450, 'USD')).toBe('4.50');
    expect(formatPriceInput(5, 'USD')).toBe('0.05');
    expect(formatPriceInput(123456700, 'USD')).toBe('1234567.00');
    expect(formatPriceInput(6000, 'IQD')).toBe('6000');
    expect(formatPriceInput(-150, 'USD')).toBe('-1.50');
  });

  it('reads back what it writes', () => {
    for (const minor of [0, 5, 450, 99999]) expect(parsePriceInput(formatPriceInput(minor, 'USD'), 'USD')).toEqual({ ok: true, minor });
  });
});

describe('minor units', () => {
  it('knows the digits of each currency, from one module for the server and the browser', () => {
    expect(minorUnitDigits('USD')).toBe(2);
    expect(minorUnitDigits('IQD')).toBe(0);
    expect(fromDomain).toBe(minorUnitDigits);
  });

  it('rescales stored amounts so the major-unit number stays', () => {
    expect(rescaleMinor(450, 2, 0)).toBe(5);
    expect(rescaleMinor(449, 2, 0)).toBe(4);
    expect(rescaleMinor(150, 2, 0)).toBe(2);
    expect(rescaleMinor(-150, 2, 0)).toBe(-2);
    expect(rescaleMinor(6000, 0, 2)).toBe(600000);
    expect(rescaleMinor(1234, 3, 2)).toBe(123);
    expect(rescaleMinor(450, 2, 2)).toBe(450);
  });
});

describe('rounding to the menu step', () => {
  it('has the defaults of spec 13.4', () => {
    expect(defaultPriceStep('USD')).toBe(5);
    expect(defaultPriceStep('IQD')).toBe(250);
    expect(defaultPriceStep('EUR')).toBe(1);
  });

  it('rounds half up to a multiple of the step, never below one step', () => {
    expect(roundToStep(489, 5)).toBe(490);
    expect(roundToStep(487, 5)).toBe(485);
    expect(roundToStep(6600, 250)).toBe(6500);
    expect(roundToStep(6125, 250)).toBe(6250);
    expect(roundToStep(1, 250)).toBe(250);
    expect(roundToStep(0, 5)).toBe(5);
    expect(roundToStep(733, 1)).toBe(733);
  });
});
