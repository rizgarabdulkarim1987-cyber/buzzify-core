import { describe, expect, it } from 'vitest';
import {
  appearanceVars,
  checkAppearance,
  contrast,
  DEFAULT_APPEARANCE,
  fullAppearanceVars,
  PRESETS,
  FONT_KEYS,
  isDark,
  parseStoredAppearance,
} from '@/lib/appearance';

describe('contrast', () => {
  it('is 21 for black on white', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5);
  });
  it('is 1 for a colour on itself', () => {
    expect(contrast('#336699', '#336699')).toBeCloseTo(1, 5);
  });
});

describe('checkAppearance', () => {
  it('accepts the default', () => {
    expect(checkAppearance(DEFAULT_APPEARANCE)).toEqual({ ok: true, value: DEFAULT_APPEARANCE });
  });
  it('refuses text equal to the background and names the field', () => {
    const r = checkAppearance({ ...DEFAULT_APPEARANCE, text: '#ffffff', bg: '#ffffff' });
    expect(r).toMatchObject({ ok: false, field: 'text' });
  });
  it('refuses button text under 4.5 on the button', () => {
    const r = checkAppearance({ ...DEFAULT_APPEARANCE, button: '#777777', buttonText: '#888888' });
    expect(r).toMatchObject({ ok: false, field: 'buttonText' });
  });
  it('refuses a button too close to the background to be seen (under 3)', () => {
    const r = checkAppearance({ ...DEFAULT_APPEARANCE, bg: '#ffffff', button: '#f5f5f5', buttonText: '#000000' });
    expect(r).toMatchObject({ ok: false, field: 'button' });
  });
  it('refuses a malformed colour, an unknown font and an unknown shape', () => {
    expect(checkAppearance({ ...DEFAULT_APPEARANCE, bg: 'red' })).toMatchObject({ ok: false, field: 'bg' });
    expect(checkAppearance({ ...DEFAULT_APPEARANCE, font: 'comic' })).toMatchObject({ ok: false, field: 'font' });
    expect(checkAppearance({ ...DEFAULT_APPEARANCE, shape: 'blob' })).toMatchObject({ ok: false, field: 'shape' });
  });
});

describe('parseStoredAppearance', () => {
  it('returns the default for garbage, null and non-objects', () => {
    expect(parseStoredAppearance(null)).toEqual(DEFAULT_APPEARANCE);
    expect(parseStoredAppearance('x')).toEqual(DEFAULT_APPEARANCE);
    expect(parseStoredAppearance([1, 2])).toEqual(DEFAULT_APPEARANCE);
  });
  it('drops an unknown font but keeps the valid fields', () => {
    const v = parseStoredAppearance({ font: 'gone', shape: 'round', bg: '#101010', text: '#f0f0f0', button: '#ffffff', buttonText: '#000000' });
    expect(v.font).toBe(DEFAULT_APPEARANCE.font);
    expect(v.shape).toBe('round');
    expect(v.bg).toBe('#101010');
  });
  it('falls back to the default when the stored colours are unreadable together', () => {
    expect(parseStoredAppearance({ ...DEFAULT_APPEARANCE, text: '#ffffff', bg: '#ffffff' })).toEqual(DEFAULT_APPEARANCE);
  });
});

describe('appearanceVars', () => {
  it('sets a full radius for round and a 6px one for square', () => {
    expect(appearanceVars({ ...DEFAULT_APPEARANCE, bg: '#fafafa', shape: 'round' })['--s-btn-radius']).toBe('9999px');
    expect(appearanceVars({ ...DEFAULT_APPEARANCE, bg: '#fafafa', shape: 'square' })['--s-btn-radius']).toBe('6px');
  });
  it('sets nothing for the default look', () => {
    expect(appearanceVars(DEFAULT_APPEARANCE)).toEqual({});
  });
  it('maps the chosen colours onto the Studio tokens', () => {
    const v = appearanceVars({ ...DEFAULT_APPEARANCE, bg: '#101010', text: '#f5f5f5', button: '#f2b705', buttonText: '#000000' });
    expect(v['--s-bg']).toBe('#101010');
    expect(v['--s-text']).toBe('#f5f5f5');
    expect(v['--s-ink']).toBe('#f2b705');
    expect(v['--s-on-ink']).toBe('#000000');
  });
  it('keeps muted text readable on the chosen background', () => {
    const v = appearanceVars({ ...DEFAULT_APPEARANCE, bg: '#101010', text: '#f5f5f5' });
    expect(contrast(v['--s-muted'], '#101010')).toBeGreaterThanOrEqual(4.5);
  });
  it('lists only known fonts', () => {
    expect(FONT_KEYS.length).toBeGreaterThanOrEqual(3);
  });
});

describe('isDark', () => {
  it('is true for #111111 and false for #ffffff', () => {
    expect(isDark('#111111')).toBe(true);
    expect(isDark('#ffffff')).toBe(false);
  });
});

describe('checkAppearance codes', () => {
  it('says whether a field is badly written, too close in contrast, or not on offer', () => {
    expect(checkAppearance({ ...DEFAULT_APPEARANCE, bg: 'red' })).toMatchObject({ code: 'format' });
    expect(checkAppearance({ ...DEFAULT_APPEARANCE, text: '#ffffff' })).toMatchObject({ field: 'text', code: 'contrast' });
    expect(checkAppearance({ ...DEFAULT_APPEARANCE, font: 'comic' })).toMatchObject({ code: 'choice' });
  });
});

describe('presets and the full variable set', () => {
  it('offers presets that all pass the readability check', () => {
    expect(PRESETS.length).toBeGreaterThanOrEqual(3);
    for (const preset of PRESETS) expect(checkAppearance(preset.appearance)).toEqual({ ok: true, value: preset.appearance });
  });
  it('gives the default look a full set of variables for the preview', () => {
    expect(fullAppearanceVars(DEFAULT_APPEARANCE)['--s-bg']).toBe('#ffffff');
    expect(fullAppearanceVars(DEFAULT_APPEARANCE)['--s-btn-radius']).toBe('6px');
  });
});

describe('status colours on every preset', () => {
  const BASE = { '--s-danger': '#b42318', '--s-success': '#067647', '--s-info': '#1d4ed8', '--s-on-status': '#ffffff' } as const;
  for (const preset of PRESETS) {
    it(`${preset.key}: danger, success and info stay readable on the background, and their fills keep readable text`, () => {
      const vars = { ...BASE, ...fullAppearanceVars(preset.appearance) } as Record<string, string>;
      for (const name of ['--s-danger', '--s-success', '--s-info'] as const) {
        expect(contrast(vars[name]!, preset.appearance.bg), `${name} on bg`).toBeGreaterThanOrEqual(4.5);
        expect(contrast(vars['--s-on-status']!, vars[name]!), `${name} fill`).toBeGreaterThanOrEqual(4.5);
      }
    });
  }
  it('leaves the status colours alone for the default look', () => {
    expect(fullAppearanceVars(DEFAULT_APPEARANCE)['--s-danger']).toBeUndefined();
  });
});
