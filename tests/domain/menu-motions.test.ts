import { describe, expect, it } from 'vitest';
import { motionById } from '@/motion/catalog';
import {
  cleanMotion,
  guestParams,
  isOffered,
  MOTION_PLACES,
  placeMotions,
  slotOf,
  startingParams,
  startingTexts,
  type SnapshotMotion,
} from '@/server/domain/menu-motions';

const meta = (id: string) => {
  const found = motionById(id);
  if (!found) throw new Error(`no motion ${id}`);
  return found;
};

describe('the places on a menu', () => {
  it('offers the 90 picture motions at every place and none of the demonstrations', () => {
    for (const place of MOTION_PLACES) {
      const offered = placeMotions(place);
      expect(offered).toHaveLength(90);
      expect(new Set(offered.map((motion) => motion.category))).toEqual(new Set(['three-d', 'luxury', 'food', 'background', 'type', 'effects']));
    }
    expect(isOffered('hero', 'golden-particles')).toBe(true);
    expect(isOffered('hero', 'add-to-cart')).toBe(false);
    expect(isOffered('category', 'scroll-zoom')).toBe(false);
    expect(isOffered('signature', 'liquid-wipe-transition')).toBe(false);
    expect(isOffered('hero', 'hover-scale')).toBe(false);
    expect(isOffered('hero', 'no-such-motion')).toBe(false);
  });

  it('names each place’s slot, and a category place needs its category', () => {
    expect(slotOf('hero')).toBe('hero');
    expect(slotOf('signature', null)).toBe('signature');
    expect(slotOf('category', 'c1')).toBe('category:c1');
    expect(() => slotOf('category')).toThrow();
    expect(() => slotOf('hero', 'c1')).toThrow();
  });
});

describe('cleaning a placement', () => {
  const ctx = { locales: ['en', 'ar'] as const, categoryIds: new Set(['c1']) };

  it('resolves its params and drops keys the motion does not have', () => {
    const clean = cleanMotion({ place: 'hero', motionId: 'golden-particles', params: { count: 999, color: '#ABCDEF', made: 1 }, texts: {} }, ctx);
    expect(clean).toEqual({ place: 'hero', motionId: 'golden-particles', params: { color: '#abcdef', background: '#0d0b09', count: 400 }, texts: {} });
  });

  it('keeps text out of params, and texts only for the motion’s text params and the menu’s languages, trimmed to length', () => {
    const maxLength = (meta('text-reveal').params.text as { maxLength: number }).maxLength;
    const clean = cleanMotion(
      { place: 'hero', motionId: 'text-reveal', params: { text: 'ignored' }, texts: { text: { en: ' Fresh ', ar: 'ب'.repeat(500), ckb: 'x' }, nope: { en: 'y' } } },
      ctx,
    );
    expect(clean?.params).not.toHaveProperty('text');
    expect(clean?.texts.text?.en).toBe('Fresh');
    expect(Array.from(clean?.texts.text?.ar ?? '')).toHaveLength(maxLength);
    expect(clean?.texts.text).not.toHaveProperty('ckb');
    expect(clean?.texts).not.toHaveProperty('nope');
  });

  it('drops empty texts, and a text param left with none', () => {
    const clean = cleanMotion({ place: 'hero', motionId: 'text-reveal', params: {}, texts: { text: { en: '  ', ar: 42 } } }, ctx);
    expect(clean?.texts).toEqual({});
  });

  it('keeps a category place’s category', () => {
    const clean = cleanMotion({ place: 'category', categoryId: 'c1', motionId: 'coffee-steam', params: {}, texts: {} }, ctx);
    expect(clean).toMatchObject({ place: 'category', categoryId: 'c1', motionId: 'coffee-steam' });
  });

  it('refuses what cannot be placed', () => {
    expect(cleanMotion({ place: 'hero', motionId: 'add-to-cart', params: {}, texts: {} }, ctx)).toBeNull();
    expect(cleanMotion({ place: 'category', categoryId: 'gone', motionId: 'coffee-steam', params: {}, texts: {} }, ctx)).toBeNull();
    expect(cleanMotion({ place: 'category', motionId: 'coffee-steam', params: {}, texts: {} }, ctx)).toBeNull();
    expect(cleanMotion({ place: 'hero', categoryId: 'c1', motionId: 'coffee-steam', params: {}, texts: {} }, ctx)).toBeNull();
    expect(cleanMotion({ place: 'roof', motionId: 'coffee-steam', params: {}, texts: {} }, ctx)).toBeNull();
    expect(cleanMotion({ place: 'hero', motionId: 42, params: {}, texts: {} }, ctx)).toBeNull();
    expect(cleanMotion('junk', ctx)).toBeNull();
    expect(cleanMotion(null, ctx)).toBeNull();
  });

  it('reads params and texts that are not objects as none', () => {
    expect(cleanMotion({ place: 'hero', motionId: 'golden-particles', params: 'x', texts: [1] }, ctx)).toEqual({
      place: 'hero',
      motionId: 'golden-particles',
      params: { color: '#d4a64a', background: '#0d0b09', count: 140 },
      texts: {},
    });
  });
});

describe('what guests get', () => {
  const motion: SnapshotMotion = { place: 'hero', motionId: 'text-reveal', params: { color: '#112233' }, texts: { text: { en: 'Fresh', ar: 'طازج' } } };

  it('reads the guest’s language, then the menu’s default, then the logo text', () => {
    expect(guestParams(motion, 'ar', 'en', 'Zhamitos').text).toBe('طازج');
    expect(guestParams(motion, 'ckb', 'en', 'Zhamitos').text).toBe('Fresh');
    expect(guestParams({ ...motion, texts: {} }, 'ckb', 'en', 'Zhamitos').text).toBe('Zhamitos');
  });

  it('resolves the rest of the params again', () => {
    const params = guestParams({ ...motion, params: { color: 'red', font: 'sans' } }, 'en', 'en', 'Zhamitos');
    expect(params).toMatchObject({ color: meta('text-reveal').params.color!.default, font: 'sans' });
  });
});

describe('a motion just picked', () => {
  it('starts on the page colour when it has a background', () => {
    expect(startingParams(meta('golden-particles'), '#101010').background).toBe('#101010');
    expect(startingParams(meta('liquid-gold'), '#101010')).not.toHaveProperty('background');
    expect(startingParams(meta('text-reveal'), '#101010')).not.toHaveProperty('text');
  });

  it('starts brand texts on the logo text in every language, and other texts empty', () => {
    expect(startingTexts(meta('premium-logo-reveal'), ['en', 'ar'], 'Zhamitos')).toEqual({ text: { en: 'Zhamitos', ar: 'Zhamitos' } });
    expect(startingTexts(meta('text-reveal'), ['en'], 'Zhamitos')).toEqual({});
  });
});
