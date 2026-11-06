import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as exchangeRateActions from '@/server/pharmacy/actions/exchange-rate';
import * as returnActions from '@/server/pharmacy/actions/returns';
import * as saleActions from '@/server/pharmacy/actions/sales';
import * as navQueries from '@/server/pharmacy/queries/nav-counts';
import * as pulseQueries from '@/server/pharmacy/queries/pulse';
import { creditWorld, key, makeCustomer, sellOnCredit, type CreditWorld } from './credit-world';
import { NOW, person, prisma, resetWorld, useTestDatabase } from './fixture';
import { act, ask, codeOf, dataOf, makeBatch, makeProduct } from './stock-helpers';

/** The cashier's header chips (shift sales, receipts, drawer cash, near-expiry, low stock) and the display-only USD rate. */

interface Pulse {
  shiftNetMinor: string;
  receiptsDone: number;
  drawerCashMinor: string;
  nearExpiry: { count: number; firstProductName: string | null; firstProductId: string | null };
  lowStock: { count: number; firstProductName: string | null; firstProductId: string | null };
  usdRate: number;
}

let w: CreditWorld;
const at = (branchId = w.b1) => ({ restaurantId: w.a.id, branchId });
const pulse = async (who = w.manager, branchId = w.b1) => dataOf(await ask(who, pulseQueries.pulse, at(branchId))) as Pulse;
const plus = (days: number) => new Date(NOW.getTime() + days * 86_400_000).toISOString().slice(0, 10);

beforeAll(() => {
  useTestDatabase();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterAll(() => {
  vi.useRealTimers();
});
beforeEach(async () => {
  await resetWorld();
  w = await creditWorld();
}, 60_000);

const cash = (amountMinor: bigint) => ({ method: 'CASH', amountMinor, clientKey: key('pay') });
const card = (amountMinor: bigint) => ({ method: 'CARD_MANUAL', amountMinor, clientKey: key('pay') });
const sell = (who: typeof w.manager, branchId: string, payments: unknown[], tablets: number) =>
  act(who, saleActions.create, { ...at(branchId), clientKey: key('sale'), currency: 'IQD', lines: [{ productId: w.p.id, unitId: w.p.tablet, qty: tablets }], payments });

describe('shift chips', () => {
  it('nets cash + card + credit minus returns for the open shift, and counts receipts and drawer cash', async () => {
    dataOf(await sell(w.manager, w.b1, [cash(300n)], 3));
    dataOf(await sell(w.manager, w.b1, [card(200n)], 2));
    const customer = await makeCustomer(w);
    dataOf(await sellOnCredit(w, w.manager, customer.id, 400n));
    const sale = await prisma().phSale.findFirstOrThrow({ where: { shiftId: w.shifts.manager!, payments: { some: { method: 'CASH' } } }, include: { lines: true } });
    dataOf(await act(w.manager, returnActions.create, { ...at(), saleId: sale.id, lines: [{ saleLineId: sale.lines[0]!.id, baseQty: 1 }], reason: 'Changed mind', clientKey: key('ret') }));
    const got = await pulse();
    expect(got.shiftNetMinor).toBe(String(300n + 200n + 400n - 100n));
    expect(got.receiptsDone).toBe(3);
    expect(got.drawerCashMinor).toBe(String(300n - 100n));
  });

  it('returns zeros when the person has no open shift', async () => {
    const lone = await person('lone', { staff: [w.a.id, 'CASHIER', [w.b1]] });
    const got = await pulse(lone);
    expect(got).toMatchObject({ shiftNetMinor: '0', receiptsDone: 0, drawerCashMinor: '0', usdRate: 1450 });
  });

  it('refuses an actor without shift.use', async () => {
    expect(codeOf(await ask(w.accountant, pulseQueries.pulse, at()))).toBe('FORBIDDEN');
    expect(codeOf(await ask(w.stockClerk, pulseQueries.pulse, at()))).toBe('FORBIDDEN');
  });

  it('never counts another branch or business', async () => {
    dataOf(await sell(w.manager, w.b1, [cash(100n)], 1));
    dataOf(await sell(w.owner, w.b2, [cash(500n)], 5));
    expect((await pulse(w.manager, w.b1)).shiftNetMinor).toBe('100');
    expect((await pulse(w.owner, w.b2)).shiftNetMinor).toBe('500');
    expect(codeOf(await ask(w.ownerB, pulseQueries.pulse, at()))).not.toBe('OK');
  });
});

describe('near-expiry and low-stock chips', () => {
  it('counts a batch expiring in 89 days and not one in 91, and names the first', async () => {
    const near = await makeProduct(w.a.id, 'Nearcillin');
    const far = await makeProduct(w.a.id, 'Farcillin');
    await makeBatch(w.a.id, w.b1, near.id, { lot: 'N1', expiry: plus(89), buckets: { available: 100 } });
    await makeBatch(w.a.id, w.b1, far.id, { lot: 'F1', expiry: plus(91), buckets: { available: 100 } });
    const got = await pulse();
    expect(got.nearExpiry).toEqual({ count: 1, firstProductName: 'Nearcillin', firstProductId: near.id });
  });

  it('follows the navigation badge: below the reorder level is low, at it is not, no reorder level is never counted', async () => {
    const low = await makeProduct(w.a.id, 'Lowcillin');
    const edge = await makeProduct(w.a.id, 'Edgecillin');
    const plain = await makeProduct(w.a.id, 'Plaincillin');
    await makeBatch(w.a.id, w.b1, low.id, { lot: 'L9', buckets: { available: 19 } });
    await makeBatch(w.a.id, w.b1, edge.id, { lot: 'E9', buckets: { available: 20 } });
    await makeBatch(w.a.id, w.b1, plain.id, { lot: 'P9', buckets: { available: 1 } });
    for (const p of [low, edge]) await prisma().phProductBranch.create({ data: { restaurantId: w.a.id, branchId: w.b1, productId: p.id, minQty: 20 } });
    const got = await pulse();
    expect(got.lowStock).toEqual({ count: 1, firstProductName: 'Lowcillin', firstProductId: low.id });
    const badge = dataOf(await ask(w.owner, navQueries.navCounts, { ...at(), now: NOW })) as { lowStock: number };
    expect(got.lowStock.count).toBe(badge.lowStock);
  });

  it('ignores other branches', async () => {
    const other = await makeProduct(w.a.id, 'Elsewhere');
    await makeBatch(w.a.id, w.b2, other.id, { lot: 'S2', buckets: { available: 1 } });
    await prisma().phProductBranch.create({ data: { restaurantId: w.a.id, branchId: w.b2, productId: other.id, minQty: 10 } });
    expect((await pulse()).lowStock.count).toBe(0);
    expect((await pulse(w.owner, w.b2)).lowStock.firstProductName).toBe('Elsewhere');
  });

  it('is empty when nothing is near expiry or low', async () => {
    const got = await pulse();
    expect(got.nearExpiry).toEqual({ count: 0, firstProductName: null, firstProductId: null });
    expect(got.lowStock).toEqual({ count: 0, firstProductName: null, firstProductId: null });
  });
});

describe('usdRate setting', () => {
  it('defaults to 1450 and is saved by the owner alone, validated as a whole number from 1 to 1,000,000', async () => {
    expect((await pulse()).usdRate).toBe(1450);
    const version = (await prisma().phSettings.findFirstOrThrow({ where: { restaurantId: w.a.id } })).version;
    for (const bad of [0, -5, 1.5, 1_000_001, '1450x']) {
      expect(codeOf(await act(w.owner, exchangeRateActions.set, { ...at(), usdRate: bad, version })), String(bad)).toBe('INVALID');
    }
    for (const who of [w.manager, w.cashier, w.accountant, w.stockClerk]) {
      expect(codeOf(await act(who, exchangeRateActions.set, { ...at(), usdRate: 1500, version })), who.userId).toBe('FORBIDDEN');
    }
    expect(dataOf(await act(w.pharmacist, exchangeRateActions.set, { ...at(), usdRate: 1480, version }))).toEqual({ usdRate: 1480, version: version + 1 });
    expect(dataOf(await act(w.pic, exchangeRateActions.set, { ...at(), usdRate: 1490, version: version + 1 }))).toEqual({ usdRate: 1490, version: version + 2 });
    const saved = dataOf(await act(w.owner, exchangeRateActions.set, { ...at(), usdRate: 1500, version: version + 2 })) as { usdRate: number; version: number };
    expect(saved).toEqual({ usdRate: 1500, version: version + 3 });
    expect((await pulse(w.cashier)).usdRate).toBe(1500);
    expect(codeOf(await act(w.owner, exchangeRateActions.set, { ...at(), usdRate: 1600, version }))).toBe('CONFLICT');
    expect((await pulse()).usdRate).toBe(1500);
  });
});
