import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { scopedClient } from '@/server/data/tenant-db';
import { identityKeyOf, searchTextOf, type ProductSearchInput } from '@/server/domain/pharmacy/product-identity';
import * as priceActions from '@/server/pharmacy/actions/prices';
import * as productActions from '@/server/pharmacy/actions/products';
import * as productQueries from '@/server/pharmacy/queries/products';
import { searchProducts } from '@/server/pharmacy/search';
import { loadActor, type Actor } from '@/server/studio/auth/actor';
import { runAction, type ActionDef } from '@/server/studio/framework/action';
import { runQuery, type QueryDef } from '@/server/studio/framework/query';
import type { ActionResult } from '@/server/studio/framework/result';
import { DAY, grant, NOW, person, pharmacy, prisma, resetWorld, useTestDatabase, type Person } from './fixture';

const META = { ip: '203.0.113.21', userAgent: 'vitest' };

const codeOf = (result: ActionResult<unknown>) => (result.ok ? 'OK' : result.error.code);
const actorOf = async (who: Person): Promise<Actor> => (await loadActor(prisma(), who.userId)) as Actor;
const act = async <I, O>(who: Person, def: ActionDef<I, O>, input: unknown) => runAction(prisma(), await actorOf(who), def, input, META);
const ask = async <I, O>(who: Person, def: QueryDef<I, O>, input: unknown) => runQuery(prisma(), await actorOf(who), def, input);
const dataOf = <T>(result: ActionResult<T>): T => {
  if (!result.ok) throw new Error(`expected OK, got ${result.error.code}: ${result.error.message} ${JSON.stringify(result.error.fields)}`);
  return result.data;
};

const BOX_OF = (n: number) => [
  { level: 0, label: 'tablet', baseQty: 1, sellable: true },
  { level: 1, label: 'box', baseQty: n, sellable: true },
];

interface Biz {
  id: string;
  branchId: string;
  branchIds: string[];
  owner: Person;
}

async function business(name: string, opts: { branches?: number } = {}): Promise<Biz> {
  const b = await pharmacy(name, { branches: opts.branches ?? 1 });
  await prisma().phSettings.create({ data: { restaurantId: b.id, enabledCurrencies: ['IQD'], defaultCurrency: 'IQD' } });
  const owner = await person(`owner-${name.toLowerCase()}`, { membership: [b.id, 'OWNER'] });
  return { ...b, owner };
}

interface ProductSpec {
  tradeName: string;
  genericName?: string;
  activeIngredient?: string;
  strength?: string;
  form?: string;
  manufacturer?: string;
  box?: number;
  barcodes?: { code: string; level: number; shared?: boolean }[];
}

/** A product created through the real action, so everything the service keeps (identity, search text) is filled. */
async function product(b: Biz, spec: ProductSpec): Promise<string> {
  const { box, ...fields } = spec;
  const created = dataOf(
    await act(b.owner, productActions.create, { restaurantId: b.id, form: 'tablet', manufacturer: 'GSK', ...fields, levels: BOX_OF(box ?? 20) }),
  );
  return created.id;
}

/** Many bare products at once (no units, prices or barcodes), with the identity and search text the service would write. */
async function many(b: Biz, count: number, spec: (i: number) => Partial<ProductSearchInput> & { tradeName: string }) {
  const data = Array.from({ length: count }, (_, i) => {
    const fields: ProductSearchInput = { genericName: '', activeIngredient: '', strength: '', form: 'tablet', manufacturer: 'GSK', ...spec(i) };
    return { restaurantId: b.id, ...fields, identityKey: identityKeyOf({ ...fields, packLabel: '' }), searchText: searchTextOf(fields) };
  });
  await prisma().phProduct.createMany({ data });
}

const unitOf = async (productId: string, level: number) => (await prisma().phProductUnit.findFirstOrThrow({ where: { productId, level } })).id;

const scoped = (b: Biz) => scopedClient(prisma(), { restaurantId: b.id, allBranches: true });
const search = (b: Biz, q: string, over: { branchId?: string; limit?: number; includeInactive?: boolean } = {}) =>
  searchProducts(scoped(b), { q, ...over });

beforeAll(() => {
  useTestDatabase();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterAll(() => {
  vi.useRealTimers();
});
beforeEach(resetWorld);

describe('pharmacy product search', () => {
  it('an exact barcode wins over any name match', async () => {
    const a = await business('A');
    // A name that starts with the very digits of the code, created first: it must still come after the barcode hit.
    const named = await product(a, { tradeName: '6291107930015 Syrup', form: 'syrup' });
    const scanned = await product(a, { tradeName: 'Panadol', strength: '500 mg', barcodes: [{ code: '6291107930015', level: 1 }] });

    const results = await search(a, ' 6291107930015 ');
    expect(results.map((r) => [r.productId, r.matchedOn])).toEqual([
      [scanned, 'barcode'],
      [named, 'tradeName'],
    ]);
    expect(results[0]!.unitId).toBe(await unitOf(scanned, 1));
  });

  it('a barcode with leading zeros finds the product and the same digits without zeros do not', async () => {
    const a = await business('A');
    const id = await product(a, { tradeName: 'Brufen', strength: '400 mg', barcodes: [{ code: '0012345678905', level: 0 }] });

    expect((await search(a, '0012345678905')).map((r) => [r.productId, r.matchedOn])).toEqual([[id, 'barcode']]);
    // The same code scanned through an Arabic keyboard layout.
    expect((await search(a, '٠٠١٢٣٤٥٦٧٨٩٠٥')).map((r) => [r.productId, r.matchedOn])).toEqual([[id, 'barcode']]);
    expect(await search(a, '12345678905')).toEqual([]);
  });

  it('an Arabic name finds the product typed in Arabic-Indic digits', async () => {
    const a = await business('A');
    const id = await product(a, { tradeName: 'أموكسيل', activeIngredient: 'أموكسيسيلين', strength: '٥٠٠ ملغ', form: 'كبسول' });
    await product(a, { tradeName: 'أموكسيل', activeIngredient: 'أموكسيسيلين', strength: '250 mg', form: 'كبسول' });

    // Hamza on the alef or not, Arabic-Indic or Latin digits, the unit spelled out or not: the same product.
    for (const q of ['اموكسيل ٥٠٠', 'أموكسيل 500', 'إموكسيل ٥٠٠ ملغم', 'اموكسيل 500mg']) {
      const results = await search(a, q);
      expect(results.map((r) => r.productId), q).toEqual([id]);
      expect(results[0]!.matchedOn, q).toBe('tradeName');
    }
    expect((await search(a, 'أموكسيسيلين')).map((r) => r.matchedOn)).toEqual(['activeIngredient', 'activeIngredient']);
  });

  it('search by active ingredient finds every brand', async () => {
    const a = await business('A');
    const panadol = await product(a, { tradeName: 'Panadol', activeIngredient: 'Paracetamol', strength: '500 mg' });
    const adol = await product(a, { tradeName: 'Adol', activeIngredient: 'paracetamol', strength: '500 mg', manufacturer: 'Julphar' });
    const generic = await product(a, { tradeName: 'Fevadol', genericName: 'Paracetamol', strength: '500 mg', manufacturer: 'Spimaco' });
    await product(a, { tradeName: 'Brufen', activeIngredient: 'Ibuprofen', strength: '400 mg', manufacturer: 'Abbott' });

    const results = await search(a, 'PARACETAMOL');
    expect(new Set(results.map((r) => r.productId))).toEqual(new Set([panadol, adol, generic]));
    expect(results.find((r) => r.productId === panadol)!.matchedOn).toBe('activeIngredient');
    expect(results.find((r) => r.productId === generic)!.matchedOn).toBe('genericName');
    // The generic name ranks before the active ingredient.
    expect(results[0]!.productId).toBe(generic);
  });

  it('a trade name that starts with the query ranks before one that only contains it', async () => {
    const a = await business('A');
    const panadol = await product(a, { tradeName: 'Panadol', strength: '500 mg' });
    const adol = await product(a, { tradeName: 'Adol', strength: '500 mg', manufacturer: 'Julphar' });
    const extra = await product(a, { tradeName: 'Adol Extra', strength: '500 mg', manufacturer: 'Julphar' });

    expect((await search(a, 'adol')).map((r) => r.productId)).toEqual([adol, extra, panadol]);
  });

  it('a trade name that starts with the first word ranks first even behind more than 200 other matches', async () => {
    const a = await business('A');
    // 205 products whose generic name holds both words and whose trade names sort before the target's.
    await many(a, 205, (i) => ({ tradeName: `A${String(i).padStart(3, '0')}`, genericName: 'Zeta', strength: '500 mg' }));
    const target = await product(a, { tradeName: 'Zeta', strength: '500 mg' });
    await product(a, { tradeName: 'Zeta', strength: '250 mg' });

    const results = await search(a, 'zeta ٥٠٠');
    expect(results[0]).toMatchObject({ productId: target, matchedOn: 'tradeName' });
    expect(results).toHaveLength(30);
    expect(results.slice(1).every((r) => r.matchedOn === 'genericName')).toBe(true);
  });

  it('an exact trade name comes before more than 30 longer names that start with it', async () => {
    const a = await business('A');
    // Spelled with alef madda, these sort before the plain alef of the target, and normalise to the same start.
    await many(a, 35, (i) => ({ tradeName: `آبرة ${String(i).padStart(2, '0')}` }));
    const target = await product(a, { tradeName: 'ابرة' });

    const results = await search(a, 'ابرة');
    expect(results[0]).toMatchObject({ productId: target, matchedOn: 'tradeName' });
    expect(results).toHaveLength(30);
  });

  it('after an update the new trade name and ingredient find the product and the old ones do not', async () => {
    const a = await business('A');
    const id = await product(a, { tradeName: 'Panadol', activeIngredient: 'Paracetamol', strength: '500 mg' });
    dataOf(
      await act(a.owner, productActions.update, {
        restaurantId: a.id,
        productId: id,
        expectedVersion: 1,
        tradeName: 'Brufen',
        activeIngredient: 'Ibuprofen',
        strength: '500 mg',
        form: 'tablet',
        manufacturer: 'GSK',
        levels: BOX_OF(20),
      }),
    );
    expect(await search(a, 'panadol')).toEqual([]);
    expect(await search(a, 'paracetamol')).toEqual([]);
    expect((await search(a, 'brufen')).map((r) => [r.productId, r.matchedOn, r.label])).toEqual([[id, 'tradeName', 'Brufen']]);
    expect((await search(a, 'ibuprofen')).map((r) => [r.productId, r.matchedOn])).toEqual([[id, 'activeIngredient']]);
  });

  it('the database refuses a product without its search text', async () => {
    const a = await business('A');
    await expect(prisma().phProduct.create({ data: { restaurantId: a.id, tradeName: 'Bare', identityKey: 'bare' } })).rejects.toThrow(
      /PhProduct_searchText_present|check constraint/i,
    );
    const id = await product(a, { tradeName: 'Panadol', strength: '500 mg' });
    await expect(prisma().phProduct.update({ where: { id }, data: { searchText: '' } })).rejects.toThrow(/PhProduct_searchText_present|check constraint/i);
  });

  it('results show strength, form and pack so 500 mg and 1000 mg are distinguishable', async () => {
    const a = await business('A', { branches: 2 });
    const small = await product(a, { tradeName: 'Panadol', strength: '500 mg', box: 24 });
    const large = await product(a, { tradeName: 'Panadol', strength: '1000 mg', box: 12 });
    const smallBox = await unitOf(small, 1);
    const largeBox = await unitOf(large, 1);
    const price = (productId: string, unitId: string, amount: string, branchId?: string) =>
      act(a.owner, priceActions.set, {
        restaurantId: a.id,
        ...(branchId ? { branchId } : {}),
        productId,
        unitId,
        currency: 'IQD',
        amount,
        validFrom: new Date(NOW.getTime() - DAY),
        reason: 'List',
      });
    dataOf(await price(small, smallBox, '2000'));
    dataOf(await price(large, largeBox, '3500'));
    dataOf(await price(small, smallBox, '2250', a.branchIds[1]));

    const results = await search(a, 'panadol');
    expect(results.map((r) => ({ id: r.productId, label: r.label, strength: r.strength, form: r.form, pack: r.packLabel, price: r.price }))).toEqual([
      { id: large, label: 'Panadol', strength: '1000 mg', form: 'tablet', pack: '12 box', price: { amount: 3500n, currency: 'IQD' } },
      { id: small, label: 'Panadol', strength: '500 mg', form: 'tablet', pack: '24 box', price: { amount: 2000n, currency: 'IQD' } },
    ]);
    expect(results.map((r) => r.unitId)).toEqual([largeBox, smallBox]);

    // In branch 2 its own price wins; in branch 1 the business-wide one stands. No price at all is null.
    const inBranch2 = await search(a, 'panadol', { branchId: a.branchIds[1] });
    expect(inBranch2.map((r) => r.price)).toEqual([
      { amount: 3500n, currency: 'IQD' },
      { amount: 2250n, currency: 'IQD' },
    ]);
    expect((await search(a, 'panadol', { branchId: a.branchIds[0] })).map((r) => r.price?.amount)).toEqual([3500n, 2000n]);
    await product(a, { tradeName: 'Panadol Night', strength: '500 mg' });
    expect((await search(a, 'panadol night'))[0]!.price).toBeNull();
  });

  it("search never returns another business's products or an archived one by default", async () => {
    const a = await business('A');
    const b = await business('B');
    const ours = await product(a, { tradeName: 'Panadol', strength: '500 mg', barcodes: [{ code: '6290000000017', level: 1 }] });
    const old = await product(a, { tradeName: 'Panadol', strength: '250 mg' });
    dataOf(await act(a.owner, productActions.archive, { restaurantId: a.id, productId: old, expectedVersion: 1 }));
    const theirs = await product(b, { tradeName: 'Panadol', strength: '500 mg', barcodes: [{ code: '6290000000017', level: 1 }] });

    expect((await search(a, 'panadol')).map((r) => r.productId)).toEqual([ours]);
    expect((await search(a, '6290000000017')).map((r) => r.productId)).toEqual([ours]);
    expect((await search(b, 'panadol')).map((r) => r.productId)).toEqual([theirs]);
    expect(new Set((await search(a, 'panadol', { includeInactive: true })).map((r) => r.productId))).toEqual(new Set([ours, old]));

    // Through the query: the actor's own business only, whatever they ask for.
    const asked = dataOf(await ask(a.owner, productQueries.search, { restaurantId: a.id, q: 'panadol' }));
    expect(asked.map((r) => r.productId)).toEqual([ours]);
    expect(codeOf(await ask(a.owner, productQueries.search, { restaurantId: b.id, q: 'panadol' }))).toBe('FORBIDDEN');
  });

  it('the search query keeps a person to their branches and audits a support read', async () => {
    const a = await business('A', { branches: 2 });
    await product(a, { tradeName: 'Panadol', strength: '500 mg' });
    const manager = await person('manager', { staff: [a.id, 'BRANCH_MANAGER', [a.branchIds[0]!]] });
    const admin = await person('admin', { superAdmin: true });
    await grant(admin, a.id, { scopes: ['catalog.read'] });

    expect(dataOf(await ask(manager, productQueries.search, { restaurantId: a.id, branchId: a.branchIds[0], q: 'panadol' }))).toHaveLength(1);
    expect(codeOf(await ask(manager, productQueries.search, { restaurantId: a.id, branchId: a.branchIds[1], q: 'panadol' }))).toBe('FORBIDDEN');
    expect(dataOf(await ask(admin, productQueries.search, { restaurantId: a.id, q: 'panadol' }))).toHaveLength(1);
    expect(await prisma().auditLog.count({ where: { action: 'support.read', actorId: admin.userId } })).toBe(1);
  });

  it('an empty query returns an empty list, not the whole catalog', async () => {
    const a = await business('A');
    await product(a, { tradeName: 'Panadol', strength: '500 mg' });
    for (const q of ['', '   ', '\t\n', ' - . , ', 'ـــ']) expect(await search(a, q), JSON.stringify(q)).toEqual([]);
  });

  it('a 120-character query does not throw', async () => {
    const a = await business('A');
    const id = await product(a, { tradeName: 'Panadol', strength: '500 mg' });
    for (const q of ['p'.repeat(120), '٥'.repeat(120), '%_\\'.repeat(40), '1'.repeat(10_000)]) {
      await expect(search(a, q), q.slice(0, 12)).resolves.toEqual([]);
    }
    // A long query of real words is cut, and its words still find the product.
    expect((await search(a, 'panadol '.repeat(15))).map((r) => r.productId)).toEqual([id]);
  });

  it('the limit defaults to 30 and is clamped to 1..100', async () => {
    const a = await business('A');
    for (let i = 0; i < 105; i += 1) await product(a, { tradeName: `Vitamin C ${String(i).padStart(3, '0')}`, strength: '500 mg' });
    expect(await search(a, 'vitamin')).toHaveLength(30);
    expect(await search(a, 'vitamin', { limit: 1000 })).toHaveLength(100);
    expect(await search(a, 'vitamin', { limit: 0 })).toHaveLength(1);
    expect((await search(a, 'vitamin', { limit: 3 })).map((r) => r.label)).toEqual(['Vitamin C 000', 'Vitamin C 001', 'Vitamin C 002']);
  }, 60_000);

  it('a percent sign or underscore in the query is text, not a wildcard', async () => {
    const a = await business('A');
    const cream = await product(a, { tradeName: 'Hydrocortisone', strength: '1%', form: 'cream' });
    await product(a, { tradeName: 'Hydrocortisone', strength: '10 mg', form: 'tablet' });
    expect((await search(a, 'hydrocortisone 1%')).map((r) => r.productId)).toEqual([cream]);
    expect(await search(a, '%')).toHaveLength(1);
  });
});
