import { describe, expect, it } from 'vitest';
import { parseSellAdd } from '@/app/pharmacy/_ui/sell-logic';

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

  it('is empty without an add param', () => {
    expect(parseSellAdd('')).toEqual([]);
    expect(parseSellAdd('?')).toEqual([]);
    expect(parseSellAdd('q=1')).toEqual([]);
  });
});
