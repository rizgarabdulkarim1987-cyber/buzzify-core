import { describe, expect, it } from 'vitest';
import { DEFAULT_LAYOUT, fitTiles, isLate, LAYOUTS, layoutOf, needOf, openFirst, queueOf, SELECTING, type FloorTableState } from '@/lib/pos-floor';

const table = (number: number, status: FloorTableState['status'], pendingRequests = 0): FloorTableState => ({ number, status, pendingRequests });

describe('layouts', () => {
  it('has the ten arrangements, tiles first', () => {
    expect(LAYOUTS).toEqual(['tiles', 'strip', 'register', 'keypad', 'dock', 'groups', 'order', 'zones', 'night', 'slips']);
    expect(DEFAULT_LAYOUT).toBe('tiles');
  });

  it('reads a cookie value, falling back to tiles', () => {
    expect(layoutOf('slips')).toBe('slips');
    expect(layoutOf(undefined)).toBe('tiles');
    expect(layoutOf('circles')).toBe('tiles');
  });

  it('selects first only in the layouts with a bill area', () => {
    expect([...SELECTING].sort()).toEqual(['dock', 'night', 'register', 'tiles']);
  });
});

describe('fitTiles', () => {
  it('picks the column count that gives the biggest squares', () => {
    expect(fitTiles(12, 1000, 600)).toEqual({ cols: 4, side: 193, overflow: false });
  });

  it('caps the side so a small floor stays comfortable', () => {
    expect(fitTiles(2, 1600, 900).side).toBe(240);
  });

  it('scrolls in its box instead of going below a readable side', () => {
    const fit = fitTiles(200, 600, 300);
    expect(fit.overflow).toBe(true);
    expect(fit.side).toBeGreaterThanOrEqual(84);
  });
});

describe('waiting for you', () => {
  it('lists new QR orders, then bills, then ready food, by number within each', () => {
    const tables = [table(5, 'READY'), table(2, 'BILL_REQUESTED'), table(9, 'BUSY', 1), table(1, 'BUSY'), table(3, 'FREE'), table(4, 'BILL_REQUESTED')];
    expect(queueOf(tables).map((x) => [x.table.number, x.need])).toEqual([
      [9, 'PENDING_APPROVAL'],
      [2, 'BILL_REQUESTED'],
      [4, 'BILL_REQUESTED'],
      [5, 'READY'],
    ]);
  });

  it('counts a waiting QR request whatever the table state', () => {
    expect(needOf(table(1, 'FREE', 1))).toBe('PENDING_APPROVAL');
    expect(needOf(table(1, 'BUSY'))).toBeNull();
  });

  it('puts the tables that need the cashier first, then busy, then free', () => {
    const tables = [table(1, 'FREE'), table(2, 'BUSY'), table(3, 'READY'), table(4, 'FREE', 1)];
    expect(openFirst(tables).map((t) => t.number)).toEqual([4, 3, 2, 1]);
  });
});

describe('isLate', () => {
  it('is late from the ring minutes on, never without a time or a limit', () => {
    expect(isLate(90, 90)).toBe(true);
    expect(isLate(89, 90)).toBe(false);
    expect(isLate(null, 90)).toBe(false);
    expect(isLate(500, 0)).toBe(false);
  });
});
