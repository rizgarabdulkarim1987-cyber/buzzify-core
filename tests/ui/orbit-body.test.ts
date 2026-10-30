import { describe, expect, it } from 'vitest';
import { ORBIT_CAP, ORBIT_LABEL, ORBIT_RADIUS, orbitChord, orbitPlace, orbitSize, orbitSplit } from '@/ui/template/bodies/orbit-rings';

describe('the orbit family (The Solar System, The Tannour, The Daf)', () => {
  it('puts at most a ring of dishes round the circle and the rest in the list under it, never losing one', () => {
    expect(orbitSplit(0)).toEqual({ ring: 0, rest: 0 });
    expect(orbitSplit(4)).toEqual({ ring: 4, rest: 0 });
    expect(orbitSplit(ORBIT_CAP)).toEqual({ ring: ORBIT_CAP, rest: 0 });
    expect(orbitSplit(11)).toEqual({ ring: ORBIT_CAP, rest: 11 - ORBIT_CAP });
    expect(ORBIT_CAP).toBeLessThanOrEqual(8);
    for (let count = 0; count < 30; count += 1) {
      const split = orbitSplit(count);
      expect(split.ring + split.rest).toBe(count);
    }
  });

  it('starts the ring at the top and goes round at equal steps', () => {
    expect(orbitPlace(0, 4)).toEqual({ x: 50, y: 50 - ORBIT_RADIUS });
    expect(orbitPlace(1, 4)).toEqual({ x: 50 + ORBIT_RADIUS, y: 50 });
    expect(orbitPlace(2, 4)).toEqual({ x: 50, y: 50 + ORBIT_RADIUS });
    expect(orbitPlace(3, 4)).toEqual({ x: 50 - ORBIT_RADIUS, y: 50 });
    expect(orbitPlace(0, 1)).toEqual({ x: 50, y: 50 - ORBIT_RADIUS });
    for (let at = 0; at < 6; at += 1) {
      const { x, y } = orbitPlace(at, 6);
      expect(Math.hypot(x - 50, y - 50)).toBeCloseTo(ORBIT_RADIUS, 0);
    }
  });

  it('sizes the photos so neighbours keep their photo and words clear at any turn of the ring', () => {
    for (let count = 2; count <= ORBIT_CAP; count += 1) {
      expect(orbitChord(count), `${count} dishes`).toBeGreaterThanOrEqual(orbitSize(count) + ORBIT_LABEL);
    }
    // The photos stay a size a guest can see the dish in.
    for (let count = 1; count <= ORBIT_CAP; count += 1) expect(orbitSize(count)).toBeGreaterThanOrEqual(20);
  });

  it('keeps the ring within the circle but for a sliver of the outermost photo', () => {
    for (let count = 1; count <= ORBIT_CAP; count += 1) expect(ORBIT_RADIUS + orbitSize(count) / 2).toBeLessThanOrEqual(52);
  });
});
