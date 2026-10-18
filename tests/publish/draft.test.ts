import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@/generated/prisma/client';
import { scopedClient } from '@/server/data/tenant-db';
import { snapshotHash, type MenuSnapshot } from '@/server/domain/snapshot';
import { loadDraftSnapshot, refreshDraftHash, writeDraftFromSnapshot } from '@/server/publish/draft';
import { ATELIER } from '../../prisma/seed/atelier';
import { resetTestData, seedAtelier, testPrisma } from '../helpers/db';

const prisma = testPrisma();

/**
 * The snapshot with every id replaced by the slug path of what it names (`product:latte/variant:1`), so two menus'
 * snapshots compare by meaning. Lists ordered by id are re-sorted by content, and the menu's own name is blanked.
 */
function stripIds(snapshot: MenuSnapshot) {
  const { catalog } = snapshot;
  const paths = new Map<string, string>();
  for (const category of catalog.categories) paths.set(category.id, `category:${category.slug}`);
  for (const product of catalog.products) {
    const base = `product:${product.slug}`;
    paths.set(product.id, base);
    product.variants.forEach((variant, i) => paths.set(variant.id, `${base}/variant:${i}`));
    product.groups.forEach((group, i) => {
      paths.set(group.id, `${base}/group:${i}`);
      group.options.forEach((option, j) => paths.set(option.id, `${base}/group:${i}/option:${j}`));
    });
  }
  for (const bundle of catalog.bundles) paths.set(bundle.id, `bundle:${bundle.slug}`);
  const path = (id: string | null) => (id === null ? null : (paths.get(id) ?? `unknown:${id}`));
  const byContent = <T>(rows: T[]) => [...rows].sort((x, y) => JSON.stringify(x).localeCompare(JSON.stringify(y)));

  return {
    ...snapshot,
    menu: { ...snapshot.menu, name: '<menu name>' },
    catalog: {
      ...catalog,
      categories: catalog.categories.map((c) => ({ ...c, id: path(c.id) })),
      products: catalog.products.map((p) => ({
        ...p,
        id: path(p.id),
        categoryId: path(p.categoryId),
        variants: p.variants.map((v) => ({ ...v, id: path(v.id), productId: path(v.productId) })),
        groups: p.groups.map((g) => ({
          ...g,
          id: path(g.id),
          productId: path(g.productId),
          options: g.options.map((o) => ({ ...o, id: path(o.id), groupId: path(o.groupId) })),
        })),
      })),
      upsellRules: byContent(
        catalog.upsellRules.map((r) => ({
          ...r,
          id: 'rule',
          sourceProductId: path(r.sourceProductId),
          targetProductId: path(r.targetProductId),
        })),
      ),
      pairingRules: byContent(
        catalog.pairingRules.map((r) => ({
          ...r,
          id: 'rule',
          sourceProductId: path(r.sourceProductId),
          sourceCategoryId: path(r.sourceCategoryId),
          targetProductId: path(r.targetProductId),
        })),
      ),
      bundles: catalog.bundles.map((b) => ({
        ...b,
        id: path(b.id),
        // A bundle's items are a set; the loader lists them in id order, which new ids may change.
        items: byContent(
          b.items.map((item) => ({ ...item, productId: path(item.productId), variantId: path(item.variantId) })),
        ),
      })),
      ...(catalog.promotions
        ? {
            promotions: catalog.promotions.map((p) => ({
              ...p,
              id: 'promotion',
              productIds: p.productIds.map((id) => path(id)),
              categoryIds: p.categoryIds.map((id) => path(id)),
            })),
          }
        : {}),
    },
  };
}

/** Every id a snapshot mentions. */
function idsOf(snapshot: MenuSnapshot): Set<string> {
  const { catalog } = snapshot;
  return new Set([
    ...catalog.categories.map((c) => c.id),
    ...catalog.products.flatMap((p) => [
      p.id,
      ...p.variants.map((v) => v.id),
      ...p.groups.flatMap((g) => [g.id, ...g.options.map((o) => o.id)]),
    ]),
    ...catalog.upsellRules.map((r) => r.id),
    ...catalog.pairingRules.map((r) => r.id),
    ...catalog.bundles.map((b) => b.id),
    ...(catalog.promotions ?? []).map((p) => p.id),
  ]);
}

/** How many rows of each draft table belong to a menu. */
async function rowCounts(db: PrismaClient, menuId: string) {
  const where = { menuId };
  return {
    brand: await db.brandConfig.count({ where }),
    categories: await db.category.count({ where }),
    products: await db.product.count({ where }),
    variants: await db.productVariant.count({ where }),
    groups: await db.modifierGroup.count({ where }),
    options: await db.modifierOption.count({ where }),
    upsellRules: await db.upsellRule.count({ where }),
    pairingRules: await db.pairingRule.count({ where }),
    bundles: await db.bundle.count({ where }),
    bundleItems: await db.bundleItem.count({ where }),
    schedule: await db.daypartSchedule.count({ where }),
    tables: await db.table.count({ where }),
  };
}

describe('draft snapshots', () => {
  let restaurantId = '';
  let atelierMenuId = '';
  let copies = 0;

  /** A new menu in the ATELIER restaurant with ATELIER's settings and nothing else. */
  async function emptyMenu(): Promise<string> {
    copies += 1;
    const r = ATELIER.restaurant;
    const menu = await prisma.menu.create({
      data: {
        restaurantId,
        name: `ATELIER copy ${copies}`,
        slug: `atelier-copy-${copies}`,
        currency: r.currency,
        defaultLocale: r.defaultLocale,
        locales: r.locales,
        timezone: r.timezone,
        numeralSystem: r.numeralSystem,
      },
    });
    return menu.id;
  }

  beforeAll(async () => {
    await resetTestData(prisma);
    const seeded = await seedAtelier(prisma);
    restaurantId = seeded.restaurant.id;
    atelierMenuId = seeded.menuId;
  });

  afterAll(async () => {
    await resetTestData(prisma);
    await prisma.$disconnect();
  });

  it('reads the settings from the menu, the name from the restaurant and the brand from the brand kit', async () => {
    const snapshot = await loadDraftSnapshot(prisma, atelierMenuId);
    expect(snapshot.menu).toMatchObject({
      name: 'ATELIER',
      displayName: 'ATELIER',
      currency: 'USD',
      defaultLocale: 'en',
      locales: ['en', 'ar', 'ckb'],
      timeZone: 'Asia/Baghdad',
      numeralSystem: 'latn',
      seo: {},
    });
    expect(snapshot.brand).toMatchObject({ logoText: 'ATELIER', theme: 'dark', railStyle: 'deck' });
    expect(snapshot.brand.tokens.dark.accent).toBe('#D6BC8A');
    expect(snapshot.catalog.products).toHaveLength(24);
  });

  it('carries the demo’s sales tools: a happy hour and a special, meal categories and a dish to share', async () => {
    const { catalog } = await loadDraftSnapshot(prisma, atelierMenuId);
    expect(catalog.promotions?.map((p) => [p.kind, p.percentOff, p.startMinute, p.endMinute])).toEqual([
      ['DISCOUNT', 20, 17 * 60, 19 * 60],
      ['SPECIAL', null, null, null],
    ]);
    expect(catalog.categories.filter((c) => c.completesMeal).map((c) => c.slug)).toEqual(['patisserie', 'cold']);
    expect(catalog.products.find((p) => p.slug === 'truffle-fries')?.serves).toBe(2);
  });

  it('stores the hash of the draft', async () => {
    const hash = await refreshDraftHash(prisma, atelierMenuId);
    expect(hash).toBe(snapshotHash(await loadDraftSnapshot(prisma, atelierMenuId)));
    expect((await prisma.menu.findUniqueOrThrow({ where: { id: atelierMenuId } })).draftHash).toBe(hash);
  });

  it('writes a snapshot into another menu and reads back the same snapshot apart from ids', async () => {
    const emptyMenuId = await emptyMenu();
    const source = await loadDraftSnapshot(prisma, atelierMenuId);
    await prisma.$transaction((tx) => writeDraftFromSnapshot(tx, emptyMenuId, source));
    const copy = await loadDraftSnapshot(prisma, emptyMenuId);
    expect(stripIds(copy)).toEqual(stripIds(source));
    // Every row is new: no id of the source appears in the copy.
    const sourceIds = idsOf(source);
    expect([...idsOf(copy)].filter((id) => sourceIds.has(id))).toEqual([]);
    expect((await prisma.menu.findUniqueOrThrow({ where: { id: emptyMenuId } })).draftHash).toBe(snapshotHash(copy));
  });

  it('leaves the source menu untouched', async () => {
    const before = await rowCounts(prisma, atelierMenuId);
    const hashBefore = snapshotHash(await loadDraftSnapshot(prisma, atelierMenuId));
    const source = await loadDraftSnapshot(prisma, atelierMenuId);
    const target = await emptyMenu();
    await prisma.$transaction((tx) => writeDraftFromSnapshot(tx, target, source));
    expect(await rowCounts(prisma, atelierMenuId)).toEqual(before);
    expect(snapshotHash(await loadDraftSnapshot(prisma, atelierMenuId))).toBe(hashBefore);
  });

  it("replaces the target's draft and brand but leaves its tables alone", async () => {
    const target = await emptyMenu();
    await prisma.category.create({ data: { menuId: target, slug: 'old', translations: { en: { name: 'Old' } } } });
    await prisma.brandConfig.create({
      data: { menuId: target, tokens: {}, typography: { display: 'Kept' }, logoText: 'Old logo', navStyle: 'tabs' },
    });
    await prisma.table.create({ data: { menuId: target, number: 9, label: 'Table 09' } });

    const source = await loadDraftSnapshot(prisma, atelierMenuId);
    await prisma.$transaction((tx) => writeDraftFromSnapshot(tx, target, source));

    const counts = await rowCounts(prisma, target);
    const sourceCounts = await rowCounts(prisma, atelierMenuId);
    expect(counts).toEqual({ ...sourceCounts, tables: 1 });
    expect(await prisma.category.findFirst({ where: { menuId: target, slug: 'old' } })).toBeNull();
    const brand = await prisma.brandConfig.findUniqueOrThrow({ where: { menuId: target } });
    // The brand kit's published fields come from the snapshot; what the snapshot does not carry is kept.
    expect(brand).toMatchObject({ logoText: 'ATELIER', railStyle: 'deck', typography: { display: 'Kept' }, navStyle: 'tabs' });
    expect(await prisma.table.findMany({ where: { menuId: target }, select: { number: true } })).toEqual([{ number: 9 }]);
  });

  it('starts every copied product and option available, shown and uncounted', async () => {
    const product = await prisma.product.findFirstOrThrow({ where: { menuId: atelierMenuId, slug: 'atelier-burger' } });
    const option = await prisma.modifierOption.findFirstOrThrow({ where: { menuId: atelierMenuId, group: { productId: product.id } } });
    await prisma.product.update({ where: { id: product.id }, data: { isAvailable: false, isHidden: true, stockCount: 2 } });
    await prisma.modifierOption.update({ where: { id: option.id }, data: { isAvailable: false } });
    try {
      const target = await emptyMenu();
      const source = await loadDraftSnapshot(prisma, atelierMenuId);
      await prisma.$transaction((tx) => writeDraftFromSnapshot(tx, target, source));
      const copied = await prisma.product.findFirstOrThrow({ where: { menuId: target, slug: 'atelier-burger' } });
      expect(copied).toMatchObject({ isAvailable: true, isHidden: false, stockCount: null });
      expect(await prisma.modifierOption.count({ where: { menuId: target, isAvailable: false } })).toBe(0);
    } finally {
      const { isAvailable, isHidden, stockCount } = product;
      await prisma.product.update({ where: { id: product.id }, data: { isAvailable, isHidden, stockCount } });
      await prisma.modifierOption.update({ where: { id: option.id }, data: { isAvailable: option.isAvailable } });
    }
  });

  it('writes through a transaction scoped to the target menu', async () => {
    const target = await emptyMenu();
    const source = await loadDraftSnapshot(prisma, atelierMenuId);
    await scopedClient(prisma, { menuId: target }).$transaction((tx) => writeDraftFromSnapshot(tx, target, source));
    expect(stripIds(await loadDraftSnapshot(prisma, target))).toEqual(stripIds(source));
  });
});

describe('library images in a written draft', () => {
  it('writes a resolved image back as its asset, through a map of copied assets when one is given', async () => {
    const { draftMediaFromSnapshot } = await import('@/server/media/resolve');
    const image = { kind: 'image', url: '/x/webp-1080.webp', alt: 'A', width: 10, height: 10, assetId: 'old' };
    const art = { kind: 'art', art: 'cup', tone: '#123456' };
    const external = { kind: 'image', url: 'https://cdn.example.com/a.jpg', alt: 'B', width: 1, height: 1 };
    expect(draftMediaFromSnapshot([image, art, external])).toEqual([{ kind: 'asset', assetId: 'old' }, art, external]);
    expect(draftMediaFromSnapshot([image], new Map([['old', 'new']]))).toEqual([{ kind: 'asset', assetId: 'new' }]);
  });
});

describe('the brand kit written back from a snapshot', () => {
  const palette = { bg: '#000000', surface: '#111111', raised: '#222222', accent: '#d6bc8a', text: '#ffffff', muted: '#bbbbbb', line: '#333333', onAccent: '#000000' };
  const base = { logoText: 'Atelier', theme: 'dark' as const, motionIntensity: 'none' as const, railStyle: 'plain' as const, tokens: { dark: palette, light: palette } };
  const image = (assetId: string) => ({ assetId, url: `/m/${assetId}.webp`, width: 600, height: 300, svg: false, rasterKey: `r/${assetId}/webp-640.webp` });

  it('keeps the rail choice, the pair and the assets, through a map of copied assets', async () => {
    const { brandRowFromSnapshot } = await import('@/server/publish/draft');
    const row = brandRowFromSnapshot(
      { ...base, railChoice: 'drum', fontPairId: 'cafe', logo: image('logo'), logoDark: image('dark'), favicon: { assetId: 'logo', png32: 'a', png180: 'b', png512: 'c' } },
      new Map([['logo', 'logo-copy']]),
    );
    expect(row).toMatchObject({
      railStyle: 'drum',
      fontPairId: 'cafe',
      logoAssetId: 'logo-copy',
      logoDarkAssetId: 'dark',
      faviconAssetId: null,
      faviconFromLogo: true,
      theme: 'DARK',
      motionIntensity: 'none',
      logoText: 'Atelier',
    });
  });

  it('writes a kit without the 2b fields as the classic pair, without assets', async () => {
    const { brandRowFromSnapshot } = await import('@/server/publish/draft');
    expect(brandRowFromSnapshot(base)).toMatchObject({ railStyle: 'plain', fontPairId: 'classic', logoAssetId: null, logoDarkAssetId: null, faviconAssetId: null, faviconFromLogo: false });
  });

  it('keeps an uploaded favicon of its own', async () => {
    const { brandRowFromSnapshot } = await import('@/server/publish/draft');
    expect(brandRowFromSnapshot({ ...base, logo: image('logo'), favicon: { assetId: 'icon', png32: 'a', png180: 'b', png512: 'c' } })).toMatchObject({
      faviconAssetId: 'icon',
      faviconFromLogo: false,
    });
  });
});

describe('sales fields in a written draft', () => {
  it("copies an offer onto the copy's own dishes and categories, and drops ids that did not come across", async () => {
    await resetTestData(prisma);
    const seeded = await seedAtelier(prisma);
    const source = await loadDraftSnapshot(prisma, seeded.menuId);
    const [first, second] = source.catalog.products;
    const category = source.catalog.categories[0]!;
    source.catalog.promotions = [
      {
        id: 'promo-src',
        kind: 'SPECIAL',
        percentOff: null,
        productIds: [first!.id, 'gone-product'],
        categoryIds: [category.id],
        startsOn: '2026-10-01',
        endsOn: '2026-10-31',
        startMinute: null,
        endMinute: null,
        daysOfWeek: 62,
        roundTo: 5,
        translations: { en: { title: 'Chef special' } },
        sortOrder: 0,
      },
      { id: 'promo-empty', kind: 'SPECIAL', percentOff: null, productIds: ['gone'], categoryIds: [], startsOn: null, endsOn: null, startMinute: null, endMinute: null, daysOfWeek: 127, roundTo: 5, translations: {}, sortOrder: 1 },
    ];
    source.catalog.products = source.catalog.products.map((p) => (p.id === second!.id ? { ...p, serves: 3 } : p));
    source.catalog.categories = source.catalog.categories.map((c) => (c.id === category.id ? { ...c, completesMeal: true } : c));

    const target = await prisma.menu.create({
      data: { restaurantId: seeded.restaurant.id, name: 'Sales copy', slug: 'sales-copy', currency: 'USD', defaultLocale: 'en', locales: ['en'], timezone: 'Asia/Baghdad' },
    });
    await prisma.$transaction((tx) => writeDraftFromSnapshot(tx, target.id, source));

    const copy = await loadDraftSnapshot(prisma, target.id);
    const copiedFirst = copy.catalog.products.find((p) => p.slug === first!.slug)!;
    const copiedCategory = copy.catalog.categories.find((c) => c.slug === category.slug)!;
    expect(copy.catalog.promotions).toHaveLength(1);
    expect(copy.catalog.promotions?.[0]).toMatchObject({
      kind: 'SPECIAL',
      productIds: [copiedFirst.id],
      categoryIds: [copiedCategory.id],
      startsOn: '2026-10-01',
      endsOn: '2026-10-31',
      daysOfWeek: 62,
      translations: { en: { title: 'Chef special' } },
    });
    expect(copy.catalog.promotions?.[0]?.id).not.toBe('promo-src');
    expect(copy.catalog.products.find((p) => p.slug === second!.slug)?.serves).toBe(3);
    expect(copiedCategory.completesMeal).toBe(true);
  });
});
