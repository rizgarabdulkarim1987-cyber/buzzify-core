import { describe, expect, it } from 'vitest';
import { parseSellAdd, SELL_ADD_MAX_ITEMS } from '@/app/pharmacy/_ui/sell-logic';
import { SELL_SEARCH_MAX } from '@/server/pharmacy/sell-search';

describe('parseSellAdd', () => {
  it('reads several items, with or without the leading ?', () => {
    const want = [
      { unitId: 'u1', qty: 2 },
      { unitId: 'u2', qty: 1 },
    ];
    expect(parseSellAdd('add=u1:2,u2:1')).toEqual(want);
    expect(parseSellAdd('?add=u1:2,u2:1')).toEqual(want);
  });

  it('drops invalid entries and keeps the valid ones', () => {
    expect(parseSellAdd('add=:2')).toEqual([]);
    expect(parseSellAdd('add=u1:0')).toEqual([]);
    expect(parseSellAdd('add=u1:1000')).toEqual([]);
    expect(parseSellAdd('add=u1:x')).toEqual([]);
    expect(parseSellAdd('add=u1:1.5')).toEqual([]);
    expect(parseSellAdd('add=u1')).toEqual([]);
    expect(parseSellAdd('add=u1:2,:3,u2:0,u3:999')).toEqual([
      { unitId: 'u1', qty: 2 },
      { unitId: 'u3', qty: 999 },
    ]);
  });

  it('keeps at most as many items as the sale search reads in one call, dropping the rest without throwing', () => {
    expect(SELL_ADD_MAX_ITEMS).toBe(SELL_SEARCH_MAX);
    const many = Array.from({ length: 5000 }, (_, i) => `u${i}:1`).join(',');
    const read = parseSellAdd(`add=${many}`);
    expect(read).toHaveLength(SELL_ADD_MAX_ITEMS);
    expect(read[0]).toEqual({ unitId: 'u0', qty: 1 });
    expect(read.at(-1)).toEqual({ unitId: `u${SELL_ADD_MAX_ITEMS - 1}`, qty: 1 });
    // Invalid entries do not use up the allowance.
    const mixed = [':1', 'x:0', ...Array.from({ length: 40 }, (_, i) => `v${i}:2`)].join(',');
    expect(parseSellAdd(`add=${mixed}`)).toHaveLength(SELL_ADD_MAX_ITEMS);
  });

  it('is empty without an add param', () => {
    expect(parseSellAdd('')).toEqual([]);
    expect(parseSellAdd('?')).toEqual([]);
    expect(parseSellAdd('q=1')).toEqual([]);
  });
});
