import { describe, expect, it } from 'vitest';
import { buildMenuView } from '@/server/data/menu-view';
import type { TenantInfo } from '@/server/data/tenant';
import { DEFAULT_ENGINE_CONFIG } from '@/server/domain/config';
import { buildSnapshot, parseSnapshot, snapshotHash, toCatalog } from '@/server/domain/snapshot';
import type { CatalogOccasion, CatalogPromotion, CatalogShowcaseCard } from '@/server/domain/types';
import { at, IDS, makeBrand, makeCatalog, makeMenu, makeSnapshot, withProduct } from '../domain/fixtures';

const tenant: TenantInfo = {
  id: 'r-test',
  restaurantId: 'restaurant-test',
  feedbackEnabled: true,
  revisionId: 'revision-test',
  slug: 'test',
  name: 'Test',
  currency: 'USD',
  defaultLocale: 'en',
  locales: ['en', 'ar', 'ckb'],
  timeZone: 'Asia/Baghdad',
  numeralSystem: 'latn',
  engineConfig: DEFAULT_ENGINE_CONFIG,
  seo: {},
  features: { explore: true, stage: true, smartSelling: true, offers: true, socialProof: true, intro: true, about: true, wheel: true, dishCounts: true, drinkMatch: true, moodPicker: true, livingPhotos: true, occasionMoods: true, stories: true, models3d: true, ar: true, tableBasket: true, callWaiter: true, whatsapp: true, shareCards: true, rails: ['grains', 'drum', 'flap', 'deck', 'plain'] },
  extras: { intro: false, about: false, wheel: false, dishCounts: false, aboutTitle: { en: '', ar: '', ckb: '' } },
  brand: makeBrand(),
};

const happyHour: CatalogPromotion = {
  id: 'hh',
  kind: 'DISCOUNT',
  percentOff: 20,
  productIds: [IDS.burger],
  categoryIds: [],
  startsOn: null,
  endsOn: null,
  startMinute: 17 * 60,
  endMinute: 19 * 60,
  daysOfWeek: 127,
  roundTo: 5,
  translations: { en: { title: 'Happy hour' } },
  sortOrder: 0,
};

// at(18) is Thursday 2026-10-15, 18:00 in Baghdad.
const eid: CatalogOccasion = { id: 'eid', startsOn: '2026-10-14', endsOn: '2026-10-16', isActive: true, translations: { en: { name: 'Eid' }, ar: { name: 'العيد' } } };
const past: CatalogOccasion = { id: 'past', startsOn: '2026-09-01', endsOn: '2026-10-01', isActive: true, translations: { en: { name: 'Past' } } };

const card = (overrides: Partial<CatalogShowcaseCard> & Pick<CatalogShowcaseCard, 'id' | 'kind'>): CatalogShowcaseCard => ({
  slot: 'ABOVE_SEARCH',
  sortOrder: 0,
  occasionId: null,
  promotionId: null,
  bundleId: null,
  price: null,
  startMinute: null,
  endMinute: null,
  daysOfWeek: 127,
  translations: { en: { title: overrides.id, text: '' } },
  ...overrides,
});

const cards: CatalogShowcaseCard[] = [
  card({ id: 'c-offer', kind: 'OFFER', promotionId: 'hh', occasionId: 'eid', sortOrder: 0, translations: { en: { title: 'Eid deal', text: 'Burgers' }, ar: { title: 'عرض العيد', text: 'برغر' } } }),
  card({ id: 'c-set', kind: 'SET', bundleId: 'b-burger-meal', sortOrder: 1, translations: { en: { title: 'Family meal', text: 'For four' } } }),
  // The breakfast set's croissant is out of its hours at 18:00, so the set is not shown.
  card({ id: 'c-hidden-set', kind: 'SET', bundleId: 'b-breakfast', sortOrder: 2 }),
  card({ id: 'c-ended', kind: 'BUFFET', occasionId: 'past', price: 9000, sortOrder: 3 }),
  card({ id: 'c-buffet', kind: 'BUFFET', price: 25000, startMinute: 12 * 60, endMinute: 23 * 60, sortOrder: 4, translations: { en: { title: 'Open buffet', text: 'All you can eat' } } }),
  card({ id: 'c-below', kind: 'BUFFET', slot: 'BELOW_SEARCH', price: 5000 }),
];

function showcaseCatalog() {
  const base = makeCatalog({
    promotions: [happyHour],
    occasions: [eid, past],
    showcaseCards: cards,
  });
  const withPeople = { ...base, bundles: base.bundles.map((b) => (b.id === 'b-burger-meal' ? { ...b, people: 4 } : b)) };
  return withProduct(withPeople, IDS.croissant, { hideOutsideDaypart: true });
}

describe('buildMenuView showcase', () => {
  it('shows exactly the live cards of each slot, in Arabic with the default locale as fallback', () => {
    const view = buildMenuView(showcaseCatalog(), tenant, 'ar', at(18));
    expect(view.showcase.aboveSearch).toEqual([
      {
        id: 'c-offer',
        kind: 'OFFER',
        title: 'عرض العيد',
        text: 'برغر',
        occasion: 'العيد',
        price: null,
        people: null,
        productId: IDS.burger,
        categoryId: null,
        bundleId: null,
        perPerson: false,
        when: null,
      },
      {
        id: 'c-set',
        kind: 'SET',
        title: 'Family meal',
        text: 'For four',
        occasion: null,
        price: 1500,
        people: 4,
        productId: null,
        categoryId: null,
        bundleId: 'b-burger-meal',
        perPerson: false,
        when: null,
      },
      {
        id: 'c-buffet',
        kind: 'BUFFET',
        title: 'Open buffet',
        text: 'All you can eat',
        occasion: null,
        price: 25000,
        people: null,
        productId: null,
        categoryId: null,
        bundleId: null,
        perPerson: true,
        when: { startMinute: 720, endMinute: 1380, daysOfWeek: 127 },
      },
    ]);
    expect(view.showcase.belowSearch.map((c) => c.id)).toEqual(['c-below']);
  });

  it('hides an offer card once its offer is over, and shows the hidden set while its dishes are on', () => {
    const view = buildMenuView(showcaseCatalog(), tenant, 'en', at(8));
    expect(view.showcase.aboveSearch.map((c) => c.id)).toEqual(['c-set', 'c-hidden-set']);
  });

  it("shows a set card only in its set's times of day, even when its dishes stay on the menu", () => {
    // The fixture's croissant keeps the default hideOutsideDaypart: false, so it is on the menu at 18:00.
    const catalog = makeCatalog({ showcaseCards: [card({ id: 'c-breakfast', kind: 'SET', bundleId: 'b-breakfast' })] });
    expect(buildMenuView(catalog, tenant, 'en', at(18)).products.some((p) => p.id === IDS.croissant)).toBe(true);
    expect(buildMenuView(catalog, tenant, 'en', at(18)).showcase.aboveSearch).toEqual([]);
    expect(buildMenuView(catalog, tenant, 'en', at(8)).showcase.aboveSearch.map((c) => c.id)).toEqual(['c-breakfast']);
  });

  it('hides a set card while one of its dishes is sold out or out of stock', () => {
    const catalog = makeCatalog({ showcaseCards: [card({ id: 'c-set', kind: 'SET', bundleId: 'b-burger-meal' })] });
    expect(buildMenuView(catalog, tenant, 'en', at(18)).showcase.aboveSearch.map((c) => c.id)).toEqual(['c-set']);
    expect(buildMenuView(withProduct(catalog, IDS.fries, { isAvailable: false }), tenant, 'en', at(18)).showcase.aboveSearch).toEqual([]);
    expect(buildMenuView(withProduct(catalog, IDS.fries, { stockCount: 0 }), tenant, 'en', at(18)).showcase.aboveSearch).toEqual([]);
  });

  it('names what an offer is on when neither the card nor the offer has text, as the offer strip does', () => {
    const catalog = makeCatalog({
      promotions: [happyHour],
      showcaseCards: [card({ id: 'c-offer', kind: 'OFFER', promotionId: 'hh', translations: { en: { title: 'Deal' } } })],
    });
    const view = buildMenuView(catalog, tenant, 'en', at(18));
    expect(view.showcase.aboveSearch[0]?.text).toBe(IDS.burger);
    expect(view.showcase.aboveSearch[0]?.text).toBe(view.offers[0]?.text);
  });

  it("points an offer card on a category at the offer's first category with a dish shown, and a dish offer at no category", () => {
    const onCategories: CatalogPromotion = { ...happyHour, id: 'cats', productIds: [], categoryIds: ['cat-missing', 'cat-pastry', 'cat-cold'] };
    const catalog = makeCatalog({
      promotions: [onCategories, happyHour],
      showcaseCards: [
        card({ id: 'c-cats', kind: 'OFFER', promotionId: 'cats' }),
        card({ id: 'c-dish', kind: 'OFFER', promotionId: 'hh', sortOrder: 1 }),
      ],
    });
    const view = buildMenuView(catalog, tenant, 'en', at(18));
    expect(view.showcase.aboveSearch.map((c) => [c.id, c.productId, c.categoryId])).toEqual([
      ['c-cats', null, 'cat-pastry'],
      ['c-dish', IDS.burger, null],
    ]);
  });

  it('reaches guests through the published snapshot, with the bundle people and without a change to old hashes', () => {
    const catalog = showcaseCatalog();
    const snapshot = parseSnapshot(JSON.parse(JSON.stringify(makeSnapshot(catalog))));
    const served = toCatalog('m-test', snapshot, { products: {}, options: {} });
    expect(served.occasions).toEqual(catalog.occasions);
    expect(served.showcaseCards.map((c) => c.id).sort()).toEqual(cards.map((c) => c.id).sort());
    expect(served.bundles.find((b) => b.id === 'b-burger-meal')?.people).toBe(4);
    const view = buildMenuView(served, tenant, 'ar', at(18));
    expect(view.showcase.aboveSearch.map((c) => c.id)).toEqual(['c-offer', 'c-set', 'c-buffet']);

    // A menu with no cards, occasions or people publishes the same snapshot it did before.
    const plain = buildSnapshot({ menu: makeMenu(), brand: makeBrand(), catalog: makeCatalog() });
    expect(plain.catalog).not.toHaveProperty('occasions');
    expect(plain.catalog).not.toHaveProperty('showcaseCards');
    expect(plain.catalog.bundles.every((b) => !('people' in b))).toBe(true);
    expect(snapshotHash(plain)).toBe(snapshotHash(makeSnapshot()));
  });
});
