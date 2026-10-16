import { describe, expect, it } from 'vitest';
import { flapSequence } from '@/ui/menu/rail/flap';

const steady = (value: number) => () => value;

describe('flapSequence', () => {
  it('shows a few random letters before settling on the real one', () => {
    const glyphs = flapSequence('P', Math.random);
    expect(glyphs.at(-1)).toBe('P');
    expect(glyphs.length).toBeGreaterThanOrEqual(4);
    expect(glyphs.length).toBeLessThanOrEqual(8);
  });

  it('keeps to the letter case of the real letter', () => {
    expect(flapSequence('a', steady(0.5)).slice(0, -1).every((glyph) => /^[a-z]$/.test(glyph))).toBe(true);
    expect(flapSequence('A', steady(0.5)).slice(0, -1).every((glyph) => /^[A-Z]$/.test(glyph))).toBe(true);
  });

  it('does not spin spaces or punctuation', () => {
    expect(flapSequence(' ', Math.random)).toEqual([' ']);
    expect(flapSequence('&', Math.random)).toEqual(['&']);
  });

  it('spins accented letters through plain ones', () => {
    const glyphs = flapSequence('â', steady(0.2));
    expect(glyphs.at(-1)).toBe('â');
    expect(glyphs.slice(0, -1).every((glyph) => /^[a-z]$/.test(glyph))).toBe(true);
  });
});
