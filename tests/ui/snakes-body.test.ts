import { describe, expect, it } from 'vitest';
import { boardCell, boardColumns, boardLinks, diceWalk, diePips, snakePath } from '@/ui/template/bodies/SnakesBody';

describe('the snakes body (Snakes and Ladders)', () => {
  it('numbers the board in a zigzag: every other row runs back', () => {
    expect([0, 1, 2, 3, 4, 5, 6].map((k) => boardCell(k, 3))).toEqual([
      { row: 0, col: 0 },
      { row: 0, col: 1 },
      { row: 0, col: 2 },
      { row: 1, col: 2 },
      { row: 1, col: 1 },
      { row: 1, col: 0 },
      { row: 2, col: 0 },
    ]);
  });

  it('fits three columns on a phone and six at most', () => {
    expect(boardColumns(351)).toBe(3);
    expect(boardColumns(200)).toBe(3);
    expect(boardColumns(500)).toBe(4);
    expect(boardColumns(2000)).toBe(6);
  });

  it('draws ladders forward and snakes back, a row or more long, never on the start, the end or a shared square', () => {
    for (const [total, cols] of [
      [22, 3],
      [40, 4],
      [80, 6],
      [13, 3],
    ] as const) {
      const links = boardLinks(total, cols);
      expect(links.length, `${total} squares`).toBeGreaterThan(0);
      const ends = links.flatMap((link) => [link.from, link.to]);
      expect(new Set(ends).size).toBe(ends.length);
      for (const link of links) {
        expect(link.from).toBeGreaterThan(0);
        expect(link.to).toBeGreaterThan(0);
        expect(link.from).toBeLessThan(total - 1);
        expect(link.to).toBeLessThan(total - 1);
        if (link.kind === 'ladder') expect(link.to).toBeGreaterThan(link.from);
        else expect(link.to).toBeLessThan(link.from);
        expect(Math.abs(boardCell(link.to, cols).row - boardCell(link.from, cols).row)).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it('has no ladders or snakes on a board too small for them', () => {
    expect(boardLinks(6, 3)).toEqual([]);
  });

  it('walks a roll square by square, stops on the end square, and follows a ladder or a snake', () => {
    expect(diceWalk(0, 3, 20, [])).toEqual({ path: [1, 2, 3], rest: 3 });
    expect(diceWalk(17, 6, 20, [])).toEqual({ path: [18, 19], rest: 19 });
    expect(diceWalk(0, 2, 20, [{ kind: 'ladder', from: 2, to: 9 }])).toEqual({ path: [1, 2], rest: 9 });
    expect(diceWalk(10, 2, 20, [{ kind: 'snake', from: 12, to: 4 }])).toEqual({ path: [11, 12], rest: 4 });
  });

  it('shows the pips of each face of the die', () => {
    expect([1, 2, 3, 4, 5, 6].map((face) => diePips(face).length)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(diePips(1)).toEqual([4]);
  });

  it('draws a snake from its head to its tail', () => {
    const d = snakePath({ x: 0.5, y: 2.5 }, { x: 2.5, y: 0.5 });
    expect(d.startsWith('M0.50 2.50')).toBe(true);
    expect(d.endsWith('2.50 0.50')).toBe(true);
  });
});
