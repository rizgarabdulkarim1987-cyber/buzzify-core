import { describe, expect, it } from 'vitest';
import { STAR_ANCHOR, starChart, starDown, starLetter, starRows } from '@/ui/template/bodies/stars-chart';

describe('the stars body (The Constellations)', () => {
  it('lays the stars out in rows of three and two, every dish placed once', () => {
    expect(starRows(0)).toEqual([]);
    expect(starRows(1)).toEqual([1]);
    expect(starRows(3)).toEqual([3]);
    expect(starRows(5)).toEqual([3, 2]);
    expect(starRows(9)).toEqual([3, 2, 3, 1]);
    for (let count = 0; count < 40; count += 1) {
      const sizes = starRows(count);
      expect(sizes.reduce((sum, size) => sum + size, 0)).toBe(count);
      expect(sizes.every((size) => size >= 1 && size <= 3)).toBe(true);
      expect(starChart(count).stars).toHaveLength(count);
    }
  });

  it('keeps the stars of a row apart, so each one can be read and tapped (a star is 30% wide)', () => {
    for (let count = 1; count < 20; count += 1) {
      const { stars } = starChart(count);
      for (const a of stars)
        for (const b of stars) if (a !== b && a.row === b.row) expect(Math.abs(a.x - b.x)).toBeGreaterThanOrEqual(30);
      for (const star of stars) {
        expect(star.x - 15).toBeGreaterThanOrEqual(0);
        expect(star.x + 15).toBeLessThanOrEqual(100);
      }
    }
  });

  it('runs the line back along every other row, so it snakes down the chart', () => {
    const { stars, rows } = starChart(6);
    expect(rows).toBe(3);
    expect(stars.map((star) => star.x)).toEqual([17, 50, 83, 70, 30, 50]);
    expect(stars.map((star) => star.row)).toEqual([0, 0, 0, 1, 1, 2]);
  });

  it('joins the lines at the photo centres, in percent of the chart', () => {
    expect(starDown({ x: 50, row: 0, dy: 0 }, 1)).toBeCloseTo(STAR_ANCHOR * 100, 5);
    expect(starDown({ x: 50, row: 1, dy: 0 }, 2)).toBeCloseTo(((1 + STAR_ANCHOR) / 2) * 100, 5);
  });

  it('names the stars α, β, γ… and numbers them past ω', () => {
    expect([0, 1, 2].map((at) => starLetter(at))).toEqual(['α', 'β', 'γ']);
    expect(starLetter(23)).toBe('ω');
    expect(starLetter(24)).toBe('α2');
    expect(starLetter(25, (value) => `#${value}`)).toBe('β#2');
  });
});
