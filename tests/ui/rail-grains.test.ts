import { describe, expect, it } from 'vitest';
import { RAIL_DISHES, dishCloud, flightPoint, grainSeeds, type Flight } from '@/ui/menu/rail/grains-math';

const flight = (): Flight => ({ x: 0, y: 0, z: 0, e: 0, s: 0 });

describe('dishCloud', () => {
  it('draws every dish, including the plate used when a category has no 3D model', () => {
    expect(RAIL_DISHES).toEqual(['burger', 'cup', 'glass', 'croissant', 'millefeuille', 'bagchicken', 'bagbeef', 'plate']);
  });

  it('gives exactly the asked number of grains, the same every time', () => {
    const a = dishCloud('cup', 500);
    const b = dishCloud('cup', 500);
    expect(a.count).toBe(500);
    expect(a.positions).toHaveLength(1500);
    expect(a.colors).toHaveLength(1500);
    expect(Array.from(a.positions)).toEqual(Array.from(b.positions));
  });

  it('keeps every dish within a unit footprint, standing on the rail', () => {
    for (const dish of RAIL_DISHES) {
      const { positions, colors } = dishCloud(dish, 400);
      for (let i = 0; i < positions.length; i += 3) {
        expect(Math.hypot(positions[i]!, positions[i + 2]!)).toBeLessThanOrEqual(1.25);
        expect(positions[i + 1]!).toBeGreaterThanOrEqual(0);
        expect(positions[i + 1]!).toBeLessThanOrEqual(1.45);
      }
      expect(Math.min(...colors)).toBeGreaterThanOrEqual(0);
      expect(Math.max(...colors)).toBeLessThanOrEqual(1);
    }
  });

  it('gives each dish its own shape', () => {
    const glass = dishCloud('glass', 300).positions;
    const croissant = dishCloud('croissant', 300).positions;
    const tallest = (positions: Float32Array) => Math.max(...positions.filter((_, i) => i % 3 === 1));
    expect(tallest(glass)).toBeGreaterThan(tallest(croissant) + 0.4);
  });
});

describe('flightPoint', () => {
  const seeds = grainSeeds(4);

  it('starts on the old dish and ends exactly on the new one', () => {
    const start = flightPoint(0.5, 0.2, -0.3, -0.4, 0.9, 0.1, seeds, 0, 0, flight());
    expect([start.x, start.y, start.z, start.e, start.s]).toEqual([0.5, 0.2, -0.3, 0, 0]);
    const end = flightPoint(0.5, 0.2, -0.3, -0.4, 0.9, 0.1, seeds, 0, 1, flight());
    expect([end.x, end.y, end.z, end.e, end.s]).toEqual([-0.4, 0.9, 0.1, 1, 0]);
  });

  it('lifts grains into the air between the two dishes', () => {
    const mid = flightPoint(0.6, 0, 0, -0.6, 0, 0, seeds, 0, 0.5, flight());
    expect(mid.s).toBeGreaterThan(0);
    expect(mid.y).toBeGreaterThan(0.05);
  });

  it('lets the top of the old dish go first', () => {
    const top = flightPoint(0.3, 1.2, 0, 0.3, 0.2, 0, seeds, 1, 0.2, flight());
    const base = flightPoint(0.3, 0, 0, 0.3, 0.2, 0, seeds, 1, 0.2, flight());
    expect(top.e).toBeGreaterThan(base.e);
  });
});

describe('grainSeeds', () => {
  it('gives four repeatable values between 0 and 1 per grain', () => {
    const seeds = grainSeeds(10);
    expect(seeds).toHaveLength(40);
    expect(Array.from(seeds)).toEqual(Array.from(grainSeeds(10)));
    expect(Math.min(...seeds)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...seeds)).toBeLessThan(1);
  });
});
