import { describe, expect, it } from 'vitest';
import { MENU_STYLES } from '@/studio/styles/catalog';
import { CATEGORY_STYLES, STYLE_CATEGORIES, categoryOfStyle } from '@/studio/styles/categories';
import { STUDIO_MESSAGES } from '@/studio/messages';

describe('Menu style categories', () => {
  it('puts every style in exactly one category, with no orphan and no stranger', () => {
    const listed = STYLE_CATEGORIES.flatMap((category) => CATEGORY_STYLES[category]);
    expect(new Set(listed).size, 'a style is listed twice').toBe(listed.length);
    const known = new Set(MENU_STYLES.map((style) => style.id));
    expect(listed.filter((id) => !known.has(id)), 'ids the catalog does not have').toEqual([]);
    expect(MENU_STYLES.filter((style) => !listed.includes(style.id)).map((style) => style.id), 'orphans').toEqual([]);
    for (const style of MENU_STYLES) expect(style.category).toBe(categoryOfStyle(style.id));
  });

  it('has no empty category and counts the 123 styles', () => {
    for (const category of STYLE_CATEGORIES) expect(CATEGORY_STYLES[category].length, category).toBeGreaterThan(0);
    expect(STYLE_CATEGORIES.reduce((sum, category) => sum + CATEGORY_STYLES[category].length, 0)).toBe(123);
  });

  for (const locale of ['en', 'ar', 'ckb'] as const) {
    it(`${locale} names every category and the filter`, () => {
      const m = STUDIO_MESSAGES[locale];
      for (const category of STYLE_CATEGORIES) expect(m[`styles.category.${category}`], category).toBeTruthy();
      expect(m['design.filter.category']).toBeTruthy();
      expect(m['design.filter.categoryAll']).toBeTruthy();
    });
  }
});
