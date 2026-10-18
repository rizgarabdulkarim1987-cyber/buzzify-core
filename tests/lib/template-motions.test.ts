import { describe, expect, it } from 'vitest';
import { TEMPLATES } from '@/lib/templates';
import { categoryKind, PRESET_HERO_MOTIONS, previewMotions, suggestedMotions } from '@/lib/templates/motions';
import { TEMPLATE_IDS } from '@/lib/templates/types';
import { isOffered } from '@/server/domain/menu-motions';

/** The motions each template suggests (spec: 2026-10-18-template-motions-design.md, section 3). */

const category = (id: string, slug: string, ...names: string[]) => ({ id, slug, names });
const input = (categories: ReturnType<typeof category>[] = []) => ({
  categories,
  palette: { bg: '#101010', accent: '#c8a050' },
  locales: ['en', 'ar'] as const,
  logoText: 'Zhamitos',
});

describe('what each template suggests', () => {
  it('gives every template a motion for the top of the menu that the place offers', () => {
    for (const id of TEMPLATE_IDS) {
      expect(isOffered('hero', PRESET_HERO_MOTIONS[id].motionId), id).toBe(true);
    }
  });

  it('reads what a category holds from its slug or its names in any of the three languages', () => {
    expect(categoryKind(category('a', 'espresso-bar'))).toBe('coffee');
    expect(categoryKind(category('a', 'c-1', 'قهوة'))).toBe('coffee');
    expect(categoryKind(category('a', 'c-2', 'Hot', 'قاوە'))).toBe('coffee');
    expect(categoryKind(category('a', 'gelato'))).toBe('icecream');
    expect(categoryKind(category('a', 'iced-coffee'))).toBe('coffee');
    expect(categoryKind(category('a', 'sweets', 'حلويات'))).toBe('dessert');
    expect(categoryKind(category('a', 'cold-drinks'))).toBe('drinks');
    expect(categoryKind(category('a', 'mixed-grill'))).toBe('grill');
    expect(categoryKind(category('a', 'starters', 'المقبلات'))).toBeNull();
  });

  it('starts the top motion on the template’s page colour, tinted with its accent', () => {
    const [hero] = suggestedMotions('obsidian-gold', input());
    expect(hero).toMatchObject({ place: 'hero', motionId: 'golden-particles', params: { background: '#101010', color: '#c8a050' } });
  });

  it('writes the brand’s name into a motion whose words stand for it', () => {
    const [hero] = suggestedMotions('paris-maison', input());
    expect(hero).toMatchObject({ motionId: 'premium-logo-reveal', texts: { text: { en: 'Zhamitos', ar: 'Zhamitos' } } });
  });

  it('suggests motions for at most three categories, the first that match in menu order', () => {
    const motions = suggestedMotions(
      'copper-roast',
      input([
        category('c1', 'starters'),
        category('c2', 'coffee'),
        category('c3', 'desserts'),
        category('c4', 'ice-cream'),
        category('c5', 'juices'),
      ]),
    );
    expect(motions.map((motion) => [motion.place, motion.categoryId ?? null, motion.motionId])).toEqual([
      ['hero', null, 'coffee-beans-falling'],
      ['category', 'c2', 'coffee-steam'],
      ['category', 'c3', 'chocolate-dripping'],
      ['category', 'c4', 'ice-cream-swirl'],
    ]);
    expect(motions.find((motion) => motion.categoryId === 'c2')?.params.background).toBe('#101010');
  });

  it('previews a template not yet applied with the designer’s own motions and its suggestions in the empty places', () => {
    const owned = [{ place: 'hero' as const, motionId: 'aurora-background', params: {}, texts: {} }];
    const swap = { templateId: 'obsidian-gold', owned, categories: [category('c1', 'coffee'), category('c2', 'desserts')], locales: ['en'] as const, logoText: 'Z', allowed: true, playing: true };
    const palette = { bg: '#101010', accent: '#c8a050' };
    expect(previewMotions(swap, 'copper-roast', palette).map((motion) => [motion.place, motion.categoryId ?? null, motion.motionId])).toEqual([
      ['hero', null, 'aurora-background'],
      ['category', 'c1', 'coffee-steam'],
      ['category', 'c2', 'chocolate-dripping'],
    ]);
    expect(previewMotions(swap, null, palette).map((motion) => motion.motionId)).toEqual(['aurora-background']);
    expect(previewMotions({ ...swap, allowed: false }, 'copper-roast', palette)).toEqual([]);
  });

  it('draws every suggestion with the template’s own palette by default', () => {
    for (const id of TEMPLATE_IDS) {
      const { bg, accent } = TEMPLATES[id].palette;
      const [hero] = suggestedMotions(id, { ...input(), palette: { bg, accent } });
      expect(String(hero?.params.background ?? bg).toLowerCase(), id).toBe(bg.toLowerCase());
    }
  });
});
