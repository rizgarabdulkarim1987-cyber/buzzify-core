import { describe, expect, it } from 'vitest';
import { normalizeSlugInput, RESERVED_SLUGS, suggestSlug, validateSlug } from '@/server/domain/slug';

describe('normalizeSlugInput', () => {
  it.each([
    ['Café Mazo', 'cafe-mazo'],
    ['  Mazo  Lounge ', 'mazo-lounge'],
    ['mazo__cafe', 'mazo-cafe'],
    ['--a--b--', 'a-b'],
    ['مازو', ''],
    ['Mazo & Lounge!', 'mazo-lounge'],
    ['Crème Brûlée No.5', 'creme-brulee-no5'],
    ['ＭＡＺＯ', 'mazo'],
  ])('normalizes %s to %s', (raw, out) => expect(normalizeSlugInput(raw)).toBe(out));

  it('never produces a slug with characters outside lowercase letters, digits and single hyphens', () => {
    for (const raw of ['Ünïcödé  Çafé', '日本語', '😀 party', 'a\tb\nc', '../etc/passwd', 'x'.repeat(100)]) {
      expect(normalizeSlugInput(raw)).toMatch(/^([a-z0-9]+(-[a-z0-9]+)*)?$/);
    }
  });
});

describe('validateSlug', () => {
  it('rejects reserved words, short, long and bad slugs', () => {
    expect(validateSlug('studio', [])).toEqual({ ok: false, reason: 'RESERVED' });
    expect(validateSlug('ab', [])).toEqual({ ok: false, reason: 'TOO_SHORT' });
    expect(validateSlug('a'.repeat(49), [])).toEqual({ ok: false, reason: 'TOO_LONG' });
    expect(validateSlug('a--b', [])).toEqual({ ok: false, reason: 'BAD_CHARACTERS' });
    expect(validateSlug('-ab', [])).toEqual({ ok: false, reason: 'BAD_CHARACTERS' });
    expect(validateSlug('mazo', ['mazo'])).toEqual({ ok: false, reason: 'RESERVED' });
  });

  it('accepts ordinary slugs at the length limits', () => {
    expect(validateSlug('mazo', [])).toEqual({ ok: true });
    expect(validateSlug('abc', [])).toEqual({ ok: true });
    expect(validateSlug('a'.repeat(48), [])).toEqual({ ok: true });
    expect(validateSlug('menu-0007', [])).toEqual({ ok: true });
    expect(validateSlug('2024-cafe', [])).toEqual({ ok: true });
  });

  it('rejects uppercase, spaces, accents, Arabic script, trailing hyphens and path characters', () => {
    for (const slug of ['Mazo', 'mazo cafe', 'café-mazo', 'مازو-مازو', 'mazo-', 'maz/o', 'maz.o', 'maz_o']) {
      expect(validateSlug(slug, []), slug).toEqual({ ok: false, reason: 'BAD_CHARACTERS' });
    }
  });

  it('reserves the fifteen platform words', () => {
    expect([...RESERVED_SLUGS].sort()).toEqual(
      ['_next', 'admin', 'api', 'app', 'assets', 'auth', 'help', 'login', 'media', 'menu', 'pharmacy', 'pos', 'static', 'studio', 'www'].sort(),
    );
    for (const word of RESERVED_SLUGS) expect(validateSlug(word, []).ok, word).toBe(false);
  });

  it('reserves auth, because /api/auth/* belongs to the sign-in handler and would shadow a menu’s /api/auth/quote', () => {
    expect(validateSlug('auth', [])).toEqual({ ok: false, reason: 'RESERVED' });
  });
});

describe('suggestSlug', () => {
  it('suggests the fallback for names with no Latin letters', () =>
    expect(suggestSlug('مطعم مازو', 'menu-0007')).toBe('menu-0007'));

  it('suggests the fallback when the normalized name is shorter than three characters', () =>
    expect(suggestSlug('Ab', 'menu-0007')).toBe('menu-0007'));

  it('suggests the normalized name otherwise', () => expect(suggestSlug('Café Mazo', 'menu-0007')).toBe('cafe-mazo'));

  it('keeps a long name within the length limit and never ends on a hyphen', () => {
    const suggestion = suggestSlug(`${'a'.repeat(47)} bbbb`, 'menu-0007');
    expect(suggestion.length).toBeLessThanOrEqual(48);
    expect(suggestion.endsWith('-')).toBe(false);
    expect(validateSlug(suggestion, [])).toEqual({ ok: true });
  });
});
