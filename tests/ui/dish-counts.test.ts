import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getTranslator } from '@/lib/messages';
import { formatCount } from '@/server/domain/money';
import { dishCountsText } from '@/ui/menu/dish-counts-text';

const text = (locale: 'en' | 'ar' | 'ckb', orders: number, views: number, numerals: 'latn' | 'arab' = 'latn') =>
  dishCountsText({ orders, views }, getTranslator(locale), (value) => formatCount(value, locale, numerals));

describe('the dish counts line', () => {
  it('reads in English with the right plurals', () => {
    expect(text('en', 1, 1)).toBe('1 order · 1 view');
    expect(text('en', 340, 1200)).toBe('340 orders · 1,200 views');
  });

  it('keeps big numbers whole and grouped', () => {
    expect(text('en', 1_200_000, 98_765_432)).toBe('1,200,000 orders · 98,765,432 views');
  });

  it('uses the Arabic plural forms', () => {
    expect(text('ar', 1, 1)).toBe('طلب واحد · مشاهدة واحدة');
    expect(text('ar', 2, 2)).toBe('طلبان · مشاهدتان');
    expect(text('ar', 5, 7)).toContain('طلبات');
    expect(text('ar', 25, 40)).toContain('طلبًا');
    expect(text('ar', 100, 300)).toContain('طلب');
  });

  it('writes Kurdish and the menu’s own digits', () => {
    expect(text('ckb', 340, 12)).toContain('داواکاری');
    expect(text('ckb', 340, 12)).toContain('بینین');
    expect(text('ar', 340, 1200, 'arab')).toMatch(/٣٤٠/);
  });

  it('leaves out views that are 0 instead of writing "0 views"', () => {
    expect(text('en', 3, 0)).toBe('3 orders');
  });
});

/**
 * Every style must show the counts on its dish cards: through the shared `Badges`, a shared dish card that carries them, or its own `DishCounts`.
 * Periodic is the one exception: its tiles are about 100px wide and the line does not fit, so it shows them only in the opened dish.
 */
const DETAIL_ONLY = ['PeriodicBody'];

describe('the styles that show the counts', () => {
  const dir = join(process.cwd(), 'src/ui/template/bodies');
  const bodies = readdirSync(dir).filter((file) => file.endsWith('Body.tsx'));

  it('shows them in every style except the listed one', () => {
    const without = bodies
      .filter((file) => {
        const source = readFileSync(join(dir, file), 'utf8');
        return !/Badges|SalesTags|SalesPills|DishCounts|PhotoCard|IconDish|RowDish/.test(source);
      })
      .map((file) => file.replace('.tsx', ''))
      .sort();
    expect(without).toEqual([...DETAIL_ONLY].sort());
  });

  it('puts the counts in the opened dish of every style', () => {
    expect(readFileSync(join(process.cwd(), 'src/ui/product/TemplateDetail.tsx'), 'utf8')).toContain('<Badges');
    expect(readFileSync(join(process.cwd(), 'src/ui/product/ProductDetail.tsx'), 'utf8')).toContain('SalesPills');
  });
});
