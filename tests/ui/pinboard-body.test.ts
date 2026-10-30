import { describe, expect, it } from 'vitest';
import { clothSway, pinNoise, pinTilt, PINBOARD_MOTIFS, tapeMarks, ticketSerial } from '@/ui/template/bodies/pinboard-layout';

describe('the pinboard family (album, afish, pass, xayat, ticket)', () => {
  it('has the five motifs of batch 20', () => {
    expect(PINBOARD_MOTIFS).toEqual(['album', 'afish', 'pass', 'xayat', 'ticket']);
  });

  it('leans every piece from a fixed pattern by its place, the same on every call', () => {
    for (const motif of PINBOARD_MOTIFS) {
      const first = Array.from({ length: 12 }, (_, at) => pinTilt(motif, at));
      const again = Array.from({ length: 12 }, (_, at) => pinTilt(motif, at));
      expect(again).toEqual(first);
      for (const tilt of first) expect(Math.abs(tilt)).toBeLessThanOrEqual(3);
    }
  });

  it('leans neighbours opposite ways at the start of a section', () => {
    for (const motif of PINBOARD_MOTIFS) expect(Math.sign(pinTilt(motif, 0))).not.toBe(Math.sign(pinTilt(motif, 1)));
  });

  it('repeats the pattern and wraps negative places', () => {
    expect(pinTilt('afish', 0)).toBe(-1.6);
    expect(pinTilt('afish', 1)).toBe(1.4);
    expect(pinTilt('afish', 2)).toBe(-1.6);
    expect(pinTilt('pass', 6)).toBe(pinTilt('pass', 0));
    expect(pinTilt('album', -1)).toBe(pinTilt('album', 5));
  });

  it('gives each cloth a steady flutter of its own', () => {
    expect(clothSway(3)).toEqual(clothSway(3));
    expect(clothSway(3)).not.toEqual(clothSway(4));
    for (let seed = 1; seed < 40; seed++) {
      const { time, delay } = clothSway(seed);
      expect(time).toBeGreaterThanOrEqual(3.6);
      expect(time).toBeLessThanOrEqual(5.6);
      expect(delay).toBeLessThanOrEqual(0);
      expect(delay).toBeGreaterThanOrEqual(-4);
      expect(pinNoise(seed)).toBeGreaterThanOrEqual(0);
      expect(pinNoise(seed)).toBeLessThan(1);
    }
  });

  it('numbers the tape measure every ten', () => {
    expect(tapeMarks(4)).toEqual([10, 20, 30, 40]);
    expect(tapeMarks(0)).toEqual([]);
    expect(tapeMarks(-2)).toEqual([]);
  });

  it('numbers a ticket by its section and its place in it', () => {
    expect(ticketSerial(0, 0)).toBe(101);
    expect(ticketSerial(0, 4)).toBe(105);
    expect(ticketSerial(2, 0)).toBe(301);
  });
});
