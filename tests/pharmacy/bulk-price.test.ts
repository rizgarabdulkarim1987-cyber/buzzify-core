import { describe, expect, it } from 'vitest';
import { BulkPriceError, previewBulk, roundToStep } from '@/server/domain/pharmacy/bulk-price';

const row = (productId: string, current: bigint, unitId = `${productId}-u`, currency: 'IQD' | 'USD' = 'IQD') => ({ productId, unitId, currency, current });
const NEAREST_250 = { step: 250n, mode: 'nearest' as const };

describe('previewBulk', () => {
  it('10% up on 1,250 IQD with step 250 rounding nearest gives 1,500', () => {
    // 1,250 + 10% = 1,375, exactly half way between 1,250 and 1,500: half way rounds up.
    const preview = previewBulk({ rows: [row('p1', 1250n)], change: { kind: 'percent', basisPoints: 1000 }, rounding: NEAREST_250 });
    expect(preview.rows).toEqual([{ productId: 'p1', unitId: 'p1-u', currency: 'IQD', before: 1250n, after: 1500n }]);
    expect(preview.previewHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rounding up and down differ as expected at the boundary', () => {
    const at = (current: bigint, mode: 'nearest' | 'up' | 'down') =>
      previewBulk({ rows: [row('p', current)], change: { kind: 'fixed', amount: 0n }, rounding: { step: 250n, mode } }).rows[0]!.after;
    // On a step: every mode keeps it.
    for (const mode of ['nearest', 'up', 'down'] as const) expect(at(1500n, mode)).toBe(1500n);
    // One above a step: up goes to the next step, down and nearest stay.
    expect(at(1501n, 'up')).toBe(1750n);
    expect(at(1501n, 'down')).toBe(1500n);
    expect(at(1501n, 'nearest')).toBe(1500n);
    // One below the next step: up and nearest reach it, down falls back.
    expect(at(1749n, 'up')).toBe(1750n);
    expect(at(1749n, 'down')).toBe(1500n);
    expect(at(1749n, 'nearest')).toBe(1750n);
    // Half way: nearest rounds half up; just under half way it rounds down.
    expect(at(1625n, 'nearest')).toBe(1750n);
    expect(at(1624n, 'nearest')).toBe(1500n);
  });

  it('a percent change rounds the exact value, not a truncated one', () => {
    // 3 * 1.5% = 0.045, below half a step of 1: nearest gives 0, up gives 1. A float would also be exact here, but the
    // amounts below are beyond what a double holds exactly.
    const big = 9_007_199_254_740_993n; // 2^53 + 1
    const preview = previewBulk({ rows: [row('p', big)], change: { kind: 'percent', basisPoints: 10_000 }, rounding: { step: 1n, mode: 'nearest' } });
    expect(preview.rows[0]!.after).toBe(big * 2n);
    const tiny = (mode: 'nearest' | 'up' | 'down') =>
      previewBulk({ rows: [row('p', 3n)], change: { kind: 'percent', basisPoints: 150 }, rounding: { step: 1n, mode } }).rows[0]!.after;
    expect([tiny('nearest'), tiny('up'), tiny('down')]).toEqual([3n, 4n, 3n]);
    // A cut: 1,000 less 12.5% is 875 exactly.
    const cut = previewBulk({ rows: [row('p', 1000n)], change: { kind: 'percent', basisPoints: -1250 }, rounding: { step: 1n, mode: 'down' } });
    expect(cut.rows[0]!.after).toBe(875n);
  });

  it('a change that takes a price below zero is refused naming the row', () => {
    const run = () =>
      previewBulk({ rows: [row('a', 5000n), row('b', 200n)], change: { kind: 'fixed', amount: -250n }, rounding: NEAREST_250 });
    expect(run).toThrow(BulkPriceError);
    try {
      run();
    } catch (error) {
      expect(error).toMatchObject({ code: 'NEGATIVE_PRICE', productId: 'b', unitId: 'b-u' });
    }
    // More than 100% off is below zero too.
    expect(() => previewBulk({ rows: [row('a', 5000n)], change: { kind: 'percent', basisPoints: -10_001 }, rounding: NEAREST_250 })).toThrow(BulkPriceError);
    // Exactly 100% off is zero, which is allowed.
    expect(previewBulk({ rows: [row('a', 5000n)], change: { kind: 'percent', basisPoints: -10_000 }, rounding: NEAREST_250 }).rows[0]!.after).toBe(0n);
  });

  it('refuses a step below 1 and a fractional percent', () => {
    expect(() => previewBulk({ rows: [row('a', 1n)], change: { kind: 'fixed', amount: 1n }, rounding: { step: 0n, mode: 'up' } })).toThrow(RangeError);
    expect(() => previewBulk({ rows: [row('a', 1n)], change: { kind: 'percent', basisPoints: 1.5 }, rounding: NEAREST_250 })).toThrow(RangeError);
    expect(() => roundToStep(10n, 3n, -1n, 'up')).toThrow(RangeError);
  });

  it('the hash is the same for the same preview in any row order and changes with any part of it', () => {
    const base = { rows: [row('a', 1000n), row('b', 2000n)], change: { kind: 'percent' as const, basisPoints: 500 }, rounding: NEAREST_250 };
    const hash = previewBulk(base).previewHash;
    expect(previewBulk({ ...base, rows: [...base.rows].reverse() }).previewHash).toBe(hash);
    expect(previewBulk(base).rows.map((r) => r.productId)).toEqual(['a', 'b']);

    const variants = [
      { ...base, rows: [row('a', 1001n), row('b', 2000n)] },
      { ...base, rows: [row('a', 1000n, 'a-u', 'USD'), row('b', 2000n)] },
      { ...base, change: { kind: 'percent' as const, basisPoints: 501 } },
      { ...base, change: { kind: 'fixed' as const, amount: 500n } },
      { ...base, rounding: { step: 250n, mode: 'up' as const } },
      { ...base, rounding: { step: 50n, mode: 'nearest' as const } },
      { ...base, validFrom: new Date('2026-11-01T00:00:00Z') },
    ];
    const hashes = new Set(variants.map((v) => previewBulk(v).previewHash));
    expect(hashes.size).toBe(variants.length);
    expect(hashes.has(hash)).toBe(false);
    // The validFrom is part of it: the same instant gives the same hash.
    const dated = { ...base, validFrom: new Date('2026-11-01T00:00:00Z') };
    expect(previewBulk(dated).previewHash).toBe(previewBulk({ ...dated, validFrom: new Date('2026-11-01T00:00:00.000Z') }).previewHash);
  });
});
