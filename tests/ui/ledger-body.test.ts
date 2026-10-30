import { describe, expect, it } from 'vitest';
import { cheapestFirst, DIAL_BAND, LEDGER_MOTIFS, sheetColumn, stationFrequency, tapeSide } from '@/ui/template/bodies/ledger';

describe('the ledger family', () => {
  it('has the five styles of batch 11', () => {
    expect(LEDGER_MOTIFS).toEqual(['sheet', 'serp', 'typew', 'cassette', 'radio']);
  });

  it('letters spreadsheet columns A to Z, then AA', () => {
    expect([0, 1, 2, 3].map(sheetColumn)).toEqual(['A', 'B', 'C', 'D']);
    expect(sheetColumn(25)).toBe('Z');
    expect(sheetColumn(26)).toBe('AA');
    expect(sheetColumn(27)).toBe('AB');
    expect(sheetColumn(-3)).toBe('A');
  });

  it('sorts a sheet section cheapest first, stable, without touching the list it is given', () => {
    const rows = [
      { id: 'a', price: 5 },
      { id: 'b', price: 2 },
      { id: 'c', price: 5 },
      { id: 'd', price: 1 },
    ];
    const before = rows.map((row) => row.id);
    expect(cheapestFirst(rows, (row) => row.price).map((row) => row.id)).toEqual(['d', 'b', 'a', 'c']);
    expect(rows.map((row) => row.id)).toEqual(before);
    expect(cheapestFirst([], () => 0)).toEqual([]);
  });

  it('puts the first half of a tape (rounded up) on side A, the rest on side B, each from track 1', () => {
    expect([0, 1, 2, 3, 4].map((at) => tapeSide(at, 5))).toEqual([
      { side: 'A', track: 1 },
      { side: 'A', track: 2 },
      { side: 'A', track: 3 },
      { side: 'B', track: 1 },
      { side: 'B', track: 2 },
    ]);
    expect(tapeSide(0, 1)).toEqual({ side: 'A', track: 1 });
    expect(tapeSide(1, 2)).toEqual({ side: 'B', track: 1 });
  });

  it('spreads the stations over the medium-wave band in steps of 10 kHz', () => {
    expect(stationFrequency(0, 1)).toBe(DIAL_BAND.low);
    expect(stationFrequency(0, 5)).toBe(DIAL_BAND.low);
    expect(stationFrequency(4, 5)).toBe(DIAL_BAND.high);
    const band = Array.from({ length: 7 }, (_, at) => stationFrequency(at, 7));
    expect(band.every((khz) => khz % 10 === 0)).toBe(true);
    expect([...band].sort((a, b) => a - b)).toEqual(band);
    expect(new Set(band).size).toBe(7);
    expect(stationFrequency(99, 5)).toBe(DIAL_BAND.high);
  });
});
