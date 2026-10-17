import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getPrisma } from '@/server/data/prisma';
import { getTenant } from '@/server/data/public-menu';
import { assetUsage } from '@/server/media/usage';
import { loadDraftSnapshot } from '@/server/publish/draft';
import * as content from '@/server/studio/actions/content';
import * as menus from '@/server/studio/actions/menus';
import * as prices from '@/server/studio/actions/prices';
import { loadActor, type Actor } from '@/server/studio/auth/actor';
import { runAction, type ActionDef } from '@/server/studio/framework/action';
import { runQuery } from '@/server/studio/framework/query';
import type { ActionResult } from '@/server/studio/framework/result';
import * as contentQueries from '@/server/studio/queries/content';
import * as menuQueries from '@/server/studio/queries/menus';
import { databaseUrl, TEST_DB } from '../../scripts/db-config';
import { createMenuFixture, publishFixture, requireTestDb, resetTestData } from '../helpers/db';

const prisma = () => getPrisma();
const META = { ip: '203.0.113.7', userAgent: 'vitest' };

const dataOf = <T>(result: ActionResult<T>): T => {
  if (!result.ok) throw new Error(`expected success, got ${JSON.stringify(result.error)}`);
  return result.data;
};
const failureOf = (result: ActionResult<unknown>) => {
  if (result.ok) throw new Error(`expected a failure, got ${JSON.stringify(result.data)}`);
  return result.error;
};

let a: Awaited<ReturnType<typeof createMenuFixture>>;
let designer: Actor;
let variantId: string;

const run = <I, O>(def: ActionDef<I, O>, input: unknown) => runAction(prisma(), designer, def, input, META);

/** The settings as the tab sends them: the stored ones, with `overrides`. */
async function settings(overrides: Record<string, unknown> = {}) {
  const current = dataOf(await runQuery(prisma(), designer, menuQueries.settings, { menuId: a.menu.id }));
  return {
    menuId: a.menu.id,
    version: current.version,
    name: current.name,
    locales: current.locales,
    defaultLocale: current.defaultLocale,
    currency: current.currency,
    timezone: current.timezone,
    numeralSystem: current.numeralSystem,
    seo: Object.fromEntries(Object.entries(current.seo).map(([locale, entry]) => [locale, { title: entry.title, description: entry.description, ...(entry.imageAssetId ? { imageAssetId: entry.imageAssetId } : {}) }])),
    notes: current.notes,
    priceStep: current.priceStep,
    ...overrides,
  };
}

async function asset(restaurantId: string, hash: string) {
  return prisma().mediaAsset.create({
    data: {
      restaurantId,
      kind: 'IMAGE',
      storageKey: `r/${restaurantId}/${hash}`,
      contentHash: hash,
      mime: 'image/png',
      bytes: 10,
      storedBytes: 10,
      width: 1200,
      height: 630,
      variants: { original: `r/${restaurantId}/${hash}/original.png`, webp: { '1080': `r/${restaurantId}/${hash}/1080.webp` } },
    },
  });
}

beforeAll(() => {
  requireTestDb();
  vi.stubEnv('DATABASE_URL', databaseUrl(TEST_DB));
});

beforeEach(async () => {
  await resetTestData(prisma());
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  a = await createMenuFixture(prisma(), 'settings-a', { publish: false });
  await prisma().product.update({ where: { id: a.product.id }, data: { basePrice: 450, cost: 120, translations: { en: { name: 'Espresso' }, ar: { name: 'إسبريسو' } } } });
  variantId = (await prisma().productVariant.create({ data: { menuId: a.menu.id, productId: a.product.id, priceDelta: 150, isDefault: true, translations: { en: { name: 'Large' } } } })).id;
  await publishFixture(prisma(), a.menu.id);
  await prisma().user.create({ data: { id: 'designer-a', name: 'Alpha Designer', email: 'designer-a@example.com' } });
  await prisma().membership.create({ data: { userId: 'designer-a', restaurantId: a.restaurant.id, role: 'DESIGNER' } });
  designer = (await loadActor(prisma(), 'designer-a')) as Actor;
});

afterAll(async () => {
  await resetTestData(prisma());
});

const menuRow = () => prisma().menu.findUniqueOrThrow({ where: { id: a.menu.id } });

describe('menu settings', () => {
  it('reads the settings with the address, the default step and the version', async () => {
    const current = dataOf(await runQuery(prisma(), designer, menuQueries.settings, { menuId: a.menu.id }));
    expect(current).toMatchObject({ name: 'Menu settings-a', slug: 'settings-a', currency: 'USD', locales: ['en', 'ar', 'ckb'], defaultStep: 5, priceStep: null, version: (await menuRow()).version });
  });

  it('stores the languages in their fixed order', async () => {
    const { version } = await menuRow();
    expect(dataOf(await run(menus.updateSettings, await settings({ locales: ['ckb', 'en'], defaultLocale: 'en' })))).toEqual({ version: version + 1, rescaled: 0 });
    expect((await menuRow()).locales).toEqual(['en', 'ckb']);
  });

  it('refuses a default language outside the languages', async () => {
    expect(failureOf(await run(menus.updateSettings, await settings({ locales: ['en'], defaultLocale: 'ar' })))).toMatchObject({
      code: 'INVALID',
      fields: { defaultLocale: expect.any(String) },
    });
  });

  it('refuses USD to IQD without confirmation, and with it rescales every price', async () => {
    expect(failureOf(await run(menus.updateSettings, await settings({ currency: 'IQD' })))).toMatchObject({ code: 'INVALID', fields: { currency: expect.any(String) } });
    expect((await prisma().product.findUniqueOrThrow({ where: { id: a.product.id } })).basePrice).toBe(450);

    const result = dataOf(await run(menus.updateSettings, await settings({ currency: 'IQD', confirmCurrencyChange: true, priceStep: 100 })));
    expect(result.rescaled).toBe(2);
    expect(await prisma().product.findUniqueOrThrow({ where: { id: a.product.id } })).toMatchObject({ basePrice: 5, cost: 1, version: 2 });
    expect(await prisma().productVariant.findUniqueOrThrow({ where: { id: variantId } })).toMatchObject({ priceDelta: 2, version: 2 });
    expect(await menuRow()).toMatchObject({ currency: 'IQD', priceStep: 1 });
    expect(await prisma().auditLog.findFirstOrThrow({ where: { action: 'menu.settings_changed' } })).toMatchObject({
      entityType: 'Menu',
      changes: { currency: { before: 'USD', after: 'IQD' } },
    });
  });

  it('turns 6,000 IQD into 6,000.00 USD', async () => {
    await prisma().menu.update({ where: { id: a.menu.id }, data: { currency: 'IQD' } });
    await prisma().product.update({ where: { id: a.product.id }, data: { basePrice: 6000 } });
    dataOf(await run(menus.updateSettings, await settings({ currency: 'USD', confirmCurrencyChange: true })));
    expect((await prisma().product.findUniqueOrThrow({ where: { id: a.product.id } })).basePrice).toBe(600_000);
  });

  it('needs no confirmation between currencies with the same decimals', async () => {
    dataOf(await run(menus.updateSettings, await settings({ currency: 'EUR' })));
    expect((await prisma().product.findUniqueOrThrow({ where: { id: a.product.id } })).basePrice).toBe(450);
  });

  it('refuses a product editor opened before the currency change', async () => {
    const product = dataOf(await runQuery(prisma(), designer, contentQueries.product, { menuId: a.menu.id, productId: a.product.id }));
    dataOf(await run(menus.updateSettings, await settings({ currency: 'IQD', confirmCurrencyChange: true })));
    const stale = {
      menuId: a.menu.id,
      productId: product.id,
      version: product.version,
      slug: product.slug,
      categoryId: product.categoryId,
      names: product.names,
      descriptions: product.descriptions,
      price: product.price,
      isSignature: false,
      isFeatured: false,
      allergens: [],
      dietary: [],
      badges: [],
      calories: null,
      media: [],
      variants: [],
      groups: [],
    };
    expect(failureOf(await run(content.saveProduct, stale)).code).toBe('CONFLICT');
  });

  it('names who changed the currency, not who edited the price before it', async () => {
    await prisma().user.create({ data: { id: 'owner-a', name: 'Alpha Owner', email: 'owner-a@example.com' } });
    await prisma().membership.create({ data: { userId: 'owner-a', restaurantId: a.restaurant.id, role: 'OWNER' } });
    const owner = (await loadActor(prisma(), 'owner-a')) as Actor;
    const set = (target: Record<string, unknown>, price: number) => runAction(prisma(), owner, prices.set, { menuId: a.menu.id, target, price }, META);
    const product = dataOf(await set({ kind: 'product', id: a.product.id, version: 1 }, 500));
    const variant = dataOf(await set({ kind: 'variant', id: variantId, version: 1 }, 700));
    dataOf(await run(menus.updateSettings, await settings({ currency: 'IQD', confirmCurrencyChange: true })));

    expect(failureOf(await set({ kind: 'product', id: a.product.id, version: product.version }, 9))).toMatchObject({ code: 'CONFLICT', fields: { changedBy: 'Alpha Designer' } });
    expect(failureOf(await set({ kind: 'variant', id: variantId, version: variant.version }, 9))).toMatchObject({ code: 'CONFLICT', fields: { changedBy: 'Alpha Designer' } });
    expect(await prisma().auditLog.findFirstOrThrow({ where: { action: 'price.changed', actorId: 'designer-a', entityId: variantId } })).toMatchObject({
      entityType: 'ProductVariant',
      changes: { price: { before: 700, after: 7 } },
    });
  });

  it('refuses a stale save of the settings', async () => {
    const stale = await settings();
    dataOf(await run(menus.updateSettings, await settings({ name: 'Supper' })));
    expect(failureOf(await run(menus.updateSettings, { ...stale, name: 'Lunch' }))).toMatchObject({ code: 'CONFLICT', fields: { changedBy: 'Alpha Designer' } });
  });

  it('puts the SEO title and image in the draft, and in the published menu', async () => {
    const image = await asset(a.restaurant.id, 'og');
    const seo = { en: { title: 'Settings A, all day', description: 'Coffee and plates', imageAssetId: image.id } };
    dataOf(await run(menus.updateSettings, await settings({ seo })));
    const draft = await loadDraftSnapshot(prisma(), a.menu.id);
    expect(draft.menu.seo.en).toMatchObject({ title: 'Settings A, all day', description: 'Coffee and plates', image: { assetId: image.id, width: 1200, height: 630 } });
    expect(draft.menu.seo.en!.image!.url).toMatch(/1080\.webp$/);
    expect((await menuRow()).draftHash).not.toBe((await menuRow()).liveHash);

    await publishFixture(prisma(), a.menu.id);
    expect((await getTenant('settings-a'))!.seo.en).toMatchObject({ title: 'Settings A, all day', image: { assetId: image.id } });
    expect((await assetUsage(prisma(), image)).drafts).toEqual([expect.objectContaining({ menuId: a.menu.id, where: 'seo' })]);
  });

  it("refuses another restaurant's image", async () => {
    const b = await createMenuFixture(prisma(), 'settings-b');
    const theirs = await asset(b.restaurant.id, 'theirs');
    expect(failureOf(await run(menus.updateSettings, await settings({ seo: { en: { title: 'x', description: '', imageAssetId: theirs.id } } }))).code).toBe('NOT_FOUND');
  });

  it('keeps the translations of a language that is removed', async () => {
    dataOf(await run(menus.updateSettings, await settings({ locales: ['en'], defaultLocale: 'en' })));
    expect((await prisma().product.findUniqueOrThrow({ where: { id: a.product.id } })).translations).toMatchObject({ ar: { name: 'إسبريسو' } });
  });
});
