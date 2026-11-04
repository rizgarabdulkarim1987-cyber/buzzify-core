import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Messages } from '@/lib/i18n';
import type { Locale } from '@/lib/locale';
import { SpaceWords, StudioI18nProvider, useT } from '@/studio/i18n';
import { clientMessages, getStudioTranslator } from '@/studio/messages';
import pharmacyAr from '@/studio/messages/pharmacy/ar';
import pharmacyCkb from '@/studio/messages/pharmacy/ckb';
import pharmacyEn from '@/studio/messages/pharmacy/en';
import posAiAr from '@/studio/messages/pos-ai/ar';
import posAiCkb from '@/studio/messages/pos-ai/ckb';
import posAiEn from '@/studio/messages/pos-ai/en';
import posStockAr from '@/studio/messages/pos-stock/ar';
import posStockCkb from '@/studio/messages/pos-stock/ckb';
import posStockEn from '@/studio/messages/pos-stock/en';
import posTillAr from '@/studio/messages/pos-till/ar';
import posTillCkb from '@/studio/messages/pos-till/ckb';
import posTillEn from '@/studio/messages/pos-till/en';
import retailAr from '@/studio/messages/retail/ar';
import retailCkb from '@/studio/messages/retail/ckb';
import retailEn from '@/studio/messages/retail/en';
import salesDishesAr from '@/studio/messages/sales-dishes/ar';
import salesDishesCkb from '@/studio/messages/sales-dishes/ckb';
import salesDishesEn from '@/studio/messages/sales-dishes/en';
import { spaceNav } from '@/studio/nav';
import { PRODUCT_WORDS, productTwin, RETAIL_WORDS, retailTwin, spaceActions, spaceT } from '@/studio/space-words';
import { RETAIL_SPACE_IDS, type RetailSpaceId, type SpaceId } from '@/studio/spaces';

/**
 * The word guard: inside a space of the Super Admin hub nothing may name another product. Retail shows no restaurant,
 * menu, cashier, till, kitchen, guest, dish, pharmacy or prescription; Menu and Cashier and the Pharmacy show no Retail.
 * Each language's words are checked in every language (a Latin product name can sit in an Arabic sentence). The hub's
 * own picker, which lists every project, is not a space and is not checked here.
 */

const LOCALES: readonly Locale[] = ['en', 'ar', 'ckb'];

/** The other products, as Menu and Cashier and the Pharmacy name them in each language. */
const NOT_RETAIL = [
  /\b(restaurants?|menus?|cashiers?|POS|tills?|kitchens?|guests?|dish(es)?|pharmac\w*|prescriptions?)\b/i,
  /مطعم|مطاعم|القوائم|منيو|كاشير|الصندوق|مطبخ|ضيوف|الضيف|صيدل|الوصفات|وصفة/,
  /ڕێستۆران|مینیو|مێنو|کاشێر|قاسە|چێشتخانە|میوان|دەرمانخانە|ڕیسێت/,
];
/** Each Retail product, as it names itself in each language: no product's space may name another. */
const PRODUCT_NAMES: Record<RetailSpaceId, readonly RegExp[]> = {
  supermarket: [/supers?markets?/i, /سوبر ?ماركت/, /سوپەرمارکێت/],
  electronics: [/electronics?/i, /إلكترونيات|الإلكترونيات/, /ئەلیکترۆنیات/],
  clothing: [/cloth(es|ing)/i, /ملابس|الملابس/, /جلوبەرگ/],
};
const otherProducts = (space: RetailSpaceId) => RETAIL_SPACE_IDS.filter((other) => other !== space).flatMap((other) => PRODUCT_NAMES[other]);
/** A product's own keys and another's: `hub.<product>` and `<product>.as.*`. */
const ofProduct = (key: string, product: RetailSpaceId) => key === `hub.${product}` || key.startsWith(`${product}.as.`);
/** "Retail shop", the old single product's name for a shop: a product calls its shops by its own name. */
const RETAIL_SHOP = [/retail shops?/i, /محلات? تجزئة|محل التجزئة/, /دوکانی تاکە فرۆشی|دوکانێکی تاکە فرۆشی/];
/** Retail, as the Retail space names itself. */
const NOT_OTHERS = [/\bretails?\b/i, /تجزئة|التجزئة/, /تاکە فرۆشی/];

const offending = (text: string, words: readonly RegExp[]) => words.find((word) => word.test(text))?.source ?? null;

/** Every message `keys` render in a space, in every language, with the word that should not be there. */
function violations(space: SpaceId, keys: Iterable<string>, words: readonly RegExp[]): string[] {
  const found: string[] = [];
  for (const locale of LOCALES) {
    const t = spaceT(getStudioTranslator(locale), space);
    for (const key of keys) {
      const text = t(key, { name: 'X', email: 'x@y.z', count: 2, month: 'X', version: 1, attempts: 1, time: 'X', code: 'X', product: 'X', currency: 'X' });
      const word = offending(text, words);
      if (word) found.push(`${locale} ${key}: "${text}"`);
    }
  }
  return found;
}

const navKeys = (space: SpaceId) => spaceNav(space).map((item) => item.labelKey);
const actionKeys = (space: SpaceId) => spaceActions(space).map((action) => `activity.action.${action}`);
const keysOf = (...catalogs: Messages[]) => [...new Set(catalogs.flatMap((catalog) => Object.keys(catalog)))];

/** The shared texts the Retail space renders as they are (audited: they name no other product). */
const RETAIL_SHARED = [
  'hub.retail',
  'restaurants.tabs.profile',
  'restaurants.tabs.branches',
  'restaurants.tabs.billing',
  'restaurants.tabs.people',
  'restaurants.tabs.activity',
  'restaurants.tabs.retail',
  'restaurants.sector.RETAIL',
  'activity.title',
  'activity.description',
  'activity.col.when',
  'activity.col.who',
  'activity.col.action',
  'activity.col.entity',
  'activity.filter.actor',
  'activity.filter.anyActor',
  'activity.filter.action',
  'activity.filter.anyAction',
  'announcements.title',
  'billing.title',
  'billingList.emptyTitle',
  'people.title',
  'overview.title',
  'billingSettings.emptyTitle',
];

describe.each(RETAIL_SPACE_IDS)('the %s space', (product) => {
  const retailKeys = keysOf(retailEn, retailAr, retailCkb).filter((key) => !RETAIL_SPACE_IDS.some((other) => ofProduct(key, other)));
  const shown = [...retailKeys, ...RETAIL_WORDS, ...navKeys(product), ...actionKeys(product), ...RETAIL_SHARED, `hub.${product}`];

  it('has a Retail twin of every shared text it swaps, and its own text of every text it renames, in every language', () => {
    for (const locale of LOCALES) {
      const t = getStudioTranslator(locale);
      for (const key of RETAIL_WORDS) expect(t(retailTwin(key)), `${locale} ${retailTwin(key)}`).not.toBe(retailTwin(key));
      for (const key of PRODUCT_WORDS) expect(t(productTwin(product, key)), `${locale} ${productTwin(product, key)}`).not.toBe(productTwin(product, key));
      expect(t(`hub.${product}`)).not.toBe(`hub.${product}`);
    }
  });

  it('reads a shared text as its twin, a renamed text as its own, and leaves the other spaces their own words', () => {
    const t = getStudioTranslator('en');
    expect(spaceT(t, product)('billingList.restaurant')).toBe(t(retailTwin('billingList.restaurant')));
    expect(spaceT(t, product)('retail.new')).toBe(t(productTwin(product, 'retail.new')));
    expect(spaceT(t, product)('announcements.description')).toBe(t(productTwin(product, retailTwin('announcements.description'))));
    for (const space of ['food', 'pharmacy', 'platform', null] as const) expect(spaceT(t, space)('billingList.restaurant')).toBe(t('billingList.restaurant'));
  });

  it('names no other product in its own messages, its twins, its navigation, its actions or the shared texts it shows', () => {
    expect(violations(product, shown, NOT_RETAIL)).toEqual([]);
  });

  it('never shows another Retail product’s words, nor calls its shops “retail shops”', () => {
    expect(violations(product, shown, otherProducts(product))).toEqual([]);
    expect(violations(product, [...PRODUCT_WORDS, ...navKeys(product), 'restaurants.sector.RETAIL'], RETAIL_SHOP)).toEqual([]);
  });

  it('names itself in its list, its new shop and its businesses’ sector', () => {
    for (const locale of LOCALES) {
      const t = spaceT(getStudioTranslator(locale), product);
      for (const key of ['retail.title', 'retail.new', 'restaurants.sector.RETAIL', 'nav.retail']) {
        expect(PRODUCT_NAMES[product].some((name) => name.test(t(key))), `${locale} ${key}: ${t(key)}`).toBe(true);
      }
    }
  });

  it('offers only its own actions in the activity filter: no menu, till or pharmacy work', () => {
    const actions = spaceActions(product);
    expect(actions).toContain('retail.resync');
    expect(actions).toContain('restaurant.status_changed');
    expect(actions.filter((action) => /^(menu|pos|support|design|product|category)./.test(action))).toEqual([]);
  });
});

describe('Menu and Cashier and the Pharmacy', () => {
  it('never offer a Retail action in their activity filter', () => {
    for (const space of ['food', 'pharmacy'] as const) expect(spaceActions(space).filter((action) => action.startsWith('retail.'))).toEqual([]);
  });

  it('name no Retail in their navigation, their actions or their own messages', () => {
    const food = [...navKeys('food'), ...actionKeys('food'), ...keysOf(posTillEn, posTillAr, posTillCkb, posStockEn, posStockAr, posStockCkb, posAiEn, posAiAr, posAiCkb, salesDishesEn, salesDishesAr, salesDishesCkb), 'hub.food'];
    expect(violations('food', food, NOT_OTHERS)).toEqual([]);
    const pharmacy = [...navKeys('pharmacy'), ...actionKeys('pharmacy'), ...keysOf(pharmacyEn, pharmacyAr, pharmacyCkb), 'hub.pharmacy'];
    expect(violations('pharmacy', pharmacy, NOT_OTHERS)).toEqual([]);
  });
});

describe('the screens shared by the spaces', () => {
  const read = (relative: string) => readFileSync(path.join(process.cwd(), 'src/app/studio/(studio)/(app)', relative), 'utf8');

  it('translate in the words of the space they are rendered in: the server screens with spaceT', () => {
    for (const file of [
      'restaurants/[id]/BusinessLayout.tsx',
      'restaurants/[id]/RestaurantActions.tsx',
      'restaurants/RestaurantForm.tsx',
      'restaurants/[id]/activity/page.tsx',
      'activity/ActivityList.tsx',
      'activity/ActivityFilters.tsx',
      'announcements/AnnouncementsList.tsx',
      'billing/BillingList.tsx',
      '[product]/overview/page.tsx',
      '[product]/page.tsx',
      '[product]/new/page.tsx',
      '[product]/settings/page.tsx',
    ]) {
      expect(read(file), file).toContain('spaceT(');
    }
  });

  it('and every client screen inside the Retail space, or inside a retail shop, through SpaceWords', () => {
    expect(read('[product]/layout.tsx')).toContain('<SpaceWords space={product}>{children}</SpaceWords>');
    expect(read('restaurants/[id]/BusinessLayout.tsx')).toContain('<SpaceWords space={spaceOfSector(restaurant.sector, restaurant.retailActivity)}>{children}</SpaceWords>');
    expect(readFileSync(path.join(process.cwd(), 'src/studio/shell/JumpTo.tsx'), 'utf8')).toContain('<SpaceWords space=');
  });

  it('SpaceWords swaps a shared key for its Retail twin for the client components inside, and nothing else', () => {
    function Probe() {
      return createElement('span', null, `${useT()('billingList.restaurant')}|${useT()('common.save')}`);
    }
    const html = (space: SpaceId) =>
      renderToStaticMarkup(createElement(StudioI18nProvider, { locale: 'en', messages: clientMessages('en') } as never, createElement(SpaceWords, { space } as never, createElement(Probe))));
    for (const product of RETAIL_SPACE_IDS) expect(html(product)).toContain('Shop|Save');
    expect(html('food')).toContain('Restaurant|Save');
  });

  it("keeps a product's words when a screen inside it only knows the sector (an Electronics shop is never a supermarket)", () => {
    const t = getStudioTranslator('en');
    const electronics = spaceT(t, 'electronics');
    expect(spaceT(electronics, 'supermarket')('restaurants.sector.RETAIL')).toBe('Electronics shop');
    expect(spaceT(electronics, 'supermarket')('billingList.restaurant')).toBe(t(retailTwin('billingList.restaurant')));
  });

  it('show a retail shop no till staff and no menu permissions', () => {
    const people = read('restaurants/[id]/people/page.tsx');
    expect(people).toContain("restaurant.sector === 'FOOD'");
    expect(people).not.toContain("restaurant.sector !== 'PHARMACY'");
    expect(people).toContain("restaurant.can.permissions && restaurant.sector !== 'RETAIL'");
  });

  it("show a retail shop's profile no restaurant type, and the Retail space's activity no menu column or filter", () => {
    expect(read('restaurants/[id]/page.tsx')).toContain('sector={restaurant.sector}');
    expect(read('restaurants/RestaurantForm.tsx')).toMatch(/showType=\{sector === 'FOOD'\}/);
    expect(read('activity/ActivityList.tsx')).toContain('const withMenu = !isRetailSpace(space);');
    expect(read('activity/ActivityFilters.tsx')).toContain('{!isRetailSpace(space) && (');
    expect(read('activity/ActivityFilters.tsx')).toContain('spaceActions(space)');
  });
});
