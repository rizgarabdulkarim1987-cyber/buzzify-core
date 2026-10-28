import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { aquaBubbles, aquaSwim, noteSerial, noteTurn, sectorLetter, sigNoise, targetCode } from '@/ui/template/bodies/signature-25';

const css = (name: string) => readFileSync(join(process.cwd(), 'src/ui/template/bodies', name), 'utf8');

describe('the Fighter Radar (hud)', () => {
  it('letters the sectors A to Z, then AA, AB', () => {
    expect([0, 1, 25, 26, 27, 51, 52].map(sectorLetter)).toEqual(['A', 'B', 'Z', 'AA', 'AB', 'AZ', 'BA']);
  });

  it('codes each target by its sector letter and its place from 1', () => {
    expect(targetCode(0, 0)).toBe('A1');
    expect(targetCode(2, 4)).toBe('C5');
  });

  it('runs its sweep and scan only on a live sector, pauses them under a finger, and turns them off with less motion', () => {
    const sheet = css('hud.css');
    expect(sheet).toMatch(/\.hd-section\[data-live\] \.hd-scan > i \{\s*animation: hd-scan/);
    expect(sheet).toMatch(/\[data-hold\] \.hd-section\[data-live\] \.hd-scan > i/);
    expect(sheet).toMatch(/prefers-reduced-motion: reduce[\s\S]*animation: none/);
  });
});

describe('the Aquarium (aqua)', () => {
  it('gives each fish a steady, gentle swim: 3.6 to 5.6 s, a phase already running, at most 5px sideways', () => {
    for (let seed = 1; seed < 200; seed++) {
      const swim = aquaSwim(seed);
      expect(swim).toEqual(aquaSwim(seed));
      expect(swim.time).toBeGreaterThanOrEqual(3.6);
      expect(swim.time).toBeLessThanOrEqual(5.6);
      expect(swim.delay).toBeLessThanOrEqual(0);
      expect(Math.abs(swim.dx)).toBeLessThanOrEqual(5);
    }
  });

  it('spreads the bubbles across the section, small and slow', () => {
    const bubbles = aquaBubbles(7, 3);
    expect(bubbles).toHaveLength(7);
    for (const bubble of bubbles) {
      expect(bubble.x).toBeGreaterThanOrEqual(4);
      expect(bubble.x).toBeLessThanOrEqual(94);
      expect(bubble.size).toBeGreaterThanOrEqual(6);
      expect(bubble.size).toBeLessThanOrEqual(16);
      expect(bubble.time).toBeGreaterThanOrEqual(7);
    }
    expect(bubbles.map((bubble) => bubble.x)).toEqual([...bubbles.map((bubble) => bubble.x)].sort((a, b) => a - b));
  });

  it('moves only the photo: the name, price and tap area never swim, and the swim stops when a dish is pointed at', () => {
    const sheet = css('aqua.css');
    expect(sheet).toMatch(/\.aq-section\[data-live\] \.aq-orb \{\s*animation: aq-swim/);
    expect(sheet).not.toMatch(/\.aq-(name|meta|fish)[^{]*\{[^}]*animation:/);
    expect(sheet).toMatch(/\.aq-fish:is\(:hover, :focus-within\) \.aq-orb/);
  });

  it('keeps sigNoise in [0, 1)', () => {
    for (let seed = 0; seed < 100; seed++) {
      expect(sigNoise(seed)).toBeGreaterThanOrEqual(0);
      expect(sigNoise(seed)).toBeLessThan(1);
    }
  });
});

describe('the Bank of Taste (bank)', () => {
  it('gives each denomination its own turn of the accent, the first the accent itself, repeating after six', () => {
    expect(noteTurn(0)).toBe(0);
    expect(new Set([0, 1, 2, 3, 4, 5].map(noteTurn)).size).toBe(6);
    expect(noteTurn(6)).toBe(noteTurn(0));
    expect(noteTurn(-1)).toBe(noteTurn(5));
  });

  it('prints a steady serial number: sector letter, two-digit place, six digits', () => {
    expect(noteSerial(0, 0)).toBe('A01 483920');
    expect(noteSerial(1, 2)).toMatch(/^B03 \d{6}$/);
    expect(noteSerial(30, 120)).toMatch(/^AE121 \d{6}$/);
  });
});
