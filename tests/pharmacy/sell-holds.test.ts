import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as saleActions from '@/server/pharmacy/actions/sales';
import * as saleQueries from '@/server/pharmacy/queries/sales';
import * as sellQueries from '@/server/pharmacy/queries/sell';
import { searchTextOf } from '@/server/domain/pharmacy/product-identity';
import { NOW, person, pharmacy, prisma, resetWorld, useTestDatabase, type Person } from './fixture';
import { act, ask, balanceOf, codeOf, dataOf, makeBatch, makeProduct, phCodeOf } from './stock-helpers';

/**
 * The sale screen's two supports (phase 3, task 3b): `ph.sell.search` (what the cashier sees after a scan or a word) and
 * the holds (`ph.sales.hold/resume/discardHold/holds`, and completing one through `ph.sales.create` with `fromHoldId`).
 */

interface World {
  a: { id: string; branchId: string; branchIds: string[] };
  b1: string;
  b2: string;
  owner: Person;
  cashier: Person;
  cashier2: Person;
  pharmacist: Person;
  manager: Person;
  stockClerk: Person;
  accountant: Person;
  p: { id: string; tablet: string; strip: string };
}

const HOUR = 3_600_000;
let seq = 0;
const key = (label: string) => `${label}-${(seq += 1)}-${'x'.repeat(8)}`;

async function price(restaurantId: string, p: { id: string; tablet: string; strip: string }, branchId: string | null, currency: 'IQD' | 'USD', tablet: bigint, strip: bigint) {
  for (const [unitId, amountMinor] of [[p.tablet, tablet], [p.strip, strip]] as const) {
    await prisma().phPrice.create({ data: { restaurantId, productId: p.id, unitId, branchId, currency, amountMinor, validFrom: new Date('2026-01-01T00:00:00.000Z'), changedById: 'seed' } });
  }
}
const openShift = (restaurantId: string, branchId: string, who: Person, currency: 'IQD' | 'USD' = 'IQD') =>
  prisma().phShift.create({ data: { restaurantId, branchId, userId: who.userId, currency, openingFloatMinor: 0n }, select: { id: true } });

async function world(): Promise<World> {
  const a = await pharmacy('A', { branches: 2 });
  const [b1, b2] = a.branchIds as [string, string];
  const owner = await person('owner', { membership: [a.id, 'OWNER'] });
  const cashier = await person('cashier', { staff: [a.id, 'CASHIER', [b1]] });
  const cashier2 = await person('cashier2', { staff: [a.id, 'CASHIER', [b1]] });
  const pharmacist = await person('pharmacist', { staff: [a.id, 'PHARMACIST', [b1]] });
  const manager = await person('manager', { staff: [a.id, 'BRANCH_MANAGER', [b1]] });
  const stockClerk = await person('stockClerk', { staff: [a.id, 'STOCK', [b1]] });
  const accountant = await person('accountant', { staff: [a.id, 'ACCOUNTANT', [b1]] });
  await prisma().phSettings.create({ data: { restaurantId: a.id } });
  const p = await makeProduct(a.id, 'Panadol');
  await price(a.id, p, null, 'IQD', 100n, 900n);
  for (const who of [owner, cashier, cashier2, pharmacist, manager]) await openShift(a.id, b1, who);
  await openShift(a.id, b2, owner);
  return { a, b1, b2, owner, cashier, cashier2, pharmacist, manager, stockClerk, accountant, p };
}

const stock = (w: World, over: { lot?: string; expiry?: string; status?: 'ACTIVE' | 'RECALLED' | 'BLOCKED'; buckets?: Record<string, number>; branchId?: string; productId?: string; cost?: { unitCostMinor: bigint; costUnitId: string } } = {}) =>
  makeBatch(w.a.id, over.branchId ?? w.b1, over.productId ?? w.p.id, {
    lot: over.lot ?? 'L1',
    expiry: over.expiry ?? '2028-03-31',
    status: over.status ?? 'ACTIVE',
    buckets: over.buckets ?? { available: 100 },
    ...(over.cost ? { cost: over.cost } : {}),
  });

const cash = (amountMinor: bigint) => ({ method: 'CASH', amountMinor, clientKey: key('pay') });
const cart = (w: World, over: Record<string, unknown> = {}) => ({
  restaurantId: w.a.id,
  branchId: w.b1,
  clientKey: key('hold'),
  currency: 'IQD',
  lines: [{ productId: w.p.id, unitId: w.p.tablet, qty: 2 }],
  ...over,
});
const sale = (w: World, over: Record<string, unknown> = {}) => ({ ...cart(w, { clientKey: key('sale') }), payments: [cash(200n)], ...over });
const search = (w: World, who: Person, over: Record<string, unknown> = {}) => ask(who, sellQueries.search, { restaurantId: w.a.id, branchId: w.b1, q: 'Panadol', ...over });

async function product(w: World, tradeName: string, extra: { rxLevel?: 'OTC' | 'RX' | 'RESTRICTED'; strength?: string; form?: string; barcode?: string; priced?: boolean } = {}) {
  const made = await makeProduct(w.a.id, tradeName);
  await prisma().phProduct.update({
    where: { id: made.id },
    data: {
      rxLevel: extra.rxLevel ?? 'OTC',
      strength: extra.strength ?? '',
      form: extra.form ?? '',
      searchText: searchTextOf({ tradeName, genericName: '', activeIngredient: '', strength: extra.strength ?? '', form: extra.form ?? '', manufacturer: '' }),
    },
  });
  if (extra.barcode) await prisma().phBarcode.create({ data: { restaurantId: w.a.id, productId: made.id, unitId: made.strip, code: extra.barcode } });
  if (extra.priced !== false) await price(w.a.id, made, null, 'IQD', 100n, 900n);
  return made;
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

describe('ph.sell.search', () => {
  it('puts an exact barcode first and keeps its leading zeros', async () => {
    const w = await world();
    const zeros = await product(w, 'Zeros', { barcode: '0012345678905' });
    await product(w, 'Plain', { barcode: '12345678905' });
    await stock(w, { productId: zeros.id });
    const found = dataOf(await search(w, w.cashier, { q: '0012345678905' }));
    expect(found.items[0]).toMatchObject({ productId: zeros.id, matchedUnitId: zeros.strip, tradeName: 'Zeros' });
    expect(found.items.map((i: { tradeName: string }) => i.tradeName)).not.toContain('Plain');
    const other = dataOf(await search(w, w.cashier, { q: '12345678905' }));
    expect(other.items[0].tradeName).toBe('Plain');
  });

  it('returns names, strength, form, pack, rx level, units with their open price and the sellable total', async () => {
    const w = await world();
    const x = await product(w, 'Augmentin', { strength: '1 g', form: 'tablet', rxLevel: 'RX' });
    await stock(w, { productId: x.id, buckets: { available: 25 } });
    const found = dataOf(await search(w, w.cashier, { q: 'augmentin' }));
    expect(found.items).toHaveLength(1);
    const item = found.items[0];
    expect(item).toMatchObject({ productId: x.id, tradeName: 'Augmentin', strength: '1 g', form: 'tablet', rxLevel: 'RX', sellableQty: 25, notSellable: false, noPrice: false });
    expect(typeof item.packLabel).toBe('string');
    expect(item.units.map((u: { id: string; priceMinor: string | null; noPrice: boolean; currency: string }) => [u.id, u.priceMinor, u.noPrice, u.currency])).toEqual([
      [x.tablet, '100', false, 'IQD'],
      [x.strip, '900', false, 'IQD'],
    ]);
  });

  it('flags a product with no price in the sale currency and reads USD when asked', async () => {
    const w = await world();
    const unpriced = await product(w, 'Panadex', { priced: false });
    await stock(w, { productId: unpriced.id });
    const iqd = dataOf(await search(w, w.cashier, { q: 'panadex' }));
    expect(iqd.items[0]).toMatchObject({ noPrice: true });
    expect(iqd.items[0].units.every((u: { noPrice: boolean; priceMinor: string | null }) => u.noPrice && u.priceMinor === null)).toBe(true);
    await price(w.a.id, w.p, null, 'USD', 5n, 45n);
    const usd = dataOf(await search(w, w.cashier, { q: 'panadol', currency: 'USD' }));
    expect(usd.items[0].units.map((u: { priceMinor: string | null; currency: string }) => [u.priceMinor, u.currency])).toEqual([['5', 'USD'], ['45', 'USD']]);
    const defaulted = dataOf(await search(w, w.cashier, { q: 'panadol' }));
    expect(defaulted.items[0].units.map((u: { currency: string }) => u.currency)).toEqual(['IQD', 'IQD']);
  });

  it('shows a RESTRICTED product but flags it as not sellable', async () => {
    const w = await world();
    const r = await product(w, 'Morphex', { rxLevel: 'RESTRICTED' });
    await stock(w, { productId: r.id });
    const found = dataOf(await search(w, w.cashier, { q: 'morphex' }));
    expect(found.items[0]).toMatchObject({ rxLevel: 'RESTRICTED', notSellable: true });
  });

  it('counts the sellable total once: ACTIVE, not expired, available only (equals an independent query)', async () => {
    const w = await world();
    await stock(w, { lot: 'A', buckets: { available: 30, reserved: 4, quarantine: 3, damaged: 2 } });
    await stock(w, { lot: 'B', expiry: '2026-10-01', buckets: { available: 10 } });
    await stock(w, { lot: 'C', status: 'RECALLED', buckets: { available: 5 } });
    await stock(w, { lot: 'D', status: 'BLOCKED', buckets: { available: 6 } });
    await stock(w, { lot: 'E', expiry: '2026-10-27', buckets: { available: 7 } });
    await stock(w, { lot: 'F', branchId: w.b2, buckets: { available: 50 } });
    // eslint-disable-next-line no-restricted-properties -- the independent check of the sellable total: plain SQL on the test database
    const rows = await prisma().$queryRaw<{ total: bigint }[]>`
      SELECT COALESCE(SUM(s."available"), 0) AS total FROM "PhStockBalance" s JOIN "PhBatch" b ON b."id" = s."batchId"
      WHERE s."branchId" = ${w.b1} AND s."productId" = ${w.p.id} AND b."status" = 'ACTIVE' AND b."expiryDate" >= ${new Date('2026-10-27T00:00:00.000Z')}`;
    const independent = Number(rows[0]!.total);
    expect(independent).toBe(37);
    const found = dataOf(await search(w, w.cashier));
    expect(found.items[0].sellableQty).toBe(independent);
    expect(found.items[0].batches.map((b: { lot: string }) => b.lot)).toEqual(['E', 'A']);
  });

  it('lists the five nearest-expiry batches in FEFO order with lot, expiry and available', async () => {
    const w = await world();
    const expiries = ['2029-01-31', '2027-05-31', '2028-02-29', '2027-01-31', '2030-06-30', '2028-11-30', '2027-09-30'];
    for (const [i, expiry] of expiries.entries()) await stock(w, { lot: `L${i}`, expiry, buckets: { available: 10 + i } });
    const item = dataOf(await search(w, w.cashier)).items[0];
    expect(item.batches).toHaveLength(5);
    expect(item.batches.map((b: { expiryDate: string }) => b.expiryDate)).toEqual(['2027-01-31', '2027-05-31', '2027-09-30', '2028-02-29', '2028-11-30']);
    expect(item.batches[0]).toMatchObject({ lot: 'L3', available: 13 });
    expect(typeof item.batches[0].batchId).toBe('string');
    expect(item.sellableQty).toBe(10 + 11 + 12 + 13 + 14 + 15 + 16);
  });

  it('never carries a cost field or value', async () => {
    const w = await world();
    await stock(w, { cost: { unitCostMinor: 7_654_321n, costUnitId: w.p.strip } });
    for (const who of [w.cashier, w.owner, w.accountant]) {
      const text = JSON.stringify(dataOf(await search(w, who)));
      expect(text).not.toMatch(/cost/i);
      expect(text).not.toContain('7654321');
    }
  });

  it('shows the actor’s branch only and takes the branch from the place', async () => {
    const w = await world();
    await stock(w, { branchId: w.b2, buckets: { available: 40 } });
    const here = dataOf(await search(w, w.cashier));
    expect(here.items[0]).toMatchObject({ sellableQty: 0 });
    expect(here.items[0].batches).toEqual([]);
    expect(codeOf(await search(w, w.cashier, { branchId: w.b2 }))).toBe('FORBIDDEN');
    const owner2 = dataOf(await search(w, w.owner, { branchId: w.b2 }));
    expect(owner2.items[0].sellableQty).toBe(40);
    expect(codeOf(await ask(w.cashier, sellQueries.search, { restaurantId: w.a.id, q: 'panadol' }))).toBe('INVALID');
  });

  it('does not see another business’s products', async () => {
    const w = await world();
    const b = await pharmacy('B', { branches: 1 });
    await makeProduct(b.id, 'Panadolb');
    const found = dataOf(await search(w, w.cashier, { q: 'panadolb' }));
    expect(found.items).toEqual([]);
  });

  it('honours the limit (at most 30) and refuses a larger one', async () => {
    const w = await world();
    for (let i = 0; i < 33; i += 1) await product(w, `Brand${String(i).padStart(2, '0')}`);
    expect(dataOf(await search(w, w.cashier, { q: 'brand' })).items).toHaveLength(30);
    expect(dataOf(await search(w, w.cashier, { q: 'brand', limit: 3 })).items).toHaveLength(3);
    expect(codeOf(await search(w, w.cashier, { q: 'brand', limit: 31 }))).toBe('INVALID');
    expect(codeOf(await search(w, w.cashier, { q: 'brand', limit: 0 }))).toBe('INVALID');
  });

  it('answers an empty query with nothing, and refuses a role that neither sells nor reports', async () => {
    const w = await world();
    expect(dataOf(await search(w, w.cashier, { q: '   ' })).items).toEqual([]);
    expect(codeOf(await search(w, w.stockClerk))).toBe('FORBIDDEN');
    expect(codeOf(await search(w, w.accountant))).toBe('OK');
    expect(codeOf(await search(w, w.pharmacist))).toBe('OK');
  });
});

describe('holding a cart', () => {
  it('stores a HELD sale with its lines, for 24 hours, and touches no stock, shift cash, number or payment', async () => {
    const w = await world();
    const batch = await stock(w);
    const before = await prisma().phStockMovement.count();
    const held = dataOf(await act(w.cashier, saleActions.hold, cart(w, { lines: [{ productId: w.p.id, unitId: w.p.strip, qty: 2 }, { productId: w.p.id, unitId: w.p.tablet, qty: 3 }], note: 'for Ali' })));
    expect(held).toMatchObject({ status: 'HELD', number: null, branchId: w.b1, currency: 'IQD', lineCount: 2, totalMinor: '2100', replayed: false });
    expect(held.heldUntil).toBe(new Date(NOW.getTime() + 24 * HOUR).toISOString());
    const row = await prisma().phSale.findUniqueOrThrow({ where: { id: held.id }, include: { lines: { orderBy: { lineNo: 'asc' } } } });
    expect(row).toMatchObject({ status: 'HELD', number: null, soldById: w.cashier.userId, completedAt: null, paidMinor: 0n, changeMinor: 0n, totalMinor: 2100n, note: 'for Ali' });
    expect(row.heldUntil).toEqual(new Date(NOW.getTime() + 24 * HOUR));
    expect(row.lines.map((l) => [l.qty, l.baseQty, l.unitPriceMinor, l.totalMinor])).toEqual([[2, 20, 900n, 1800n], [3, 3, 100n, 300n]]);
    expect(await prisma().phStockMovement.count()).toBe(before);
    expect((await balanceOf(batch, w.b1))?.available).toBe(100);
    expect(await prisma().phSaleLineAllocation.count()).toBe(0);
    expect(await prisma().phPayment.count()).toBe(0);
    expect(await prisma().phCashMovement.count()).toBe(0);
    const audit = await prisma().auditLog.findFirstOrThrow({ where: { action: 'ph.sale.hold' } });
    expect(JSON.stringify(audit.changes)).not.toMatch(/for Ali/);
  });

  it('needs an open shift in the branch and a priced, sellable product', async () => {
    const w = await world();
    await stock(w);
    const noShift = await person('noShift', { staff: [w.a.id, 'CASHIER', [w.b1]] });
    expect(phCodeOf(await act(noShift, saleActions.hold, cart(w)))).toBe('NO_OPEN_SHIFT');
    const unpriced = await product(w, 'Free', { priced: false });
    expect(phCodeOf(await act(w.cashier, saleActions.hold, cart(w, { lines: [{ productId: unpriced.id, unitId: unpriced.tablet, qty: 1 }] })))).toBe('NO_PRICE');
    const r = await product(w, 'Morphex', { rxLevel: 'RESTRICTED' });
    expect(phCodeOf(await act(w.cashier, saleActions.hold, cart(w, { lines: [{ productId: r.id, unitId: r.tablet, qty: 1 }] })))).toBe('RESTRICTED_NOT_AVAILABLE');
    expect(phCodeOf(await act(w.cashier, saleActions.hold, cart(w, { currency: 'USD' })))).toBe('SHIFT_CURRENCY');
    expect(codeOf(await act(w.stockClerk, saleActions.hold, cart(w)))).toBe('FORBIDDEN');
    expect(await prisma().phSale.count()).toBe(0);
  });

  it('is idempotent by key and refuses the same key for another cart, user or branch', async () => {
    const w = await world();
    await stock(w);
    const input = cart(w);
    const one = dataOf(await act(w.cashier, saleActions.hold, input));
    const two = dataOf(await act(w.cashier, saleActions.hold, input));
    expect(two).toMatchObject({ id: one.id, replayed: true, heldUntil: one.heldUntil });
    expect(await prisma().phSale.count()).toBe(1);
    const changed = cart(w, { clientKey: input.clientKey, lines: [{ productId: w.p.id, unitId: w.p.tablet, qty: 3 }] });
    expect(phCodeOf(await act(w.cashier, saleActions.hold, changed))).toBe('CLIENT_KEY_MISMATCH');
    expect(phCodeOf(await act(w.cashier2, saleActions.hold, input))).toBe('CLIENT_KEY_MISMATCH');
    expect(phCodeOf(await act(w.cashier, saleActions.create, sale(w, { clientKey: input.clientKey })))).not.toBe('OK');
    expect(await prisma().phSale.count()).toBe(1);
  });

  it('survives parallel sends of one key', async () => {
    const w = await world();
    const input = cart(w);
    const results = await Promise.all([1, 2, 3, 4].map(() => act(w.cashier, saleActions.hold, input)));
    expect(results.every((r) => r.ok)).toBe(true);
    expect(new Set(results.map((r) => (r.ok ? r.data.id : ''))).size).toBe(1);
    expect(await prisma().phSale.count()).toBe(1);
  });
});

describe('ph.sell.search by product ids', () => {
  it('returns exactly the named active products of the caller’s business with units and prices, whatever the name search would rank first', async () => {
    const w = await world();
    await stock(w);
    for (let n = 0; n < 40; n += 1) await product(w, `Panadol Extra ${String(n).padStart(2, '0')}`);
    const late = await product(w, 'Panadol Zzz Last');
    await stock(w, { productId: late.id, lot: 'Z1' });
    const byName = dataOf(await search(w, w.cashier, { q: 'Panadol' }));
    expect(byName.items.map((i: { productId: string }) => i.productId)).not.toContain(late.id);
    const found = dataOf(await ask(w.cashier, sellQueries.search, { restaurantId: w.a.id, branchId: w.b1, q: '', productIds: [late.id, w.p.id] }));
    expect(found.items.map((i: { productId: string }) => i.productId).sort()).toEqual([late.id, w.p.id].sort());
    expect(found.items.find((i: { productId: string }) => i.productId === late.id)).toMatchObject({ tradeName: 'Panadol Zzz Last', sellableQty: 100, noPrice: false });
    expect(found.items[0].units.length).toBeGreaterThan(0);
  });

  it('never returns another business’s product, an archived product, or more than 30 ids', async () => {
    const w = await world();
    const b = await pharmacy('B', { branches: 1 });
    const foreign = await makeProduct(b.id, 'Foreign');
    const archived = await product(w, 'Archived');
    await prisma().phProduct.update({ where: { id: archived.id }, data: { active: false } });
    const found = dataOf(await ask(w.cashier, sellQueries.search, { restaurantId: w.a.id, branchId: w.b1, q: '', productIds: [foreign.id, archived.id, 'nope'] }));
    expect(found.items).toEqual([]);
    const many = await ask(w.cashier, sellQueries.search, { restaurantId: w.a.id, branchId: w.b1, q: '', productIds: Array.from({ length: 31 }, (_, i) => `p${i}`) });
    expect(codeOf(many)).toBe('INVALID');
  });
});

describe('resuming and discarding', () => {
  it('returns the cart for the screen to edit, to any seller of the branch, and leaves the hold in place', async () => {
    const w = await world();
    await stock(w);
    const held = dataOf(
      await act(w.cashier, saleActions.hold, cart(w, { note: 'n', invoiceDiscount: { kind: 'percent', value: 2, reason: 'promo' }, lines: [{ productId: w.p.id, unitId: w.p.strip, qty: 2, discount: { kind: 'amount', value: 100n, reason: 'loyal customer' } }, { productId: w.p.id, unitId: w.p.tablet, qty: 1 }] })),
    );
    const got = dataOf(await act(w.cashier2, saleActions.resume, { restaurantId: w.a.id, branchId: w.b1, saleId: held.id }));
    expect(got).toMatchObject({ saleId: held.id, currency: 'IQD', note: 'n', heldUntil: held.heldUntil, heldById: w.cashier.userId });
    expect(got.invoiceDiscount).toMatchObject({ kind: 'percent', value: 2 });
    expect(got.lines).toHaveLength(2);
    expect(got.lines[0]).toMatchObject({ productId: w.p.id, unitId: w.p.strip, qty: 2 });
    expect(got.lines[0].discount).toMatchObject({ kind: 'amount', value: '100' });
    expect(got.lines[1].discount).toBeUndefined();
    expect(got.lines[0].tradeName).toBe('Panadol');
    expect((await prisma().phSale.findUniqueOrThrow({ where: { id: held.id } })).status).toBe('HELD');
    // The cart goes back into create unchanged.
    const complete = dataOf(await act(w.manager, saleActions.create, { restaurantId: w.a.id, branchId: w.b1, clientKey: key('sale'), currency: got.currency, lines: got.lines.map((l: Record<string, unknown>) => ({ productId: l.productId, unitId: l.unitId, qty: l.qty, ...(l.discount ? { discount: l.discount } : {}) })), invoiceDiscount: got.invoiceDiscount, payments: [cash(5000n)], fromHoldId: held.id }));
    expect(complete.status).toBe('COMPLETED');
  });

  it('returns the held products as sell items (units with CURRENT open prices, stock, batches) so the screen needs no search by name', async () => {
    const w = await world();
    await stock(w);
    const gone = await product(w, 'Goneprod');
    const unpriced = await product(w, 'Unpricedprod');
    await stock(w, { productId: gone.id, lot: 'G1' });
    await stock(w, { productId: unpriced.id, lot: 'U1' });
    const held = dataOf(
      await act(w.cashier, saleActions.hold, cart(w, { lines: [{ productId: w.p.id, unitId: w.p.strip, qty: 2 }, { productId: gone.id, unitId: gone.strip, qty: 1 }, { productId: unpriced.id, unitId: unpriced.tablet, qty: 1 }] })),
    );
    // After the hold: a new open price for Panadol, one product archived, one product loses its price.
    await prisma().phPrice.updateMany({ where: { productId: w.p.id, unitId: w.p.strip }, data: { validTo: new Date(NOW.getTime() - 1000) } });
    await prisma().phPrice.create({ data: { restaurantId: w.a.id, productId: w.p.id, unitId: w.p.strip, branchId: null, currency: 'IQD', amountMinor: 950n, validFrom: new Date(NOW.getTime() - 500), changedById: 'seed' } });
    await prisma().phProduct.update({ where: { id: gone.id }, data: { active: false } });
    await prisma().phPrice.updateMany({ where: { productId: unpriced.id }, data: { validTo: new Date(NOW.getTime() - 1000) } });
    const got = dataOf(await act(w.cashier2, saleActions.resume, { restaurantId: w.a.id, branchId: w.b1, saleId: held.id }));
    expect(got.lines.map((l: { tradeName: string }) => l.tradeName)).toEqual(['Panadol', 'Goneprod', 'Unpricedprod']);
    const byId = new Map<string, { tradeName: string; sellableQty: number; noPrice: boolean; units: { id: string; label: string; baseQty: number; priceMinor: string | null }[]; batches: { lot: string }[] }>(
      got.items.map((i: { productId: string }) => [i.productId, i]),
    );
    const panadol = byId.get(w.p.id)!;
    expect(panadol.units.find((u) => u.id === w.p.strip)).toMatchObject({ priceMinor: '950' });
    expect(panadol.units.find((u) => u.id === w.p.tablet)).toMatchObject({ baseQty: 1, priceMinor: '100' });
    expect(panadol.sellableQty).toBe(100);
    expect(panadol.batches).toHaveLength(1);
    expect(byId.has(gone.id), 'an archived product is not offered').toBe(false);
    expect(byId.get(unpriced.id)).toMatchObject({ noPrice: true });
    expect(byId.get(unpriced.id)!.units.every((u) => u.priceMinor === null)).toBe(true);
    // No cost field anywhere in the answer.
    expect(JSON.stringify(got)).not.toMatch(/cost/i);
  });

  it('refuses an expired hold with HOLD_EXPIRED and marks it expired', async () => {
    const w = await world();
    const held = dataOf(await act(w.cashier, saleActions.hold, cart(w)));
    vi.setSystemTime(new Date(NOW.getTime() + 24 * HOUR));
    expect(phCodeOf(await act(w.cashier, saleActions.resume, { restaurantId: w.a.id, branchId: w.b1, saleId: held.id }))).toBe('HOLD_EXPIRED');
    expect((await prisma().phSale.findUniqueOrThrow({ where: { id: held.id } })).status).toBe('HOLD_EXPIRED');
    expect(phCodeOf(await act(w.cashier, saleActions.resume, { restaurantId: w.a.id, branchId: w.b1, saleId: held.id }))).toBe('HOLD_EXPIRED');
  });

  it('refuses a sale that is not a hold, another branch’s hold, another business’s hold and a missing id', async () => {
    const w = await world();
    await stock(w);
    const done = dataOf(await act(w.cashier, saleActions.create, sale(w)));
    expect(codeOf(await act(w.cashier, saleActions.resume, { restaurantId: w.a.id, branchId: w.b1, saleId: done.id }))).not.toBe('OK');
    expect(codeOf(await act(w.cashier, saleActions.discardHold, { restaurantId: w.a.id, branchId: w.b1, saleId: done.id }))).not.toBe('OK');
    expect((await prisma().phSale.findUniqueOrThrow({ where: { id: done.id } })).status).toBe('COMPLETED');
    const elsewhere = dataOf(await act(w.owner, saleActions.hold, cart(w, { branchId: w.b2 })));
    expect(codeOf(await act(w.manager, saleActions.resume, { restaurantId: w.a.id, branchId: w.b1, saleId: elsewhere.id }))).toBe('NOT_FOUND');
    expect(codeOf(await act(w.manager, saleActions.discardHold, { restaurantId: w.a.id, branchId: w.b1, saleId: elsewhere.id }))).toBe('NOT_FOUND');
    expect(codeOf(await act(w.manager, saleActions.resume, { restaurantId: w.a.id, branchId: w.b2, saleId: elsewhere.id }))).toBe('FORBIDDEN');
    const b = await pharmacy('B', { branches: 1 });
    const ownerB = await person('ownerB', { membership: [b.id, 'OWNER'] });
    expect(codeOf(await act(ownerB, saleActions.resume, { restaurantId: b.id, branchId: b.branchId, saleId: elsewhere.id }))).toBe('NOT_FOUND');
    expect(codeOf(await act(w.cashier, saleActions.resume, { restaurantId: w.a.id, branchId: w.b1, saleId: 'nope' }))).toBe('NOT_FOUND');
    expect(await prisma().phSale.count({ where: { id: elsewhere.id } })).toBe(1);
  });

  it('discards a hold: the sale and its lines are gone, a repeat is refused, a role without shift.use cannot', async () => {
    const w = await world();
    const held = dataOf(await act(w.cashier, saleActions.hold, cart(w)));
    expect(codeOf(await act(w.stockClerk, saleActions.discardHold, { restaurantId: w.a.id, branchId: w.b1, saleId: held.id }))).toBe('FORBIDDEN');
    expect(await prisma().phSale.count()).toBe(1);
    const gone = dataOf(await act(w.cashier2, saleActions.discardHold, { restaurantId: w.a.id, branchId: w.b1, saleId: held.id }));
    expect(gone).toMatchObject({ saleId: held.id, discarded: true });
    expect(await prisma().phSale.count()).toBe(0);
    expect(await prisma().phSaleLine.count()).toBe(0);
    expect(codeOf(await act(w.cashier, saleActions.discardHold, { restaurantId: w.a.id, branchId: w.b1, saleId: held.id }))).toBe('NOT_FOUND');
    const audit = await prisma().auditLog.findFirstOrThrow({ where: { action: 'ph.sale.hold.discard' } });
    expect(audit.entityId).toBe(held.id);
  });
});

describe('listing holds', () => {
  it('lists the branch’s live holds with line count, total preview and who held, and leaves out expired, completed and other branches', async () => {
    const w = await world();
    await stock(w);
    const one = dataOf(await act(w.cashier, saleActions.hold, cart(w)));
    vi.setSystemTime(new Date(NOW.getTime() + 2 * HOUR));
    const two = dataOf(await act(w.cashier2, saleActions.hold, cart(w, { lines: [{ productId: w.p.id, unitId: w.p.strip, qty: 1 }, { productId: w.p.id, unitId: w.p.tablet, qty: 1 }] })));
    await act(w.owner, saleActions.hold, cart(w, { branchId: w.b2 }));
    dataOf(await act(w.cashier, saleActions.create, sale(w)));
    const list = dataOf(await ask(w.manager, saleQueries.holds, { restaurantId: w.a.id, branchId: w.b1 }));
    expect(list.items.map((h: { id: string }) => h.id)).toEqual([two.id, one.id]);
    expect(list.items[0]).toMatchObject({ lineCount: 2, totalPreviewMinor: '1000', currency: 'IQD', heldById: w.cashier2.userId });
    expect(list.items[1]).toMatchObject({ lineCount: 1, totalPreviewMinor: '200', heldById: w.cashier.userId });
    vi.setSystemTime(new Date(NOW.getTime() + 24 * HOUR + 1000));
    const later = dataOf(await ask(w.manager, saleQueries.holds, { restaurantId: w.a.id, branchId: w.b1 }));
    expect(later.items.map((h: { id: string }) => h.id)).toEqual([two.id]);
    expect(codeOf(await ask(w.stockClerk, saleQueries.holds, { restaurantId: w.a.id, branchId: w.b1 }))).toBe('FORBIDDEN');
    expect(codeOf(await ask(w.manager, saleQueries.holds, { restaurantId: w.a.id, branchId: w.b2 }))).toBe('FORBIDDEN');
  });

  it('marks expired holds lazily when a new hold is made', async () => {
    const w = await world();
    const old = dataOf(await act(w.cashier, saleActions.hold, cart(w)));
    vi.setSystemTime(new Date(NOW.getTime() + 25 * HOUR));
    dataOf(await act(w.cashier, saleActions.hold, cart(w)));
    expect((await prisma().phSale.findUniqueOrThrow({ where: { id: old.id } })).status).toBe('HOLD_EXPIRED');
  });
});

describe('completing a hold', () => {
  it('sells through ph.sales.create with fromHoldId: the hold is consumed, the cash goes into the completer’s own shift, the price is the one at sale time', async () => {
    const w = await world();
    const batch = await stock(w);
    const held = dataOf(await act(w.cashier, saleActions.hold, cart(w)));
    expect(held.totalMinor).toBe('200');
    await prisma().phPrice.updateMany({ where: { productId: w.p.id, unitId: w.p.tablet }, data: { amountMinor: 150n } });
    const done = dataOf(await act(w.manager, saleActions.create, sale(w, { fromHoldId: held.id, payments: [cash(500n)] })));
    expect(done).toMatchObject({ status: 'COMPLETED', totalMinor: '300', changeMinor: '200', replayed: false });
    expect(await prisma().phSale.count({ where: { id: held.id } })).toBe(0);
    expect(await prisma().phSale.count()).toBe(1);
    expect((await balanceOf(batch, w.b1))?.available).toBe(98);
    const completer = await prisma().phShift.findFirstOrThrow({ where: { userId: w.manager.userId, branchId: w.b1 } });
    const holder = await prisma().phShift.findFirstOrThrow({ where: { userId: w.cashier.userId, branchId: w.b1 } });
    expect((await prisma().phCashMovement.findMany({ where: { shiftId: completer.id } })).map((c) => [c.type, c.amountMinor])).toEqual(expect.arrayContaining([['SALE_CASH', 500n], ['CHANGE_OUT', -200n]]));
    expect(await prisma().phCashMovement.count({ where: { shiftId: holder.id } })).toBe(0);
    expect((await prisma().phSale.findUniqueOrThrow({ where: { id: done.id } })).shiftId).toBe(completer.id);
    const audit = await prisma().auditLog.findFirstOrThrow({ where: { action: 'ph.sale.create' } });
    expect(JSON.stringify(audit.changes)).toContain(held.id);
  });

  it('answers a repeat of the completing key with the stored sale, though the hold is gone', async () => {
    const w = await world();
    await stock(w);
    const held = dataOf(await act(w.cashier, saleActions.hold, cart(w)));
    const input = sale(w, { fromHoldId: held.id });
    const one = dataOf(await act(w.cashier2, saleActions.create, input));
    const two = dataOf(await act(w.cashier2, saleActions.create, input));
    expect(two).toMatchObject({ id: one.id, replayed: true });
    expect(await prisma().phPayment.count()).toBe(1);
  });

  it('lets exactly one of several parallel completions of one hold win', async () => {
    const w = await world();
    const batch = await stock(w);
    const held = dataOf(await act(w.cashier, saleActions.hold, cart(w)));
    const who = [w.cashier, w.cashier2, w.manager, w.pharmacist, w.cashier, w.manager];
    const results = await Promise.all(who.map((p) => act(p, saleActions.create, sale(w, { fromHoldId: held.id }))));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok).every((r) => !r.ok && r.error.code === 'CONFLICT' && r.error.fields?.phCode === 'HOLD_NOT_AVAILABLE')).toBe(true);
    expect(await prisma().phSale.count()).toBe(1);
    expect(await prisma().phPayment.count()).toBe(1);
    expect((await balanceOf(batch, w.b1))?.available).toBe(98);
    expect(await prisma().phStockMovement.count({ where: { type: 'SALE' } })).toBe(1);
  });

  it('refuses an expired, discarded, other-branch or other-business hold and creates nothing', async () => {
    const w = await world();
    await stock(w);
    await stock(w, { branchId: w.b2, lot: 'L2' });
    const old = dataOf(await act(w.cashier, saleActions.hold, cart(w)));
    const gone = dataOf(await act(w.cashier, saleActions.hold, cart(w)));
    dataOf(await act(w.cashier, saleActions.discardHold, { restaurantId: w.a.id, branchId: w.b1, saleId: gone.id }));
    const elsewhere = dataOf(await act(w.owner, saleActions.hold, cart(w, { branchId: w.b2 })));
    const b = await pharmacy('B', { branches: 1 });
    const foreign = await prisma().phShift.create({ data: { restaurantId: b.id, branchId: b.branchId, userId: 'someone', currency: 'IQD' }, select: { id: true } });
    const theirs = await prisma().phSale.create({
      data: { restaurantId: b.id, branchId: b.branchId, shiftId: foreign.id, status: 'HELD', currency: 'IQD', clientKey: 'foreign-hold-1', soldById: 'someone', heldUntil: new Date(NOW.getTime() + HOUR) },
      select: { id: true },
    });
    const before = await prisma().phSale.count();
    expect(phCodeOf(await act(w.cashier, saleActions.create, sale(w, { fromHoldId: gone.id })))).toBe('HOLD_NOT_AVAILABLE');
    expect(phCodeOf(await act(w.manager, saleActions.create, sale(w, { fromHoldId: elsewhere.id })))).toBe('HOLD_NOT_AVAILABLE');
    expect(phCodeOf(await act(w.cashier, saleActions.create, sale(w, { fromHoldId: theirs.id })))).toBe('HOLD_NOT_AVAILABLE');
    expect(phCodeOf(await act(w.cashier, saleActions.create, sale(w, { fromHoldId: 'nope' })))).toBe('HOLD_NOT_AVAILABLE');
    vi.setSystemTime(new Date(NOW.getTime() + 24 * HOUR));
    expect(phCodeOf(await act(w.cashier, saleActions.create, sale(w, { fromHoldId: old.id })))).toBe('HOLD_EXPIRED');
    expect(await prisma().phSale.count()).toBe(before);
    expect((await prisma().phSale.findUniqueOrThrow({ where: { id: elsewhere.id } })).status).toBe('HELD');
    expect((await prisma().phSale.findUniqueOrThrow({ where: { id: theirs.id } })).status).toBe('HELD');
    expect(await prisma().phSaleLine.count({ where: { saleId: elsewhere.id } })).toBe(1);
  });

  it('keeps the hold when the completing sale fails (no stock), so nothing is lost', async () => {
    const w = await world();
    await stock(w, { buckets: { available: 1 } });
    const held = dataOf(await act(w.cashier, saleActions.hold, cart(w)));
    expect(phCodeOf(await act(w.cashier, saleActions.create, sale(w, { fromHoldId: held.id })))).toBe('INSUFFICIENT_STOCK');
    const row = await prisma().phSale.findUniqueOrThrow({ where: { id: held.id }, include: { lines: true } });
    expect(row.status).toBe('HELD');
    expect(row.lines).toHaveLength(1);
    expect(await prisma().phPayment.count()).toBe(0);
  });

  it('cannot reuse the hold’s own key for the completing sale', async () => {
    const w = await world();
    await stock(w);
    const input = cart(w);
    const held = dataOf(await act(w.cashier, saleActions.hold, input));
    expect(codeOf(await act(w.cashier, saleActions.create, { ...input, payments: [cash(200n)], fromHoldId: held.id }))).toBe('CONFLICT');
    expect((await prisma().phSale.findUniqueOrThrow({ where: { id: held.id } })).status).toBe('HELD');
  });
});
