import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '@/generated/prisma/client';
import { searchTextOf } from '@/server/domain/pharmacy/product-identity';
import * as stockActions from '@/server/pharmacy/actions/stock';
import * as stockQueries from '@/server/pharmacy/queries/stock';
import { loadActor, type Actor } from '@/server/studio/auth/actor';
import { runQuery } from '@/server/studio/framework/query';
import { databaseUrl, TEST_DB } from '../../scripts/db-config';
import { NOW, person, pharmacy, prisma, resetWorld, useTestDatabase } from './fixture';
import { act, ask, codeOf, dataOf, makeBatch, makeProduct, stockInto } from './stock-helpers';

beforeAll(() => {
  useTestDatabase();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterAll(() => {
  vi.useRealTimers();
});
beforeEach(resetWorld, 60_000);

async function world() {
  const a = await pharmacy('A', { branches: 2 });
  const owner = await person('owner', { membership: [a.id, 'OWNER'] });
  const at = { restaurantId: a.id };
  return { a, owner, at, b1: a.branchIds[0]!, b2: a.branchIds[1]! };
}

describe('ph.stock.balances', () => {
  it('lists per product the branch totals, a sellable total and the batches in FEFO order', async () => {
    const { a, owner, at, b1, b2 } = await world();
    const p = await makeProduct(a.id);
    const late = await makeBatch(a.id, b1, p.id, { lot: 'LATE', expiry: '2029-01-31', buckets: { available: 10, reserved: 1 } });
    const soon = await makeBatch(a.id, b1, p.id, { lot: 'SOON', expiry: '2027-01-31', buckets: { available: 20, quarantine: 2, damaged: 3 } });
    const expired = await makeBatch(a.id, b1, p.id, { lot: 'OLD', expiry: '2026-10-01', buckets: { available: 40 } });
    const recalled = await makeBatch(a.id, b1, p.id, { lot: 'RECALL', expiry: '2028-05-31', status: 'RECALLED', buckets: { available: 50 } });
    await stockInto(a.id, b2, late, { available: 7 });

    const res = dataOf(await ask(owner, stockQueries.balances, at));
    expect(res.nextCursor).toBeNull();
    expect(res.items).toHaveLength(1);
    const item = res.items[0]!;
    expect(item).toMatchObject({ productId: p.id, tradeName: 'Panadol', active: true });
    const byBranch = Object.fromEntries(item.branches.map((x) => [x.branchId, x]));
    // b1: sellable = SOON 20 + LATE 10 (the expired and the recalled batch do not count; reserved, quarantine, damaged never)
    expect(byBranch[b1]).toMatchObject({ available: 120, reserved: 1, quarantine: 2, damaged: 3, sellable: 30 });
    expect(byBranch[b2]).toMatchObject({ available: 7, reserved: 0, quarantine: 0, damaged: 0, sellable: 7 });
    expect(item.batches.map((x) => x.lot)).toEqual(['OLD', 'SOON', 'RECALL', 'LATE']);
    const old = item.batches[0]!;
    expect(old).toMatchObject({ batchId: expired, expired: true, status: 'ACTIVE', expiryDate: '2026-10-01', expiryPrecision: 'DAY' });
    expect(item.batches[2]).toMatchObject({ batchId: recalled, status: 'RECALLED', expired: false });
    expect(item.batches[1]).toMatchObject({ batchId: soon, expired: false });
    expect(item.batches[1]!.buckets.find((x) => x.branchId === b1)).toMatchObject({ available: 20, quarantine: 2, damaged: 3, reserved: 0, sellable: 20 });
    expect(item.batches[3]!.buckets.map((x) => x.branchId).sort()).toEqual([b1, b2].sort());
  });

  it('filters by place branch, product, search, onlyWithStock and lowStock', async () => {
    const { a, owner, at, b1, b2 } = await world();
    const pa = await makeProduct(a.id, 'Alpha');
    const pb = await makeProduct(a.id, 'Beta');
    const pc = await makeProduct(a.id, 'Gamma');
    await makeBatch(a.id, b1, pa.id, { buckets: { available: 5 } });
    await makeBatch(a.id, b2, pb.id, { lot: 'B', buckets: { quarantine: 4 } });
    await prisma().phProductBranch.create({ data: { restaurantId: a.id, branchId: b1, productId: pa.id, minQty: 10 } });
    await prisma().phProductBranch.create({ data: { restaurantId: a.id, branchId: b1, productId: pc.id, minQty: 3 } });
    const names = async (input: Record<string, unknown>) => dataOf(await ask(owner, stockQueries.balances, { ...at, ...input })).items.map((i) => i.tradeName);

    expect(await names({})).toEqual(['Alpha', 'Beta', 'Gamma']);
    expect(await names({ onlyWithStock: true })).toEqual(['Alpha', 'Beta']);
    expect(await names({ onlyWithStock: true, branchId: b1 })).toEqual(['Alpha']);
    expect(await names({ lowStock: true })).toEqual(['Alpha', 'Gamma']);
    expect(await names({ lowStock: true, branchId: b2 })).toEqual([]);
    expect(await names({ productId: pb.id })).toEqual(['Beta']);
    expect(await names({ search: 'gam' })).toEqual(['Gamma']);
    const lowAlpha = dataOf(await ask(owner, stockQueries.balances, { ...at, branchId: b1, productId: pa.id })).items[0]!;
    expect(lowAlpha.branches).toEqual([expect.objectContaining({ branchId: b1, minQty: 10, available: 5 })]);
    // The place's branch restricts the numbers too.
    const onlyB2 = dataOf(await ask(owner, stockQueries.balances, { ...at, branchId: b2, productId: pa.id })).items[0]!;
    expect(onlyB2.branches).toEqual([]);
    expect(onlyB2.batches).toEqual([]);
  });

  it('lowStock compares the SELLABLE total with the minimum (R2-5)', async () => {
    const { a, owner, at, b1 } = await world();
    const expiredOnly = await makeProduct(a.id, 'ExpiredOnly');
    const enough = await makeProduct(a.id, 'Enough');
    const mixed = await makeProduct(a.id, 'Mixed');
    await makeBatch(a.id, b1, expiredOnly.id, { expiry: '2026-10-01', buckets: { available: 100 } });
    await makeBatch(a.id, b1, enough.id, { buckets: { available: 100 } });
    await makeBatch(a.id, b1, mixed.id, { lot: 'X', status: 'RECALLED', buckets: { available: 100 } });
    await makeBatch(a.id, b1, mixed.id, { lot: 'Y', buckets: { available: 5, quarantine: 50 } });
    for (const p of [expiredOnly, enough, mixed]) await prisma().phProductBranch.create({ data: { restaurantId: a.id, branchId: b1, productId: p.id, minQty: 10 } });
    const low = dataOf(await ask(owner, stockQueries.balances, { ...at, lowStock: true })).items.map((i) => i.tradeName);
    expect(low).toEqual(['ExpiredOnly', 'Mixed']);
  });

  it('refuses a stock filter over too many products with TOO_MANY', async () => {
    const { a, owner, at, b1 } = await world();
    const products = Array.from({ length: 5001 }, (_, i) => ({ restaurantId: a.id, tradeName: 'P' + i, identityKey: 'k' + i, searchText: 'p' + i }));
    await prisma().phProduct.createMany({ data: products });
    const rows = await prisma().phProduct.findMany({ where: { restaurantId: a.id }, select: { id: true } });
    await prisma().phBatch.createMany({ data: rows.map((r) => ({ restaurantId: a.id, productId: r.id, lot: 'L', expiryDate: new Date('2028-01-31T00:00:00.000Z') })) });
    const batches = await prisma().phBatch.findMany({ where: { restaurantId: a.id }, select: { id: true, productId: true } });
    await prisma().phStockBalance.createMany({ data: batches.map((x) => ({ restaurantId: a.id, branchId: b1, productId: x.productId, batchId: x.id, available: 1 })) });
    const r = await ask(owner, stockQueries.balances, { ...at, onlyWithStock: true });
    expect(codeOf(r)).toBe('CONFLICT');
    expect(r.ok ? null : r.error.fields?.phCode).toBe('TOO_MANY');
    expect(dataOf(await ask(owner, stockQueries.balances, at)).items).toHaveLength(50);
  }, 60_000);

  it('a search never returns another business’s product', async () => {
    const { owner, at } = await world();
    const b = await pharmacy('B');
    const bp = await makeProduct(b.id, 'Secretin');
    await makeBatch(b.id, b.branchId, bp.id, { buckets: { available: 5 } });
    expect(dataOf(await ask(owner, stockQueries.balances, { ...at, search: 'secretin' })).items).toEqual([]);
    expect(dataOf(await ask(owner, stockQueries.balances, { ...at, search: 'secretin', onlyWithStock: true })).items).toEqual([]);
  });

  it('pages by cursor', async () => {
    const { a, owner, at, b1 } = await world();
    for (const n of ['A1', 'A2', 'A3', 'A4', 'A5']) await makeBatch(a.id, b1, (await makeProduct(a.id, n)).id, { buckets: { available: 1 } });
    const first = dataOf(await ask(owner, stockQueries.balances, { ...at, pageSize: 2 }));
    expect(first.items.map((i) => i.tradeName)).toEqual(['A1', 'A2']);
    const second = dataOf(await ask(owner, stockQueries.balances, { ...at, pageSize: 2, cursor: first.nextCursor }));
    expect(second.items.map((i) => i.tradeName)).toEqual(['A3', 'A4']);
    const third = dataOf(await ask(owner, stockQueries.balances, { ...at, pageSize: 2, cursor: second.nextCursor }));
    expect(third.items.map((i) => i.tradeName)).toEqual(['A5']);
    expect(third.nextCursor).toBeNull();
    expect(codeOf(await ask(owner, stockQueries.balances, { ...at, pageSize: 101 }))).toBe('INVALID');
  });

  it('hides cost without cost.view and shows it with it', async () => {
    const { a, owner, at, b1 } = await world();
    const p = await makeProduct(a.id);
    await makeBatch(a.id, b1, p.id, { buckets: { available: 5 }, cost: { unitCostMinor: 2500n, costUnitId: p.strip } });
    const withCost = dataOf(await ask(owner, stockQueries.balances, at)).items[0]!.batches[0]!;
    expect(withCost).toMatchObject({ unitCostMinor: '2500', currency: 'IQD' });
    for (const role of ['CASHIER', 'PHARMACIST'] as const) {
      const who = await person(role.toLowerCase(), { staff: [a.id, role, [b1]] });
      const res = dataOf(await ask(who, stockQueries.balances, at));
      expect(res.items).toHaveLength(1);
      expect(JSON.stringify(res)).not.toMatch(/2500|unitCost|currency|costUnit/);
    }
  });

  it('shows a branch-limited actor only their branches, whatever the place says', async () => {
    const { a, at, b1, b2 } = await world();
    const p = await makeProduct(a.id);
    const batch = await makeBatch(a.id, b1, p.id, { buckets: { available: 5 } });
    await stockInto(a.id, b2, batch, { available: 9 });
    const only1 = await person('only1', { staff: [a.id, 'PHARMACIST', [b1]] });
    const mine = dataOf(await ask(only1, stockQueries.balances, at)).items[0]!;
    expect(mine.branches.map((x) => x.branchId)).toEqual([b1]);
    expect(mine.batches[0]!.buckets.map((x) => x.branchId)).toEqual([b1]);
    expect(JSON.stringify(mine)).not.toContain(b2);
    expect(codeOf(await ask(only1, stockQueries.balances, { ...at, branchId: b2 }))).toBe('FORBIDDEN');
    // A product stocked only in the other branch shows no stock at all.
    const p2 = await makeProduct(a.id, 'Elsewhere');
    await makeBatch(a.id, b2, p2.id, { buckets: { available: 3 } });
    const items = dataOf(await ask(only1, stockQueries.balances, { ...at, onlyWithStock: true })).items;
    expect(items.map((i) => i.tradeName)).toEqual(['Panadol']);
  });

  it('never returns another business\'s stock', async () => {
    const { owner, at } = await world();
    const b = await pharmacy('B');
    const bp = await makeProduct(b.id, 'Secret');
    await makeBatch(b.id, b.branchId, bp.id, { buckets: { available: 5 } });
    expect(dataOf(await ask(owner, stockQueries.balances, at)).items).toEqual([]);
    expect(dataOf(await ask(owner, stockQueries.balances, { ...at, productId: bp.id })).items).toEqual([]);
  });

  it('a person with no pharmacy reads nothing', async () => {
    const { at } = await world();
    const stranger = await person('stranger');
    expect(codeOf(await ask(stranger, stockQueries.balances, at))).not.toBe('OK');
  });

  it('a page of 100 products costs the same number of database queries as a page of 2', async () => {
    const { a, owner, at, b1, b2 } = await world();
    const products = Array.from({ length: 100 }, (_, i) => {
      const tradeName = `Product ${String(i).padStart(3, '0')}`;
      return { restaurantId: a.id, tradeName, identityKey: `k${i}`, searchText: searchTextOf({ tradeName, genericName: '', activeIngredient: '', strength: '', form: '', manufacturer: '' }) };
    });
    await prisma().phProduct.createMany({ data: products });
    const rows = await prisma().phProduct.findMany({ where: { restaurantId: a.id }, select: { id: true } });
    await prisma().phBatch.createMany({ data: rows.flatMap((r) => [1, 2].map((n) => ({ restaurantId: a.id, productId: r.id, lot: `L${n}`, expiryDate: new Date(`202${7 + n}-01-31T00:00:00.000Z`) }))) });
    const batches = await prisma().phBatch.findMany({ where: { restaurantId: a.id }, select: { id: true, productId: true } });
    await prisma().phStockBalance.createMany({
      data: batches.flatMap((x) => [b1, b2].map((branchId) => ({ restaurantId: a.id, branchId, productId: x.productId, batchId: x.id, available: 5, quarantine: 1 }))),
    });
    await prisma().phProductBranch.createMany({ data: rows.map((r) => ({ restaurantId: a.id, branchId: b1, productId: r.id, minQty: 50 })) });

    const counting = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl(TEST_DB) }), log: [{ emit: 'event', level: 'query' }] });
    let count = 0;
    (counting as unknown as { $on: (e: string, f: () => void) => void }).$on('query', () => {
      count += 1;
    });
    const actor = (await loadActor(prisma(), owner.userId)) as Actor;
    const measure = async (input: Record<string, unknown>) => {
      count = 0;
      const result = await runQuery(counting, actor, stockQueries.balances, { ...at, ...input });
      return { data: dataOf(result), queries: count };
    };
    try {
      const small = await measure({ pageSize: 2 });
      const big = await measure({ pageSize: 100 });
      expect(small.data.items).toHaveLength(2);
      expect(big.data.items).toHaveLength(100);
      expect(big.data.items[0]!.batches).toHaveLength(2);
      expect(big.queries).toBeGreaterThan(3);
      expect(big.queries).toBe(small.queries);
      const filtered = await measure({ pageSize: 100, lowStock: true });
      const filteredSmall = await measure({ pageSize: 2, lowStock: true });
      expect(filtered.data.items).toHaveLength(100);
      expect(filtered.queries).toBe(filteredSmall.queries);
      expect(big.queries).toBeLessThanOrEqual(15);
      expect(filtered.queries).toBeLessThanOrEqual(15);
    } finally {
      await counting.$disconnect();
    }
  });
});

describe('ph.stock.movements', () => {
  async function seeded() {
    const w = await world();
    const p = await makeProduct(w.a.id);
    const batchId = await makeBatch(w.a.id, w.b1, p.id, { buckets: { available: 50 } });
    const done = dataOf(await act(w.owner, stockActions.damage, { restaurantId: w.a.id, branchId: w.b1, batchId, fromBucket: 'available', baseQty: 5, reason: 'Dropped' }));
    return { ...w, p, batchId, damageId: done.id };
  }

  it('lists newest first with the person as an id only, and filters', async () => {
    const { a, owner, at, b1, p, batchId, damageId } = await seeded();
    vi.setSystemTime(new Date(NOW.getTime() + 1000));
    const adj = dataOf(await act(owner, stockActions.adjust, { restaurantId: a.id, branchId: b1, batchId, direction: 'in', baseQty: 2, reason: 'Found two', clientKey: 'mv-key-1' }));
    const all = dataOf(await ask(owner, stockQueries.movements, at));
    expect(all.items[0]).toMatchObject({ id: adj.id, type: 'ADJUST', availableDelta: 2, userId: owner.userId, reason: 'Found two', lot: 'L1', branchId: b1, productId: p.id, batchId });
    expect(all.items.slice(0, 2).map((i) => i.type)).toEqual(['ADJUST', 'DAMAGE']);
    expect(Object.keys(all.items[0]!)).not.toContain('user');
    expect(JSON.stringify(all.items[0])).not.toContain(owner.email);
    const only = async (input: Record<string, unknown>) => dataOf(await ask(owner, stockQueries.movements, { ...at, ...input })).items.map((i) => i.id);
    expect(await only({ type: 'DAMAGE' })).toEqual([damageId]);
    expect(await only({ batchId })).toHaveLength(all.items.length);
    expect(await only({ productId: p.id, type: 'ADJUST' })).toContain(adj.id);
    expect(await only({ from: '2099-01-01' })).toEqual([]);
    expect(await only({ to: '2000-01-01' })).toEqual([]);
    expect(await only({ from: '2000-01-01', to: '2099-12-31' })).toHaveLength(all.items.length);
    const paged = dataOf(await ask(owner, stockQueries.movements, { ...at, pageSize: 1 }));
    expect(paged.items).toHaveLength(1);
    expect(paged.nextCursor).not.toBeNull();
    expect(dataOf(await ask(owner, stockQueries.movements, { ...at, pageSize: 1, cursor: paged.nextCursor })).items[0]!.id).not.toBe(paged.items[0]!.id);
    expect(await only({ batchId: 'nope' })).toEqual([]);
    expect(await only({ receiptId: 'nope' })).toEqual([]);
  });

  it('needs report.view and shows a branch-limited actor only their branches', async () => {
    const { a, at, b1, b2, p, batchId } = await seeded();
    await stockInto(a.id, b2, batchId, { available: 8 });
    const otherBatch = await makeBatch(a.id, b2, p.id, { lot: 'Z', buckets: { available: 1 } });
    for (const role of ['CASHIER', 'PHARMACIST', 'STOCK'] as const) {
      const who = await person(role.toLowerCase(), { staff: [a.id, role, [b1]] });
      expect(codeOf(await ask(who, stockQueries.movements, at)), role).toBe('FORBIDDEN');
    }
    const accountant = await person('acc', { staff: [a.id, 'ACCOUNTANT', [b1]] });
    const seen = dataOf(await ask(accountant, stockQueries.movements, at)).items;
    expect(seen.length).toBeGreaterThan(0);
    expect(new Set(seen.map((i) => i.branchId))).toEqual(new Set([b1]));
    expect(seen.map((i) => i.batchId)).not.toContain(otherBatch);
    expect(codeOf(await ask(accountant, stockQueries.movements, { ...at, branchId: b2 }))).toBe('FORBIDDEN');
  });

  it('never returns another business\'s movements', async () => {
    const { owner, at } = await world();
    const b = await pharmacy('B');
    const bp = await makeProduct(b.id);
    const bBatch = await makeBatch(b.id, b.branchId, bp.id, { buckets: { available: 5 } });
    expect(dataOf(await ask(owner, stockQueries.movements, at)).items).toEqual([]);
    expect(dataOf(await ask(owner, stockQueries.movements, { ...at, batchId: bBatch })).items).toEqual([]);
  });
});
