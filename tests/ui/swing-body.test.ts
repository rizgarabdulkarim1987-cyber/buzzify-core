import { describe, expect, it } from 'vitest';
import { chainDrop, hash01, pegTilt, rowsOf, stringLength, swayOf, STRING_LENGTHS, PEG_TILTS } from '@/ui/template/bodies/swing-sway';

describe('the hanging families (swing, rope)', () => {
  it('gives a key the same number from 0 to 1 every time, and different salts different numbers', () => {
    expect(hash01('dish-1', 1)).toBe(hash01('dish-1', 1));
    expect(hash01('dish-1', 1)).not.toBe(hash01('dish-1', 2));
    for (const key of ['a', 'kebab', 'شاورما', '']) {
      const value = hash01(key, 3);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });

  it('sways each dish gently at its own pace, starting mid-swing', () => {
    const sways = ['p1', 'p2', 'p3', 'p4', 'p5'].map(swayOf);
    for (const { period, delay, angle } of sways) {
      expect(period).toBeGreaterThanOrEqual(3.4);
      expect(period).toBeLessThanOrEqual(5);
      expect(delay).toBeLessThanOrEqual(0);
      expect(delay).toBeGreaterThanOrEqual(-period);
      expect(angle).toBeGreaterThanOrEqual(1.5);
      expect(angle).toBeLessThanOrEqual(3.5);
    }
    expect(new Set(sways.map((sway) => sway.period)).size).toBeGreaterThan(1);
    expect(swayOf('p1')).toEqual(swayOf('p1'));
  });

  it('hangs neighbours on strings of different lengths, repeating', () => {
    expect([0, 1, 2, 3].map(stringLength)).toEqual([...STRING_LENGTHS, STRING_LENGTHS[0]]);
    expect(stringLength(0)).not.toBe(stringLength(1));
    expect(stringLength(1)).not.toBe(stringLength(2));
    expect(stringLength(-1)).toBe(STRING_LENGTHS[2]);
  });

  it('tilts no two neighbouring pegboard cards the same way', () => {
    for (let at = 0; at < 12; at++) {
      expect(Math.sign(pegTilt(at))).not.toBe(Math.sign(pegTilt(at + 1)));
    }
    expect(pegTilt(6)).toBe(PEG_TILTS[0]);
  });

  it('droops a chain: the middle coin lowest, the two ends level and highest', () => {
    expect([0, 1, 2].map((column) => chainDrop(column, 3))).toEqual([0, 1, 0]);
    const five = [0, 1, 2, 3, 4].map((column) => chainDrop(column, 5));
    expect(five[0]).toBe(0);
    expect(five[4]).toBe(0);
    expect(five[2]).toBe(1);
    expect(five[1]).toBe(five[3]);
    expect(five[1]).toBeGreaterThan(0);
    expect(five[1]).toBeLessThan(1);
    // One or two coins hang level; a column outside the chain does not drop.
    expect(chainDrop(0, 1)).toBe(0);
    expect([chainDrop(0, 2), chainDrop(1, 2)]).toEqual([0, 0]);
    expect(chainDrop(3, 3)).toBe(0);
  });

  it('cuts a section into chains of three, the last one shorter', () => {
    expect(rowsOf([1, 2, 3, 4, 5, 6, 7], 3)).toEqual([[1, 2, 3], [4, 5, 6], [7]]);
    expect(rowsOf([], 3)).toEqual([]);
    expect(rowsOf([1, 2], 0)).toEqual([[1], [2]]);
  });
});
