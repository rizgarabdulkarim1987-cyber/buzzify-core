import { describe, expect, it } from 'vitest';
import { beeFlight, COMB_COLUMNS, combCell, combCellHeight, combTracks } from '@/ui/template/bodies/hex-comb';

describe('the hex body (Mountain Honey)', () => {
  it('interlocks the cells: neighbouring columns share one track, odd columns start half a cell lower', () => {
    expect(combTracks(2)).toBe(7);
    expect([0, 1, 2, 3].map((at) => combCell(at, 2))).toEqual([
      { column: 1, row: 1 },
      { column: 4, row: 2 },
      { column: 1, row: 3 },
      { column: 4, row: 4 },
    ]);
    expect([0, 1, 2, 3].map((at) => combCell(at, 3))).toEqual([
      { column: 1, row: 1 },
      { column: 4, row: 2 },
      { column: 7, row: 1 },
      { column: 1, row: 3 },
    ]);
  });

  it('never puts two cells on the same spot, and every cell stays inside the comb', () => {
    for (const cols of COMB_COLUMNS) {
      const taken = new Set<string>();
      for (let at = 0; at < 40; at += 1) {
        const { column, row } = combCell(at, cols);
        expect(column + 4 - 1).toBeLessThanOrEqual(combTracks(cols));
        // A cell covers rows row and row + 1 of its column.
        for (const line of [row, row + 1]) {
          const key = `${column}:${line}`;
          expect(taken.has(key), `${cols} columns, cell ${at}`).toBe(false);
          taken.add(key);
        }
      }
    }
  });

  it('gives the cells the height of a regular hexagon (the CSS row is half of it)', () => {
    expect(combCellHeight(2)).toBeCloseTo(49.49, 1);
    expect(combCellHeight(3)).toBeCloseTo(34.64, 1);
    expect(combCellHeight(4)).toBeCloseTo(26.65, 1);
  });

  it('flies each bee its own steady loop inside the frame', () => {
    expect(beeFlight(4)).toEqual(beeFlight(4));
    for (let seed = 0; seed < 30; seed += 1) {
      const bee = beeFlight(seed);
      expect(bee.x).toBeGreaterThanOrEqual(8);
      expect(bee.x).toBeLessThanOrEqual(88);
      expect(bee.time).toBeGreaterThanOrEqual(4);
      expect(bee.delay).toBeLessThanOrEqual(0);
    }
  });
});
