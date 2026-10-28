import { describe, expect, it } from 'vitest';
import { floorNumber, roofDrop } from '@/ui/template/bodies/CityBody';

describe('the towers body (The Food City)', () => {
  it('stands the tower with the most dishes tallest, the others a step lower per dish, never below the cap', () => {
    expect(roofDrop(8, 8)).toBe(0);
    expect(roofDrop(6, 8)).toBe(1.5);
    expect(roofDrop(1, 40)).toBe(6);
    expect(roofDrop(9, 8)).toBe(0);
  });

  it('counts the floors from the street: the top floor is the highest number, the last floor 1', () => {
    expect([0, 1, 2].map((at) => floorNumber(at, 3))).toEqual([3, 2, 1]);
  });
});
