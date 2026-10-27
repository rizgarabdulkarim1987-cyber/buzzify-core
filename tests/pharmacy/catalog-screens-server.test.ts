import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as importActions from '@/server/pharmacy/actions/imports';
import * as productActions from '@/server/pharmacy/actions/products';
import { withPlace } from '@/server/pharmacy/place-input';
import * as priceQueries from '@/server/pharmacy/queries/prices';
import * as productQueries from '@/server/pharmacy/queries/products';
import { loadActor, type Actor } from '@/server/studio/auth/actor';
import { runAction, type ActionDef } from '@/server/studio/framework/action';
import { runQuery, type QueryDef } from '@/server/studio/framework/query';
import type { ActionResult } from '@/server/studio/framework/result';
import { describeFailure } from '@/studio/errors';
import { getStudioTranslator } from '@/studio/messages';
import { NOW, person, pharmacy, prisma, resetWorld, useTestDatabase, type Person } from './fixture';

/**
 * What the catalog screens (Task 24) need from the server beyond Tasks 19-23: the product's other fields with their
 * membership checks, the cost shape on search results, an archived barcode holder named as archived, the categories and
 * currencies the editor offers, and the raw headers of an import preview. Also the place helper the Server Actions use.
 */

const META = { ip: '203.0.113.31', userAgent: 'vitest' };
const codeOf = (result: ActionResult<unknown>) => (result.ok ? 'OK' : result.error.code);
const actorOf = async (who: Person): Promise<Actor> => (await loadActor(prisma(), who.userId)) as Actor;
const act = async <I, O>(who: Person, def: ActionDef<I, O>, input: unknown) => runAction(prisma(), await actorOf(who), def, input, META);
const ask = async <I, O>(who: Person, def: QueryDef<I, O>, input: unknown) => runQuery(prisma(), await actorOf(who), def, input);
const dataOf = <T>(result: ActionResult<T>): T => {
  if (!result.ok) throw new Error(`expected OK, got ${result.error.code}: ${result.error.message} ${JSON.stringify(result.error.fields)}`);
  return result.data;
};

const LADDER = [
  { level: 0, label: 'tablet', baseQty: 1, sellable: true },
  { level: 1, label: 'strip', baseQty: 10, sellable: true },
  { level: 2, label: 'box', baseQty: 30, sellable: true },
];

const panadol = (restaurantId: string, over: Record<string, unknown> = {}) => ({
  restaurantId,
  tradeName: 'Panadol',
  strength: '500 mg',
  form: 'tablet',
  manufacturer: 'GSK',
  rxLevel: 'OTC',
  levels: LADDER,
  barcodes: [],
  branchSettings: [],
  ...over,
});

async function asset(restaurantId: string | null) {
  return prisma().mediaAsset.create({
    data: { restaurantId, kind: 'IMAGE', storageKey: `k/${Math.random()}`, contentHash: `${Math.random()}`, mime: 'image/png', bytes: 1, storedBytes: 1 },
    select: { id: true },
  });
}

beforeAll(() => {
  useTestDatabase();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterAll(() => {
  vi.useRealTimers();
});
beforeEach(resetWorld);
afterEach(() => {
  vi.setSystemTime(NOW);
});

describe('the product editor fields beyond identity, pack and barcodes', () => {
  it('saves category, cold storage, storage note, shelf and image, and reads them back', async () => {
    const a = await pharmacy('A');
    const owner = await person('owner', { membership: [a.id, 'OWNER'] });
    const category = await prisma().phCategory.create({ data: { restaurantId: a.id, name: 'Pain', nameKey: 'pain' } });
    const image = await asset(a.id);
    const shared = await asset(null);

    const created = dataOf(
      await act(
        owner,
        productActions.create,
        panadol(a.id, { categoryId: category.id, requiresCold: true, storageNote: 'Keep dry', shelfLocation: 'A3', imageAssetId: image.id }),
      ),
    );
    const read = dataOf(await ask(owner, productQueries.get, { restaurantId: a.id, productId: created.id }));
    expect(read).toMatchObject({ categoryId: category.id, requiresCold: true, storageNote: 'Keep dry', shelfLocation: 'A3', imageAssetId: image.id });

    // An image from the shared library is the business's to use too; clearing the category is allowed.
    dataOf(
      await act(owner, productActions.update, {
        ...panadol(a.id, { categoryId: null, imageAssetId: shared.id, shelfLocation: 'B1' }),
        productId: created.id,
        expectedVersion: created.version,
      }),
    );
    const after = await prisma().phProduct.findUniqueOrThrow({ where: { id: created.id } });
    expect(after).toMatchObject({ categoryId: null, imageAssetId: shared.id, shelfLocation: 'B1', requiresCold: false, storageNote: '' });
  });

  it("refuses another business's category or image and writes nothing", async () => {
    const a = await pharmacy('A');
    const b = await pharmacy('B');
    const owner = await person('owner', { membership: [a.id, 'OWNER'] });
    const theirs = await prisma().phCategory.create({ data: { restaurantId: b.id, name: 'Theirs', nameKey: 'theirs' } });
    const theirImage = await asset(b.id);

    const category = await act(owner, productActions.create, panadol(a.id, { categoryId: theirs.id }));
    expect(category).toMatchObject({ ok: false, error: { code: 'INVALID', fields: { categoryId: 'Choose one of this pharmacy’s categories' } } });
    const image = await act(owner, productActions.create, panadol(a.id, { imageAssetId: theirImage.id }));
    expect(image).toMatchObject({ ok: false, error: { code: 'INVALID', fields: { imageAssetId: 'Choose an image from this pharmacy’s library' } } });
    expect(await prisma().phProduct.count()).toBe(0);
  });

  it('lists the business’s categories for the editor, by name', async () => {
    const a = await pharmacy('A');
    const b = await pharmacy('B');
    const owner = await person('owner', { membership: [a.id, 'OWNER'] });
    await prisma().phCategory.createMany({
      data: [
        { restaurantId: a.id, name: 'Vitamins', nameKey: 'vitamins' },
        { restaurantId: a.id, name: 'Antibiotics', nameKey: 'antibiotics' },
        { restaurantId: b.id, name: 'Other', nameKey: 'other' },
      ],
    });
    const list = dataOf(await ask(owner, productQueries.categories, { restaurantId: a.id }));
    expect(list.map((c) => c.name)).toEqual(['Antibiotics', 'Vitamins']);
  });
});

describe('search results and cost', () => {
  it('carry the cost key for a role with cost.view and never for a cashier', async () => {
    const a = await pharmacy('A');
    const owner = await person('owner', { membership: [a.id, 'OWNER'] });
    const cashier = await person('cashier', { staff: [a.id, 'CASHIER', [a.branchId]] });
    dataOf(await act(owner, productActions.create, panadol(a.id)));

    const mine = dataOf(await ask(owner, productQueries.search, { restaurantId: a.id, q: 'panadol' }));
    expect(mine[0]).toHaveProperty('cost', { lastPurchaseMinor: null, currency: null });
    const theirs = dataOf(await ask(cashier, productQueries.search, { restaurantId: a.id, branchId: a.branchId, q: 'panadol' }));
    expect(theirs).toHaveLength(1);
    expect(theirs[0]).not.toHaveProperty('cost');
    expect(JSON.stringify(theirs)).not.toContain('lastPurchase');
  });
});

describe('a barcode held by an archived product', () => {
  it('names the holder and says it is archived', async () => {
    const a = await pharmacy('A');
    const owner = await person('owner', { membership: [a.id, 'OWNER'] });
    const old = dataOf(await act(owner, productActions.create, panadol(a.id, { tradeName: 'Old', barcodes: [{ code: '0012345678905', level: 2 }] })));
    dataOf(await act(owner, productActions.archive, { restaurantId: a.id, productId: old.id, expectedVersion: old.version }));

    const refused = await act(owner, productActions.create, panadol(a.id, { barcodes: [{ code: '0012345678905', level: 2 }] }));
    expect(refused).toMatchObject({
      ok: false,
      error: { code: 'CONFLICT', fields: { phCode: 'BARCODE_IN_USE', productId: old.id, productName: 'Old', productArchived: 'true' } },
    });
    // A detail, not a field message.
    if (refused.ok) throw new Error('unreachable');
    expect(describeFailure(getStudioTranslator('en'), 'en', refused.error).fields).not.toHaveProperty('productArchived');

    // An active holder is not called archived.
    dataOf(await act(owner, productActions.create, panadol(a.id, { tradeName: 'Live', barcodes: [{ code: '6291234567894', level: 2 }] })));
    const live = await act(owner, productActions.create, panadol(a.id, { tradeName: 'Third', barcodes: [{ code: '6291234567894', level: 2 }] }));
    expect(live.ok ? {} : live.error.fields).not.toHaveProperty('productArchived');
  });
});

describe('the price form', () => {
  it('reads the currencies the pharmacy prices in', async () => {
    const a = await pharmacy('A');
    const owner = await person('owner', { membership: [a.id, 'OWNER'] });
    await prisma().phSettings.upsert({
      where: { restaurantId: a.id },
      create: { restaurantId: a.id, enabledCurrencies: ['IQD', 'USD'] },
      update: { enabledCurrencies: ['IQD', 'USD'] },
    });
    expect(dataOf(await ask(owner, priceQueries.currencies, { restaurantId: a.id }))).toEqual(['IQD', 'USD']);
  });
});

describe('the import preview', () => {
  it('answers with the file’s headers as written, repeats included', async () => {
    const a = await pharmacy('A');
    const owner = await person('owner', { membership: [a.id, 'OWNER'] });
    const csv = Buffer.from('Trade name,Trade name,Rx,Pack,Units per pack\nPanadol,Again,OTC,box,30\n', 'utf8').toString('base64');
    const result = dataOf(await act(owner, importActions.preview, { restaurantId: a.id, fileName: 'list.csv', fileBase64: csv }));
    expect(result.headers).toEqual(['Trade name', 'Trade name', 'Rx', 'Pack', 'Units per pack']);
  });
});

describe('the place the Server Actions fill in', () => {
  it('replaces whatever restaurant and branch the browser sent with the chosen place', () => {
    expect(withPlace({ q: 'x', restaurantId: 'evil', branchId: 'evil-branch' }, { restaurantId: 'mine' })).toEqual({ q: 'x', restaurantId: 'mine' });
    expect(withPlace({ q: 'x' }, { restaurantId: 'mine', branchId: 'b1' })).toEqual({ q: 'x', restaurantId: 'mine', branchId: 'b1' });
    expect(withPlace('not an object', { restaurantId: 'mine' })).toEqual({ restaurantId: 'mine' });
    expect(withPlace(null, { restaurantId: 'mine' })).toEqual({ restaurantId: 'mine' });
  });

  it('a cashier is refused writes whatever the browser sends', async () => {
    const a = await pharmacy('A');
    const cashier = await person('cashier', { staff: [a.id, 'CASHIER', [a.branchId]] });
    expect(codeOf(await act(cashier, productActions.create, withPlace(panadol('evil'), { restaurantId: a.id, branchId: a.branchId })))).toBe('FORBIDDEN');
  });
});
