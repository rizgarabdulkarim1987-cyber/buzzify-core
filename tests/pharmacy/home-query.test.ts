import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as homeQueries from '@/server/pharmacy/queries/home';
import * as navQueries from '@/server/pharmacy/queries/nav-counts';
import { NOW, person, pharmacy, prisma, resetWorld, useTestDatabase } from './fixture';
import { ask, dataOf, makeBatch, makeProduct } from './stock-helpers';

beforeAll(() => {
  useTestDatabase();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterAll(() => {
  vi.useRealTimers();
});
beforeEach(resetWorld, 60_000);

// NOW is 2026-10-27 09:00 UTC, 12:00 in Baghdad.
const HOUR = 3_600_000;
const TODAY = '2026-10-27';
const plus = (days: number) => new Date(new Date(`${TODAY}T00:00:00.000Z`).getTime() + days * 86_400_000).toISOString().slice(0, 10);
let seq = 0;

async function world() {
  const a = await pharmacy('A', { branches: 2 });
  const owner = await person('owner', { membership: [a.id, 'OWNER'] });
  const b1 = a.branchIds[0]!;
  const b2 = a.branchIds[1]!;
  const usdSeller = await person('usd', { staff: [a.id, 'BRANCH_MANAGER', [b1, b2]] });
  const shifts: Record<string, string> = {};
  for (const branchId of [b1, b2]) {
    for (const currency of ['IQD', 'USD'] as const) {
      // One open shift per person and branch: the USD shifts are another person's.
      const userId = currency === 'USD' ? usdSeller.userId : owner.userId;
      const s = await prisma().phShift.create({ data: { restaurantId: a.id, branchId, userId, currency, openingFloatMinor: 0n }, select: { id: true } });
      shifts[`${branchId}|${currency}`] = s.id;
    }
  }
  return { a, owner, b1, b2, shifts };
}
type World = Awaited<ReturnType<typeof world>>;

async function sale(
  w: World,
  totalMinor: bigint,
  completedAt: Date,
  opts: { branchId?: string; status?: 'COMPLETED' | 'HELD' | 'HOLD_EXPIRED' | 'RETURNED_PARTIAL' | 'RETURNED_FULL'; currency?: 'IQD' | 'USD' } = {},
) {
  const branchId = opts.branchId ?? w.b1;
  const currency = opts.currency ?? 'IQD';
  const status = opts.status ?? 'COMPLETED';
  const done = status !== 'HELD' && status !== 'HOLD_EXPIRED';
  seq += 1;
  await prisma().phSale.create({
    data: {
      restaurantId: w.a.id,
      branchId,
      shiftId: w.shifts[`${branchId}|${currency}`]!,
      number: done ? `20261027-${String(seq).padStart(6, '0')}` : null,
      status,
      currency,
      subtotalMinor: totalMinor,
      totalMinor,
      paidMinor: done ? totalMinor : 0n,
      clientKey: `home-${seq}`,
      soldById: w.owner.userId,
      completedAt: done ? completedAt : null,
      ...(status === 'HELD' ? { heldUntil: new Date(NOW.getTime() + HOUR) } : {}),
    },
  });
}

const figures = (w: World, over: Record<string, unknown> = {}, who = w.owner) =>
  ask(who, homeQueries.homeFigures, { restaurantId: w.a.id, period: '7d', now: NOW, ...over });

describe('ph.home.figures', () => {
  it('a pharmacy with no sales: every figure is 0, the series is all zeros and nothing needs attention', async () => {
    const w = await world();
    const f = dataOf(await figures(w));
    expect(f).toMatchObject({ currency: 'IQD', salesVisible: true, salesToday: 0, salesYesterday: 0, invoicesToday: 0, lowStock: 0, expiring90: 0, attention: [], otherCurrencies: false });
    expect(f.series).toHaveLength(7);
    expect(f.series.every((p) => p.total === 0)).toBe(true);
  });

  it("today's sales count completed sales only, on the Baghdad day", async () => {
    const w = await world();
    await sale(w, 100n, new Date(NOW.getTime() - HOUR));
    await sale(w, 200n, new Date(NOW.getTime() - 2 * HOUR));
    // 01:00 in Baghdad on the 27th is still the 26th in UTC: it is today's.
    await sale(w, 300n, new Date('2026-10-26T22:00:00.000Z'));
    await sale(w, 999n, NOW, { status: 'HELD' });
    await sale(w, 888n, NOW, { status: 'HOLD_EXPIRED' });
    // 23:30 in Baghdad on the 26th: yesterday's.
    await sale(w, 40n, new Date('2026-10-26T20:30:00.000Z'));
    await sale(w, 60n, new Date('2026-10-26T08:00:00.000Z'));
    const f = dataOf(await figures(w));
    expect(f.salesToday).toBe(600);
    expect(f.invoicesToday).toBe(3);
    expect(f.salesYesterday).toBe(100);
  });

  it('a sale with a return still counts at its total (returns are their own documents and are not subtracted here)', async () => {
    const w = await world();
    await sale(w, 500n, NOW, { status: 'RETURNED_PARTIAL' });
    expect(dataOf(await figures(w)).salesToday).toBe(500);
  });

  it('7d is seven Baghdad days in date order with zeros for empty days', async () => {
    const w = await world();
    await sale(w, 70n, new Date(`${plus(-6)}T09:00:00.000Z`));
    await sale(w, 30n, new Date(`${plus(-2)}T09:00:00.000Z`));
    await sale(w, 5n, new Date(`${plus(-7)}T09:00:00.000Z`)); // outside the window
    const f = dataOf(await figures(w));
    expect(f.series).toEqual([
      { label: plus(-6), total: 70 },
      { label: plus(-5), total: 0 },
      { label: plus(-4), total: 0 },
      { label: plus(-3), total: 0 },
      { label: plus(-2), total: 30 },
      { label: plus(-1), total: 0 },
      { label: TODAY, total: 0 },
    ]);
  });

  it('30d is thirty days ending today', async () => {
    const w = await world();
    await sale(w, 9n, new Date(`${plus(-29)}T09:00:00.000Z`));
    const f = dataOf(await figures(w, { period: '30d' }));
    expect(f.series).toHaveLength(30);
    expect(f.series[0]).toEqual({ label: plus(-29), total: 9 });
    expect(f.series.at(-1)!.label).toBe(TODAY);
  });

  it('12m is twelve months ending this month, grouped by Baghdad month', async () => {
    const w = await world();
    await sale(w, 10n, new Date('2025-11-01T00:30:00.000Z')); // 03:30 on 1 Nov in Baghdad
    await sale(w, 20n, new Date('2025-10-31T20:00:00.000Z')); // 23:00 on 31 Oct: outside
    await sale(w, 3n, new Date('2026-10-02T09:00:00.000Z'));
    await sale(w, 4n, new Date('2026-10-20T09:00:00.000Z'));
    const f = dataOf(await figures(w, { period: '12m' }));
    expect(f.series).toHaveLength(12);
    expect(f.series[0]).toEqual({ label: '2025-11', total: 10 });
    expect(f.series.at(-1)).toEqual({ label: '2026-10', total: 7 });
    expect(f.series.slice(1, 11).every((p) => p.total === 0)).toBe(true);
  });

  it('branchId filters; without one every branch of the person counts', async () => {
    const w = await world();
    await sale(w, 100n, NOW, { branchId: w.b1 });
    await sale(w, 50n, NOW, { branchId: w.b2 });
    expect(dataOf(await figures(w, { branchId: w.b1 })).salesToday).toBe(100);
    expect(dataOf(await figures(w, { branchId: w.b2 })).salesToday).toBe(50);
    expect(dataOf(await figures(w)).salesToday).toBe(150);
  });

  it('money is in the primary currency only; other currencies are left out and flagged', async () => {
    const w = await world();
    await prisma().phSettings.create({ data: { restaurantId: w.a.id, enabledCurrencies: ['IQD', 'USD'], defaultCurrency: 'IQD' } });
    await sale(w, 100n, NOW);
    expect(dataOf(await figures(w)).otherCurrencies).toBe(false);
    await sale(w, 7n, NOW, { currency: 'USD' });
    const f = dataOf(await figures(w));
    expect(f).toMatchObject({ currency: 'IQD', salesToday: 100, invoicesToday: 1, otherCurrencies: true });
    await prisma().phSettings.update({ where: { restaurantId: w.a.id }, data: { defaultCurrency: 'USD' } });
    expect(dataOf(await figures(w))).toMatchObject({ currency: 'USD', salesToday: 7, invoicesToday: 1, otherCurrencies: true });
  });

  it('low stock and expiring follow the navigation counters, and the attention list names the products', async () => {
    const w = await world();
    const low = await makeProduct(w.a.id, 'Masks');
    const soon = await makeProduct(w.a.id, 'Amoxicillin 500');
    await makeBatch(w.a.id, w.b1, low.id, { lot: 'M1', buckets: { available: 3 } });
    await prisma().phProductBranch.create({ data: { restaurantId: w.a.id, branchId: w.b1, productId: low.id, minQty: 10 } });
    await makeBatch(w.a.id, w.b1, soon.id, { lot: 'B2231', expiry: plus(18), buckets: { available: 12 } });
    await makeBatch(w.a.id, w.b1, soon.id, { lot: 'FAR', expiry: plus(200), buckets: { available: 12 } });
    const f = dataOf(await figures(w));
    const nav = dataOf(await ask(w.owner, navQueries.navCounts, { restaurantId: w.a.id, now: NOW }));
    expect({ lowStock: f.lowStock, expiring: f.expiring90 }).toEqual(nav);
    expect(f).toMatchObject({ lowStock: 1, expiring90: 1 });
    expect(f.attention).toEqual([
      { kind: 'expiry', productName: 'Amoxicillin 500', detail: 'B2231', days: 18, qty: 12, min: null },
      { kind: 'lowStock', productName: 'Masks', detail: '', days: null, qty: 3, min: 10 },
    ]);
  });

  it('a role without report.view sees the stock figures but no money', async () => {
    const w = await world();
    const cashier = await person('cashier', { staff: [w.a.id, 'CASHIER', [w.b1]] });
    await sale(w, 100n, NOW);
    const f = dataOf(await figures(w, { branchId: w.b1 }, cashier));
    expect(f).toMatchObject({ salesVisible: false, salesToday: 0, salesYesterday: 0, invoicesToday: 0, otherCurrencies: false });
    expect(f.series.every((p) => p.total === 0)).toBe(true);
  });
});
