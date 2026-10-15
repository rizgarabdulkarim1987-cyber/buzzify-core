import { describe, expect, it } from 'vitest';
import { DEFAULT_PALETTES, sanitizePalette } from '@/lib/brand';

describe('sanitizePalette', () => {
  const fallback = DEFAULT_PALETTES.dark;

  it('keeps valid hex colours', () => {
    const palette = { ...fallback, accent: '#112233' };
    expect(sanitizePalette(palette, fallback).accent).toBe('#112233');
  });

  it('replaces invalid colours with the fallback instead of passing them through', () => {
    const hostile = { ...fallback, bg: 'red;}body{display:none', accent: 'url(javascript:alert(1))', text: '#GGGGGG' };
    const result = sanitizePalette(hostile, fallback);
    expect(result.bg).toBe(fallback.bg);
    expect(result.accent).toBe(fallback.accent);
    expect(result.text).toBe(fallback.text);
  });

  it('returns the fallback for non-objects and missing keys', () => {
    expect(sanitizePalette(null, fallback)).toEqual(fallback);
    expect(sanitizePalette('nope', fallback)).toEqual(fallback);
    expect(sanitizePalette({ bg: '#000000' }, fallback).surface).toBe(fallback.surface);
  });
});
