import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as chain from '@/server/pharmacy/queries/chain';
import * as reports from '@/server/pharmacy/queries/reports';
import { NOW, person, prisma, resetWorld, useTestDatabase } from './fixture';
import { ask } from './stock-helpers';
import { at, dataOf, marginTruth } from './reports-world';
import { buildChain, type ChainBiz } from './chain-world';
import { expiryTruth, instantsOf, lowStockTruth, openTransfersTruth, salesTruth, stockTruth } from './chain-truth';

/* eslint-disable @typescript-eslint/no-explicit-any -- the dashboard is read off the wire and checked by value */

/**
 * The chain dashboard (phase 6, task 5; R6-8, R6-10): per-branch cards, a total of the branches the person sees from the same
 * aggregates, and the branch comparison. Every figure is checked against plain code over the rows (chain-truth.ts), three
 * branches, two currencies. See chain-world.ts for the world.
 */

let w: ChainBiz;
const PERIOD = { from: '2026-10-27', to: '2026-10-28' };
const TODAY = '2026-10-27';

beforeAll(async () => {
  useTestDatabase();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  await resetWorld();
  w = await buildChain('A');
}, 240_000);
afterAll(() => {
  vi.useRealTimers();
});

const dash = async (who: Parameters<typeof ask>[0], extra: Record<string, unknown> = {}) => ask(who, chain.dashboard, { ...at(w), ...PERIOD, ...extra });
const money = (v: string) => BigInt(v);
const sum = <T>(items: T[], pick: (t: T) => bigint) => items.reduce((n, t) => n + pick(t), 0n);

describe('who sees the dashboard', () => {
  it('the owner reads it all; the accountant (b1 and b2) gets those two and the answer names what the total covers', async () => {
    const r = dataOf(await dash(w.owner)) as any;
    expect([...r.scope.branchIds].sort()).toEqual([w.b1, w.b2, w.b3].sort());
    expect(r.scope.isAllBranches).toBe(true);
    expect(r.branches.map((b: any) => b.branchId)).toEqual([w.b1, w.b2, w.b3]);
    const acc = dataOf(await dash(w.accountant)) as any;
    expect([...acc.scope.branchIds].sort()).toEqual([w.b1, w.b2].sort());
    expect(acc.scope.isAllBranches).toBe(false);
  });

  it('a person who sees one branch gets a typed refusal with a message, not an empty page', async () => {
    const result = await dash(w.manager1);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.fields?.phCode).toBe('CHAIN_NEEDS_MANY_BRANCHES');
      expect(result.error.message.length).toBeGreaterThan(10);
    }
  });

  it('a cashier, a pharmacist and a stock keeper are refused', async () => {
    for (const who of [w.cashier1, w.pharmacist, w.stockP]) {
      const result = await dash(who);
      expect(result.ok ? 'OK' : result.error.code, 'role').toBe('FORBIDDEN');
    }
  });

  it('a person who sees two of the three branches gets those two and their total, and no trace of the third', async () => {
    const r = dataOf(await dash(w.manager13)) as any;
    expect([...r.scope.branchIds].sort()).toEqual([w.b1, w.b3].sort());
    expect(r.scope.isAllBranches).toBe(false);
    expect(r.branches.map((b: any) => b.branchId).sort()).toEqual([w.b1, w.b3].sort());
    // (transfers name both of their ends, but the answer never names an end the person cannot see)
    expect(JSON.stringify(r)).not.toContain(w.b2);
  });

  it('another business sees none of this one', async () => {
    const restaurant = await prisma().restaurant.create({ data: { name: 'Other' }, select: { id: true } });
    const other = await person('ownerOther', { membership: [restaurant.id, 'OWNER'] });
    const result = await ask(other, chain.dashboard, { restaurantId: w.a.id, ...PERIOD });
    expect(result.ok).toBe(false);
  });
});

describe('sales: total equals the sum of the branches, both equal the rows', () => {
  it('per branch and currency: count, gross, discounts, sales, refunds, net', async () => {
    const r = dataOf(await dash(w.owner)) as any;
    const truth = await salesTruth(w.a.id, [w.b1, w.b2, w.b3], PERIOD.from, PERIOD.to);
    for (const [k, f] of truth) {
      const [branchId, currency] = k.split('|');
      const card = r.branches.find((b: any) => b.branchId === branchId).sales.find((s: any) => s.currency === currency);
      expect(card, k).toBeDefined();
      expect([card.count, money(card.grossMinor), money(card.discountMinor), money(card.salesMinor), money(card.refundsMinor), money(card.netMinor)], k).toEqual([f.count, f.gross, f.discount, f.sales, f.refunds, f.sales - f.refunds]);
    }
    // a card does not invent sales: as many card rows as truth rows
    expect(r.branches.reduce((n: number, b: any) => n + b.sales.length, 0)).toBe(truth.size);
    for (const currency of ['IQD', 'USD']) {
      const t = r.total.sales.find((s: any) => s.currency === currency);
      const parts = [...truth].filter(([k]) => k.endsWith(`|${currency}`)).map(([, f]) => f);
      expect(t.count).toBe(parts.reduce((n, f) => n + f.count, 0));
      expect(money(t.salesMinor)).toBe(sum(parts, (f) => f.sales));
      expect(money(t.refundsMinor)).toBe(sum(parts, (f) => f.refunds));
      expect(money(t.netMinor)).toBe(sum(parts, (f) => f.sales - f.refunds));
      expect(money(t.discountMinor)).toBe(sum(parts, (f) => f.discount));
      expect(money(t.grossMinor)).toBe(sum(parts, (f) => f.gross));
    }
  });

  it('the world is not trivial: the three branches and both currencies all have sales, there are refunds and discounts', async () => {
    const r = dataOf(await dash(w.owner)) as any;
    expect(r.branches.every((b: any) => b.sales.length >= 1)).toBe(true);
    expect(r.total.sales.map((s: any) => s.currency)).toEqual(['IQD', 'USD']);
    expect(r.branches.some((b: any) => b.sales.some((s: any) => money(s.refundsMinor) > 0n))).toBe(true);
    expect(r.branches.some((b: any) => b.sales.some((s: any) => money(s.discountMinor) > 0n))).toBe(true);
  });

  it('the limited person gets the total of their two branches only', async () => {
    const r = dataOf(await dash(w.manager13)) as any;
    const truth = await salesTruth(w.a.id, [w.b1, w.b3], PERIOD.from, PERIOD.to);
    for (const currency of ['IQD', 'USD']) {
      const parts = [...truth].filter(([k]) => k.endsWith(`|${currency}`)).map(([, f]) => f);
      expect(money(r.total.sales.find((s: any) => s.currency === currency).netMinor)).toBe(sum(parts, (f) => f.sales - f.refunds));
    }
    const all = dataOf(await dash(w.owner)) as any;
    expect(r.total.sales.find((s: any) => s.currency === 'IQD').netMinor).not.toBe(all.total.sales.find((s: any) => s.currency === 'IQD').netMinor);
  });

  it('a currency filter keeps one currency in every card and in the total', async () => {
    const r = dataOf(await dash(w.owner, { currency: 'USD' })) as any;
    expect(r.total.sales.map((s: any) => s.currency)).toEqual(['USD']);
    expect(r.branches.every((b: any) => b.sales.every((s: any) => s.currency === 'USD'))).toBe(true);
  });
});

describe('margin: the estimated figure, with the same consolidation', () => {
  it('per branch equals the plain-code margin, total equals it too, left-out counts add up', async () => {
    const r = dataOf(await dash(w.owner)) as any;
    const { start, end } = instantsOf(PERIOD.from, PERIOD.to);
    const truth = await marginTruth(w.a.id, [w.b1, w.b2, w.b3], start, end);
    const per = await Promise.all([w.b1, w.b2, w.b3].map((b) => marginTruth(w.a.id, [b], start, end)));
    expect(r.estimatedMargin).toBe(true);
    for (const [i, b] of [w.b1, w.b2, w.b3].entries()) {
      const card = r.branches.find((x: any) => x.branchId === b).margin;
      for (const [cur, v] of per[i]!.totals) {
        const m = card.find((x: any) => x.currency === cur);
        expect([money(m.netMinor), money(m.costMinor)], `${b} ${cur}`).toEqual([v.net, v.cost]);
      }
    }
    for (const [cur, v] of truth.totals) {
      const t = r.total.margin.find((x: any) => x.currency === cur);
      expect([money(t.netMinor), money(t.costMinor)]).toEqual([v.net, v.cost]);
    }
    const sumOf = (rows: any[], key: string) => rows.reduce((n, m) => n + m[key], 0);
    expect(sumOf(r.total.margin, 'incompleteCostRows')).toBe(truth.nulls);
    expect(sumOf(r.total.margin, 'mixedCurrencyRows')).toBe(truth.mixed);
    expect(truth.nulls).toBeGreaterThan(0);
    expect(truth.mixed).toBeGreaterThan(0);
  });
});

describe('stock value, expiry, low stock', () => {
  it('stock: buckets and value per branch are the balances at batch cost; the total is the sum; items without cost are flagged', async () => {
    const r = dataOf(await dash(w.owner)) as any;
    const truth = await stockTruth(w.a.id, [w.b1, w.b2, w.b3]);
    for (const [branchId, f] of truth) {
      const card = r.branches.find((b: any) => b.branchId === branchId).stock;
      expect([card.available, card.reserved, card.quarantine, card.damaged], branchId).toEqual([f.available, f.reserved, f.quarantine, f.damaged]);
      for (const [cur, v] of f.values) expect(money(card.values.find((x: any) => x.currency === cur).valueMinor), `${branchId} ${cur}`).toBe(v);
      expect(card.noCostRows).toBe(f.noCost);
      expect(card.valuationComplete).toBe(f.noCost === 0);
    }
    for (const cur of ['IQD', 'USD'] as const) {
      const expected = sum([...truth.values()], (f) => f.values.get(cur) ?? 0n);
      expect(money(r.total.stock.values.find((x: any) => x.currency === cur).valueMinor)).toBe(expected);
    }
    expect(r.total.stock.available).toBe([...truth.values()].reduce((n, f) => n + f.available, 0));
    expect(r.total.stock.valuationComplete).toBe(false);
  });

  it('expiring soon: expired and within 30 days, units per branch and in total', async () => {
    const r = dataOf(await dash(w.owner)) as any;
    const truth = await expiryTruth(w.a.id, [w.b1, w.b2, w.b3], TODAY);
    for (const [branchId, f] of truth) {
      const card = r.branches.find((b: any) => b.branchId === branchId).expiry;
      expect([card.expired.units, card.d30.units], branchId).toEqual([f.expired, f.d30]);
    }
    expect(r.total.expiry.expired.units).toBe([...truth.values()].reduce((n, f) => n + f.expired, 0));
    expect(r.total.expiry.d30.units).toBe([...truth.values()].reduce((n, f) => n + f.d30, 0));
    expect(r.total.expiry.expired.units).toBeGreaterThan(0);
    expect(r.total.expiry.d30.units).toBeGreaterThan(0);
  });

  it('low stock: the count per branch and in total', async () => {
    const r = dataOf(await dash(w.owner)) as any;
    const truth = await lowStockTruth(w.a.id, [w.b1, w.b2, w.b3], TODAY);
    for (const b of [w.b1, w.b2, w.b3]) expect(r.branches.find((x: any) => x.branchId === b).lowStock, b).toBe(truth.get(b) ?? 0);
    expect(r.total.lowStock).toBe([...truth.values()].reduce((n, c) => n + c, 0));
    expect(r.total.lowStock).toBeGreaterThanOrEqual(2);
  });
});

describe('transfers: a transfer touches two branches and the total counts it once', () => {
  it('in transit units and open transfers: incoming under the destination, outgoing under the sender, the total once', async () => {
    const r = dataOf(await dash(w.owner)) as any;
    const open = await openTransfersTruth(w.a.id);
    const sent = open.filter((t) => t.status === 'SENT');
    expect(sent.length).toBe(3);
    expect(r.total.transit).toEqual({ units: sent.reduce((n, t) => n + t.units, 0), transfers: sent.length });
    expect(r.total.openTransfers).toEqual({ requested: open.filter((t) => t.status === 'REQUESTED').length, sent: sent.length });
    for (const b of [w.b1, w.b2, w.b3]) {
      const card = r.branches.find((x: any) => x.branchId === b);
      const side = (list: typeof sent, key: 'from' | 'to') => ({ units: list.filter((t) => t[key] === b).reduce((n, t) => n + t.units, 0), transfers: list.filter((t) => t[key] === b).length });
      expect(card.transit, b).toEqual({ incoming: side(sent, 'to'), outgoing: side(sent, 'from') });
      const count = (status: string, key: 'from' | 'to') => open.filter((t) => t.status === status && t[key] === b).length;
      expect(card.openTransfers, b).toEqual({ incoming: { requested: count('REQUESTED', 'to'), sent: count('SENT', 'to') }, outgoing: { requested: count('REQUESTED', 'from'), sent: count('SENT', 'from') } });
    }
    // The point of "once": adding the cards' incoming AND outgoing would count every transfer twice.
    const bothSides = r.branches.reduce((n: number, b: any) => n + b.transit.incoming.units + b.transit.outgoing.units, 0);
    expect(bothSides).toBe(2 * r.total.transit.units);
    expect(r.total.transit.units).toBeGreaterThan(0);
  });

  it("the total is the valuation report's own in-transit figure", async () => {
    const r = dataOf(await dash(w.owner)) as any;
    const valuation = dataOf(await ask(w.owner, reports.stockValuationQuery, { ...at(w) })) as any;
    expect(r.total.transit.units).toBe(valuation.inTransit.units);
  });

  it('a transfer from a branch the person sees to one they do not is counted once in their total and shown only at their own end', async () => {
    const r = dataOf(await dash(w.manager13)) as any;
    const mine = [w.b1, w.b3];
    const open = (await openTransfersTruth(w.a.id)).filter((t) => mine.includes(t.from) || mine.includes(t.to));
    const sent = open.filter((t) => t.status === 'SENT');
    expect(r.total.transit).toEqual({ units: sent.reduce((n, t) => n + t.units, 0), transfers: sent.length });
    const fromB2 = sent.find((t) => t.from === w.b2 && t.to === w.b3)!;
    expect(fromB2.units).toBeGreaterThan(0);
    expect(r.branches.find((x: any) => x.branchId === w.b3).transit.incoming.units).toBe(sent.filter((t) => t.to === w.b3).reduce((n, t) => n + t.units, 0));
  });
});

describe('comparison: the same figures, ranked by net sales within each currency', () => {
  it('ranks every visible branch per currency, highest first, a branch without sales included with zero', async () => {
    const r = dataOf(await dash(w.owner, { from: '2026-10-28', to: '2026-10-28' })) as any;
    expect(r.comparison.map((g: any) => g.currency)).toEqual(['IQD', 'USD']);
    for (const group of r.comparison) {
      expect(group.rows.map((x: any) => x.branchId).sort()).toEqual([w.b1, w.b2, w.b3].sort());
      const nets = group.rows.map((x: any) => money(x.netMinor));
      expect([...nets].sort((a: bigint, b: bigint) => (a > b ? -1 : a < b ? 1 : 0))).toEqual(nets);
      expect(group.rows[0].rank).toBe(1);
      for (const [i, row] of group.rows.entries()) expect(row.rank, `${group.currency} ${row.branchId}`).toBe(nets.findIndex((n: bigint) => n === nets[i]) + 1);
      for (const row of group.rows) {
        const card = r.branches.find((b: any) => b.branchId === row.branchId).sales.find((s: any) => s.currency === group.currency);
        expect(money(row.netMinor)).toBe(card ? money(card.netMinor) : 0n);
      }
    }
    // the USD sales of that day: branch 2 and branch 3 sold, branch 1 did not
    const usd = r.comparison.find((g: any) => g.currency === 'USD').rows;
    expect(usd.some((x: any) => money(x.netMinor) === 0n)).toBe(true);
  });
});

describe('the window', () => {
  it('defaults to the last 30 Baghdad days and refuses more than a year', async () => {
    const r = dataOf(await ask(w.owner, chain.dashboard, { ...at(w) })) as any;
    expect([r.from, r.to]).toEqual(['2026-09-28', '2026-10-27']);
    const long = await ask(w.owner, chain.dashboard, { ...at(w), from: '2025-01-01', to: '2026-10-27' });
    expect(long.ok).toBe(false);
  });
});
