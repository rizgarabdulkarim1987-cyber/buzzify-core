import { describe, expect, it } from 'vitest';
import atelier2a from './fixtures/atelier-snapshot-2a.json';
import {
  buildSnapshot,
  parseSnapshot,
  snapshotAssetIds,
  snapshotHash,
  toCatalog,
  type LiveOverlay,
  type MenuSnapshot,
} from '@/server/domain/snapshot';
import { TEMPLATES } from '@/lib/templates';
import { resolveDesign } from '@/lib/templates/resolve';
import { IDS, makeBrand, makeCatalog, makeMenu, makeSnapshot, product, withProduct } from './fixtures';

const menu = makeMenu();
const brand = makeBrand();
const catalog = makeCatalog();
const snapshot = buildSnapshot({ menu, brand, catalog });

const NO_OVERLAY: LiveOverlay = { products: {}, options: {} };

function reverseKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reverseKeys);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .reverse()
        .map(([key, entry]) => [key, reverseKeys(entry)]),
    );
  }
  return value;
}

describe('buildSnapshot', () => {
  it('drops the live fields and the menu id', () => {
    const live = { ...catalog, products: catalog.products.map((p) => ({ ...p, isAvailable: false, isHidden: true, stockCount: 3 })) };
    const frozen = buildSnapshot({ menu, brand, catalog: live });
    expect(frozen.catalog).not.toHaveProperty('menuId');
    for (const p of frozen.catalog.products) {
      expect(p).not.toHaveProperty('isAvailable');
      expect(p).not.toHaveProperty('isHidden');
      expect(p).not.toHaveProperty('stockCount');
      expect(p).toHaveProperty('lowStockThreshold');
      for (const option of p.groups.flatMap((g) => g.options)) expect(option).not.toHaveProperty('isAvailable');
    }
    expect(frozen.schemaVersion).toBe(1);
  });

  it('sorts categories and products by sort order, then id', () => {
    const base = makeCatalog();
    const reordered = {
      ...base,
      categories: [...base.categories].reverse(),
      products: [
        product({ id: 'p-c', sortOrder: 1 }),
        product({ id: 'p-b', sortOrder: 0 }),
        product({ id: 'p-a', sortOrder: 1 }),
      ],
    };
    const frozen = buildSnapshot({ menu, brand, catalog: reordered });
    expect(frozen.catalog.categories.map((c) => c.id)).toEqual(base.categories.map((c) => c.id));
    expect(frozen.catalog.products.map((p) => p.id)).toEqual(['p-b', 'p-a', 'p-c']);
  });

  it('keeps the order of options, groups and variants, which the draft fixes by position', () => {
    const base = makeCatalog();
    const burger = base.products.find((p) => p.id === IDS.burger)!;
    const frozen = buildSnapshot({ menu, brand, catalog: base });
    const frozenBurger = frozen.catalog.products.find((p) => p.id === IDS.burger)!;
    expect(frozenBurger.groups[0]!.options.map((o) => o.id)).toEqual(burger.groups[0]!.options.map((o) => o.id));
    expect(frozenBurger.groups[0]!.options.map((o) => o.id)).toEqual([IDS.optCheese, IDS.optDouble, IDS.optBacon]);
  });

  it('does not change the catalog it is given', () => {
    const input = makeCatalog();
    const before = structuredClone(input);
    buildSnapshot({ menu, brand, catalog: input });
    expect(input).toEqual(before);
  });
});

describe('snapshotHash', () => {
  it('produces the same hash regardless of row order and live fields', () => {
    const a = buildSnapshot({ menu, brand, catalog });
    const shuffled = {
      ...catalog,
      categories: [...catalog.categories].reverse(),
      products: [...catalog.products].reverse().map((p) => ({ ...p, isAvailable: false, stockCount: 3 })),
      upsellRules: [...catalog.upsellRules].reverse(),
      pairingRules: [...catalog.pairingRules].reverse(),
      bundles: [...catalog.bundles].reverse(),
      schedule: [...catalog.schedule].reverse(),
    };
    expect(snapshotHash(buildSnapshot({ menu, brand, catalog: shuffled }))).toBe(snapshotHash(a));
  });

  it('is a SHA-256 hex digest', () => {
    expect(snapshotHash(snapshot)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('does not depend on the order object keys were written in', () => {
    expect(snapshotHash(reverseKeys(snapshot) as MenuSnapshot)).toBe(snapshotHash(snapshot));
  });

  it('changes when a price changes', () => {
    const burger = catalog.products.find((p) => p.id === IDS.burger)!;
    const dearer = withProduct(catalog, IDS.burger, { basePrice: burger.basePrice + 50 });
    expect(snapshotHash(buildSnapshot({ menu, brand, catalog: dearer }))).not.toBe(snapshotHash(snapshot));
  });

  it('changes when the brand or the menu settings change', () => {
    const rebranded = buildSnapshot({ menu, brand: makeBrand({ theme: 'light' }), catalog });
    const renamed = buildSnapshot({ menu: makeMenu({ displayName: 'Another Cafe' }), brand, catalog });
    expect(snapshotHash(rebranded)).not.toBe(snapshotHash(snapshot));
    expect(snapshotHash(renamed)).not.toBe(snapshotHash(snapshot));
  });
});

describe('parseSnapshot', () => {
  it('round-trips through JSON', () => {
    const s = buildSnapshot({ menu, brand, catalog });
    expect(parseSnapshot(JSON.parse(JSON.stringify(s)))).toEqual(s);
  });

  it('keeps the hash through a round trip', () => {
    const parsed = parseSnapshot(JSON.parse(JSON.stringify(snapshot)));
    expect(snapshotHash(parsed)).toBe(snapshotHash(snapshot));
  });

  it('round-trips a menu with Sorani and Arabic copy and SEO text', () => {
    const rich = makeSnapshot(makeCatalog(), {
      locales: ['en', 'ar', 'ckb'],
      numeralSystem: 'arab',
      seo: { ckb: { title: 'کافێ', description: 'مینیو' } },
    });
    expect(parseSnapshot(JSON.parse(JSON.stringify(rich)))).toEqual(rich);
  });

  it('rejects an unknown schema version', () => {
    expect(() => parseSnapshot({ schemaVersion: 2 })).toThrow('Unsupported snapshot schema version 2');
  });

  it('rejects input with no schema version', () => {
    expect(() => parseSnapshot({})).toThrow('Unsupported snapshot schema version');
    expect(() => parseSnapshot(null)).toThrow('Unsupported snapshot schema version');
  });

  it('rejects a snapshot of the current version whose shape is wrong', () => {
    const broken = JSON.parse(JSON.stringify(snapshot));
    broken.catalog.products[0].basePrice = 'free';
    expect(() => parseSnapshot(broken)).toThrow();
    const missing = JSON.parse(JSON.stringify(snapshot));
    delete missing.brand;
    expect(() => parseSnapshot(missing)).toThrow();
  });
});

describe('toCatalog', () => {
  const burger = catalog.products.find((p) => p.id === IDS.burger)!;

  it('applies the live overlay', () => {
    const c = toCatalog('m1', snapshot, {
      products: { [IDS.burger]: { isAvailable: false, isHidden: false, stockCount: 2 } },
      options: {},
    });
    expect(c.menuId).toBe('m1');
    expect(c.products.find((p) => p.id === IDS.burger)).toMatchObject({ isAvailable: false, isHidden: false, stockCount: 2 });
  });

  it('defaults ids missing from the overlay to available, not hidden, with no stock count', () => {
    const c = toCatalog('m1', snapshot, NO_OVERLAY);
    expect(c.products).toHaveLength(catalog.products.length);
    for (const p of c.products) expect(p).toMatchObject({ isAvailable: true, isHidden: false, stockCount: null });
    for (const o of c.products.flatMap((p) => p.groups.flatMap((g) => g.options))) expect(o.isAvailable).toBe(true);
  });

  it('applies option availability', () => {
    const c = toCatalog('m1', snapshot, { products: {}, options: { [IDS.optBacon]: { isAvailable: false } } });
    const options = c.products.find((p) => p.id === IDS.burger)!.groups[0]!.options;
    expect(options.find((o) => o.id === IDS.optBacon)!.isAvailable).toBe(false);
    expect(options.find((o) => o.id === IDS.optCheese)!.isAvailable).toBe(true);
  });

  it('carries the menu settings and the catalog structure over', () => {
    const c = toCatalog('m1', snapshot, NO_OVERLAY);
    expect(c).toMatchObject({ currency: 'USD', timeZone: 'Asia/Baghdad', defaultLocale: 'en' });
    expect(c.categories).toEqual(snapshot.catalog.categories);
    expect(c.schedule).toEqual(snapshot.catalog.schedule);
    expect(c.pairingRules).toEqual(snapshot.catalog.pairingRules);
    expect(c.products.find((p) => p.id === IDS.burger)).toMatchObject({
      basePrice: burger.basePrice,
      slug: burger.slug,
      dietary: [],
      calories: null,
      badges: [],
    });
  });

  it('removes hidden products and the bundles and rules that reference them', () => {
    const c = toCatalog('m1', snapshot, {
      products: { [IDS.fries]: { isAvailable: true, isHidden: true, stockCount: null } },
      options: {},
    });
    expect(c.products.map((p) => p.id)).not.toContain(IDS.fries);
    // Both bundles that contain fries are gone; the breakfast set is untouched.
    expect(c.bundles.map((b) => b.id)).toEqual(['b-breakfast']);
    // The burger and steak pairings that suggest fries are gone; the others stay.
    expect(c.pairingRules.map((r) => r.id)).not.toContain('r-burger-fries');
    expect(c.pairingRules.map((r) => r.id)).not.toContain('r-steak-fries');
    expect(c.pairingRules.map((r) => r.id)).toContain('r-burger-sparkling');
    expect(c.upsellRules).toHaveLength(1);
  });

  it('removes the rules a hidden product is the source or target of', () => {
    const noBurger = toCatalog('m1', snapshot, {
      products: { [IDS.burger]: { isAvailable: true, isHidden: true, stockCount: null } },
      options: {},
    });
    // The wagyu upsell has the burger as its source; the burger pairings too.
    expect(noBurger.upsellRules).toEqual([]);
    expect(noBurger.pairingRules.map((r) => r.id).sort()).toEqual([
      'r-coffee-cheesecake',
      'r-coffee-croissant',
      'r-pastry-espresso',
      'r-steak-fries',
    ]);

    const noWagyu = toCatalog('m1', snapshot, {
      products: { [IDS.wagyu]: { isAvailable: true, isHidden: true, stockCount: null } },
      options: {},
    });
    // The wagyu upsell has the wagyu as its target.
    expect(noWagyu.upsellRules).toEqual([]);

    const noCroissant = toCatalog('m1', snapshot, {
      products: { [IDS.croissant]: { isAvailable: true, isHidden: true, stockCount: null } },
      options: {},
    });
    // A category-sourced pairing goes when its target does.
    expect(noCroissant.pairingRules.map((r) => r.id)).not.toContain('r-coffee-croissant');
    expect(noCroissant.bundles.map((b) => b.id)).not.toContain('b-breakfast');
  });

  it('does not change the snapshot', () => {
    const frozen = makeSnapshot();
    const before = structuredClone(frozen);
    toCatalog('m1', frozen, {
      products: { [IDS.fries]: { isAvailable: false, isHidden: true, stockCount: 1 } },
      options: { [IDS.optBacon]: { isAvailable: false } },
    });
    expect(frozen).toEqual(before);
  });

  it('gives back the catalog the snapshot was built from when nothing is overridden', () => {
    const c = toCatalog(catalog.menuId, snapshot, NO_OVERLAY);
    const bySortOrder = <T extends { sortOrder: number; id: string }>(list: T[]) =>
      [...list].sort((a, b) => a.sortOrder - b.sortOrder || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    expect(c.products).toEqual(bySortOrder(catalog.products));
  });
});

describe('2b additions', () => {
  // Written by 2a's code (Task 3, step 1): the ATELIER draft as 2a published it, and the hash 2a computed for it.
  const fixture = atelier2a as { snapshot: unknown; hash: string };

  const logo = {
    assetId: 'asset-logo',
    url: 'https://media.example.com/r/r1/abc/webp-640.webp',
    width: 640,
    height: 320,
    svg: false,
    rasterKey: 'r/r1/abc/webp-640.webp',
  };
  const favicon = { assetId: 'asset-logo', png32: '/m/f32.png', png180: '/m/f180.png', png512: '/m/f512.png' };
  const seoImage = { assetId: 'asset-seo', url: '/api/dev-media/r/r1/def/webp-1080.webp', width: 1080, height: 566 };
  const libraryImage = {
    kind: 'image',
    url: '/api/dev-media/r/r1/ghi/webp-1080.webp',
    alt: 'Espresso',
    width: 1200,
    height: 800,
    assetId: 'asset-photo',
  };

  const rich = () =>
    buildSnapshot({
      menu: makeMenu({ seo: { en: { title: 'T', description: 'D', image: seoImage } } }),
      brand: makeBrand({ fontPairId: 'cafe', railChoice: 'drum', railStyle: 'plain', motionIntensity: 'none', logo, logoDark: logo, favicon }),
      catalog: withProduct(catalog, IDS.burger, { media: [libraryImage] }),
    });

  it('reads a snapshot published before 2b and hashes it as it was', () => {
    const parsed = parseSnapshot(fixture.snapshot);
    expect(snapshotHash(parsed)).toBe(fixture.hash);
    // Nothing is added on the way in: no defaults, no undefined keys.
    expect(JSON.parse(JSON.stringify(parsed))).toEqual(fixture.snapshot);
  });

  it('leaves unused 2b fields out of the snapshot and the hash', () => {
    const plain = buildSnapshot({ menu, brand, catalog });
    expect(Object.keys(plain.brand).sort()).toEqual(['logoText', 'motionIntensity', 'railStyle', 'theme', 'tokens']);
    expect(snapshotHash(parseSnapshot(JSON.parse(JSON.stringify(plain))))).toBe(snapshotHash(snapshot));
  });

  it('changes the hash when a logo is set', () => {
    const withLogo = buildSnapshot({ menu, brand: makeBrand({ logo }), catalog });
    expect(snapshotHash(withLogo)).not.toBe(snapshotHash(snapshot));
  });

  it('round-trips logos, favicon, font pair, rail choice and SEO images through JSON', () => {
    const s = rich();
    const parsed = parseSnapshot(JSON.parse(JSON.stringify(s)));
    expect(parsed).toEqual(s);
    expect(snapshotHash(parsed)).toBe(snapshotHash(s));
  });

  it.each(['javascript:alert(1)', '//evil.example/logo.png', 'http://media.example.com/logo.png'])(
    'refuses a logo whose url is %s',
    (url) => {
      const s = JSON.parse(JSON.stringify(rich()));
      s.brand.logo.url = url;
      expect(() => parseSnapshot(s)).toThrow();
    },
  );

  it('refuses an unknown font pair', () => {
    const s = JSON.parse(JSON.stringify(rich()));
    s.brand.fontPairId = 'comic';
    expect(() => parseSnapshot(s)).toThrow();
  });

  it('lists every asset a snapshot uses, once, sorted', () => {
    expect(snapshotAssetIds(rich())).toEqual(['asset-logo', 'asset-photo', 'asset-seo']);
    expect(snapshotAssetIds(snapshot)).toEqual([]);
    expect(snapshotAssetIds(parseSnapshot(fixture.snapshot))).toEqual([]);
  });
});

describe('template designs', () => {
  const withDesign = (): MenuSnapshot => {
    const design = resolveDesign(
      TEMPLATES['gelato-riviera'],
      { featured: { slugs: ['latte'] }, promo: { title: { en: 'Two scoops' }, body: {}, terms: { en: 'Weekdays only' } } },
      {
        details: {
          address: '9 Shore Road',
          city: 'Duhok',
          phone: '+964 750 111 2222',
          whatsapp: '',
          mapUrl: 'https://maps.example.com/x',
          socialLinks: { instagram: 'https://instagram.com/gelato' },
          workingHours: { fri: [['12:00', '23:30']] },
        },
        poweredBy: true,
      },
    );
    return buildSnapshot({ menu, brand: { ...brand, design }, catalog });
  };

  it('round-trips a design through JSON and keeps its hash', () => {
    const s = withDesign();
    const parsed = parseSnapshot(JSON.parse(JSON.stringify(s)));
    expect(parsed).toEqual(s);
    expect(snapshotHash(parsed)).toBe(snapshotHash(s));
    expect(snapshotHash(s)).not.toBe(snapshotHash(snapshot));
  });

  it.each([
    ['a map link that is not https', (s: MenuSnapshot) => ((s.brand.design!.info as Record<string, unknown>).mapUrl = 'javascript:alert(1)')],
    ['a colour that is not a colour', (s: MenuSnapshot) => ((s.brand.design!.palette as unknown as Record<string, string>).bg = 'url(x)')],
    ['an unknown template', (s: MenuSnapshot) => ((s.brand.design as unknown as Record<string, string>).templateId = 'comic')],
    ['an unknown card kind', (s: MenuSnapshot) => ((s.brand.design!.layout as unknown as Record<string, string>).card = 'marquee')],
  ])('refuses %s', (_, spoil) => {
    const s = JSON.parse(JSON.stringify(withDesign())) as MenuSnapshot;
    spoil(s);
    expect(() => parseSnapshot(s)).toThrow();
  });
});
