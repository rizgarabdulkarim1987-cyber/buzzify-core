import { describe, expect, it } from 'vitest';
import {
  RESTRICTED_VALID_DAYS,
  RX_VALID_DAYS,
  checkIssuedOn,
  checkPatientIdNote,
  controlledQtyCheck,
  duplicateWindowStart,
  isDuplicateUse,
  normalizeRxNumber,
  validityDays,
} from '@/server/domain/pharmacy/prescriptions';

const TODAY = '2026-10-27';

describe('validity windows', () => {
  it('is 30 days for a controlled drug, 180 for a prescription drug and none for an OTC one', () => {
    expect([RESTRICTED_VALID_DAYS, RX_VALID_DAYS]).toEqual([30, 180]);
    expect([validityDays('RESTRICTED'), validityDays('RX'), validityDays('OTC')]).toEqual([30, 180, null]);
  });

  it('accepts a prescription issued today and refuses one issued tomorrow', () => {
    expect(checkIssuedOn('2026-10-27', TODAY, 'RESTRICTED')).toEqual({ ok: true });
    expect(checkIssuedOn('2026-10-28', TODAY, 'RESTRICTED')).toEqual({ ok: false, reason: 'FUTURE' });
  });

  it('counts the 30 days of a controlled drug: 2026-09-27 is day 30, 2026-09-26 is day 31', () => {
    expect(checkIssuedOn('2026-09-27', TODAY, 'RESTRICTED')).toEqual({ ok: true });
    expect(checkIssuedOn('2026-09-26', TODAY, 'RESTRICTED')).toEqual({ ok: false, reason: 'EXPIRED' });
  });

  it('counts the 180 days of a prescription drug: 2026-04-30 is day 180, 2026-04-29 is day 181', () => {
    expect(checkIssuedOn('2026-04-30', TODAY, 'RX')).toEqual({ ok: true });
    expect(checkIssuedOn('2026-04-29', TODAY, 'RX')).toEqual({ ok: false, reason: 'EXPIRED' });
    // The same date is too old for a controlled drug.
    expect(checkIssuedOn('2026-04-30', TODAY, 'RESTRICTED')).toEqual({ ok: false, reason: 'EXPIRED' });
  });

  it('refuses a date that is not a real calendar day', () => {
    for (const bad of ['2026-02-30', '2026-13-01', 'yesterday', '2026-1-5', '']) {
      expect(checkIssuedOn(bad, TODAY, 'RX'), bad).toEqual({ ok: false, reason: 'MALFORMED' });
    }
  });
});

describe('the controlled quantity limit', () => {
  it('allows a total up to the limit and refuses one above it, per product', () => {
    expect(controlledQtyCheck(30, [{ productId: 'p1', baseQty: 20 }, { productId: 'p1', baseQty: 10 }])).toEqual({ ok: true });
    expect(controlledQtyCheck(30, [{ productId: 'p1', baseQty: 20 }, { productId: 'p1', baseQty: 11 }])).toEqual({ ok: false, productId: 'p1', max: 30, total: 31 });
  });

  it('judges each product on its own', () => {
    expect(controlledQtyCheck(30, [{ productId: 'p1', baseQty: 30 }, { productId: 'p2', baseQty: 30 }])).toEqual({ ok: true });
  });

  it('treats 0 as no limit', () => {
    expect(controlledQtyCheck(0, [{ productId: 'p1', baseQty: 1_000_000 }])).toEqual({ ok: true });
  });
});

describe('the patient identity note', () => {
  it('keeps a document type and at most the last 4 characters', () => {
    expect(checkPatientIdNote('National ID: 4821')).toEqual({ ok: true, value: 'National ID: 4821' });
    expect(checkPatientIdNote('  Passport - AB12 ')).toEqual({ ok: true, value: 'Passport - AB12' });
    expect(checkPatientIdNote('Residence card')).toEqual({ ok: true, value: 'Residence card' });
  });

  it('refuses more than 4 characters of the number, and a bare number', () => {
    expect(checkPatientIdNote('National ID: 12345')).toEqual({ ok: false, reason: 'TOO_LONG' });
    expect(checkPatientIdNote('National ID: 123456789012')).toEqual({ ok: false, reason: 'TOO_LONG' });
    expect(checkPatientIdNote('123456789012')).toEqual({ ok: false, reason: 'TOO_LONG' });
    expect(checkPatientIdNote('ID123456')).toEqual({ ok: false, reason: 'TOO_LONG' });
  });

  it('refuses text of any other shape', () => {
    expect(checkPatientIdNote(': 1234')).toEqual({ ok: false, reason: 'SHAPE' });
    expect(checkPatientIdNote('a'.repeat(60))).toEqual({ ok: false, reason: 'SHAPE' });
  });
});

describe('the reused prescription number', () => {
  it('normalizes spaces, and compares without case', () => {
    expect(normalizeRxNumber('  ab   12 ')).toBe('ab 12');
  });

  it('is a duplicate when the same number was dispensed for the same product within 30 days', () => {
    const earlier = [{ number: 'AB 12', productId: 'p1', issuedOn: '2026-10-20' }];
    expect(isDuplicateUse({ number: ' ab  12', productId: 'p1' }, earlier, TODAY)).toBe(true);
    expect(isDuplicateUse({ number: 'AB 12', productId: 'p2' }, earlier, TODAY)).toBe(false);
    expect(isDuplicateUse({ number: 'AB 13', productId: 'p1' }, earlier, TODAY)).toBe(false);
  });

  it('forgets an earlier use once its prescription is older than the window', () => {
    expect(duplicateWindowStart(TODAY)).toBe('2026-09-27');
    expect(isDuplicateUse({ number: 'AB 12', productId: 'p1' }, [{ number: 'AB 12', productId: 'p1', issuedOn: '2026-09-27' }], TODAY)).toBe(true);
    expect(isDuplicateUse({ number: 'AB 12', productId: 'p1' }, [{ number: 'AB 12', productId: 'p1', issuedOn: '2026-09-26' }], TODAY)).toBe(false);
  });
});
