import { describe, expect, it } from 'vitest';
import { sellableLevels, splitQty, toBaseQty, validateLadder, type UnitLevel } from '@/server/domain/pharmacy/units';

const box: UnitLevel[] = [
  { level: 0, label: 'tablet', baseQty: 1, sellable: true },
  { level: 1, label: 'strip', baseQty: 10, sellable: true },
  { level: 2, label: 'box', baseQty: 100, sellable: false },
];

describe('unit ladders', () => {
  it('box of 10 strips of 10 tablets validates (1, 10, 100)', () => {
    expect(validateLadder(box)).toEqual({ ok: true });
  });

  it('a single base level validates', () => {
    expect(validateLadder([{ level: 0, label: 'bottle', baseQty: 1, sellable: true }])).toEqual({ ok: true });
  });

  it('a level that is not a multiple of the one below is refused (1, 10, 25)', () => {
    const ladder = [box[0]!, box[1]!, { ...box[2]!, baseQty: 25 }];
    expect(validateLadder(ladder)).toEqual({ ok: false, code: 'NOT_A_MULTIPLE' });
  });

  it('a fractional or non-positive baseQty is refused', () => {
    expect(validateLadder([box[0]!, { ...box[1]!, baseQty: 2.5 }])).toEqual({ ok: false, code: 'NOT_A_MULTIPLE' });
    expect(validateLadder([box[0]!, { ...box[1]!, baseQty: 0 }])).toMatchObject({ ok: false });
  });

  it('no sellable level is refused', () => {
    const ladder = box.map((l) => ({ ...l, sellable: false }));
    expect(validateLadder(ladder)).toEqual({ ok: false, code: 'NONE_SELLABLE' });
  });

  it('an empty ladder, or one without level 0, has no base', () => {
    expect(validateLadder([])).toEqual({ ok: false, code: 'NO_BASE' });
    expect(validateLadder([{ level: 1, label: 'strip', baseQty: 10, sellable: true }])).toEqual({
      ok: false,
      code: 'NO_BASE',
    });
  });

  it('a base level whose baseQty is not 1 is refused', () => {
    expect(validateLadder([{ level: 0, label: 'tablet', baseQty: 2, sellable: true }])).toEqual({
      ok: false,
      code: 'BASE_NOT_ONE',
    });
  });

  it('levels out of order or not growing are refused', () => {
    expect(validateLadder([box[0]!, box[2]!, box[1]!])).toEqual({ ok: false, code: 'NOT_ASCENDING' });
    expect(validateLadder([box[0]!, { ...box[1]!, baseQty: 1 }])).toEqual({ ok: false, code: 'NOT_ASCENDING' });
  });

  it('duplicate level numbers are refused', () => {
    expect(validateLadder([box[0]!, box[1]!, { ...box[2]!, level: 1 }])).toEqual({
      ok: false,
      code: 'DUPLICATE_LEVEL',
    });
  });

  it('an empty label is refused', () => {
    expect(validateLadder([box[0]!, { ...box[1]!, label: '  ' }])).toEqual({ ok: false, code: 'EMPTY_LABEL' });
  });

  it('toBaseQty(box, 2) is 200', () => {
    expect(toBaseQty(box, 2, 2)).toBe(200);
    expect(toBaseQty(box, 0, 7)).toBe(7);
    expect(toBaseQty(box, 1, 0)).toBe(0);
  });

  it('toBaseQty refuses an unknown level or a bad quantity', () => {
    expect(() => toBaseQty(box, 5, 1)).toThrow(RangeError);
    expect(() => toBaseQty(box, 1, 1.5)).toThrow(RangeError);
    expect(() => toBaseQty(box, 1, -1)).toThrow(RangeError);
  });

  it('splitQty of 235 tablets with (1, 10, 100) is 2 boxes, 3 strips, 5 tablets', () => {
    expect(splitQty(box, 235)).toEqual([
      { level: 2, label: 'box', qty: 2 },
      { level: 1, label: 'strip', qty: 3 },
      { level: 0, label: 'tablet', qty: 5 },
    ]);
  });

  it('splitQty leaves out levels with nothing in them', () => {
    expect(splitQty(box, 200)).toEqual([{ level: 2, label: 'box', qty: 2 }]);
    expect(splitQty(box, 5)).toEqual([{ level: 0, label: 'tablet', qty: 5 }]);
  });

  it('splitQty of 0 is empty', () => {
    expect(splitQty(box, 0)).toEqual([]);
  });

  it('a quantity beyond Number.MAX_SAFE_INTEGER is refused', () => {
    expect(() => splitQty(box, Number.MAX_SAFE_INTEGER + 2)).toThrow(RangeError);
    expect(() => toBaseQty(box, 2, Number.MAX_SAFE_INTEGER)).toThrow(RangeError);
    expect(() => toBaseQty(box, 0, Number.MAX_SAFE_INTEGER + 2)).toThrow(RangeError);
  });

  it('sellableLevels keeps only the sellable ones, in order', () => {
    expect(sellableLevels(box).map((l) => l.level)).toEqual([0, 1]);
  });
});
