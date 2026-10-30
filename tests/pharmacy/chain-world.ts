import { vi } from 'vitest';
import * as transferActions from '@/server/pharmacy/actions/transfers';
import { NOW, person, prisma } from './fixture';
import { act } from './stock-helpers';
import { batch, build, dataOf, key, sell, shift, cash, card, type Biz } from './reports-world';

/**
 * The three-branch world of the chain tests (phase 6, task 5): the common report world (two branches, IQD and USD, two sold days,
 * a return, transfers) plus a third branch with its own staff, stock, sales and transfers. Clock: the world ends at NOW
 * (2026-10-27 09:00 UTC); the third branch sells on 2026-10-28.
 *
 * Added by this file (b1 and b2 as in reports-world.ts):
 *   b3 stock: P batch B3P (200 base, 705/strip IQD), Q batch B3Q (100 base, no cost)
 *   b3 sales 2026-10-28 (Baghdad): 3 strips of P in IQD , 2 strips of Q in IQD (no cost), 1 strip P in USD (IQD-cost batch)
 *   expiring batches: E1 b1 expired (2026-10-01), E2 b2 +14 days, E3 b1 +45 days, E4 b2 +75 days, E5 b3 +9 days (6 units, sent away whole by T4: first expiry first)
 *   transfers added: T4 b3 -> b1 SENT (7 of P), T5 b1 -> b3 REQUESTED (4 of Q), T6 b2 -> b3 SENT (3 of P from PB2)
 */

export interface ChainBiz extends Biz {
  b3: string;
  cashier3: Awaited<ReturnType<typeof person>>;
  usd3: Awaited<ReturnType<typeof person>>;
  /** Works in b1 and b3. */
  manager13: Awaited<ReturnType<typeof person>>;
}

export async function buildChain(label: string): Promise<ChainBiz> {
  const base = await build(label, true);
  vi.setSystemTime(NOW);
  const b3 = (await prisma().branch.create({ data: { restaurantId: base.a.id, name: `${label} branch 3`, sortOrder: 2 }, select: { id: true } })).id;
  const staff = async (name: string, role: 'CASHIER' | 'BRANCH_MANAGER', branches: string[]) => {
    const who = await person(`${name}${label}`, { staff: [base.a.id, role, branches] });
    return who;
  };
  const w: ChainBiz = {
    ...base,
    b3,
    cashier3: await staff('cashier3', 'CASHIER', [b3]),
    usd3: await staff('usd3', 'CASHIER', [b3]),
    manager13: await staff('manager13', 'BRANCH_MANAGER', [base.b1, b3]),
  };
  await shift(w.a.id, b3, w.cashier3);
  await shift(w.a.id, b3, w.usd3, 'USD');

  const strip = w.P.strip;
  const b3p = await batch(w.a.id, b3, w.P.id, { lot: 'B3P', available: 200, cost: { minor: 705n, currency: 'IQD', unitId: strip } });
  const b3q = await batch(w.a.id, b3, w.Q.id, { lot: 'B3Q', available: 100 });
  w.ids.b3p = b3p;
  w.ids.b3q = b3q;
  await batch(w.a.id, w.b1, w.P.id, { lot: 'E1', expiry: '2026-10-01', available: 10, cost: { minor: 200n, currency: 'IQD', unitId: strip } });
  await batch(w.a.id, w.b2, w.P.id, { lot: 'E2', expiry: '2026-11-10', available: 20, cost: { minor: 300n, currency: 'IQD', unitId: strip } });
  await batch(w.a.id, w.b1, w.Q.id, { lot: 'E3', expiry: '2026-12-11', available: 8 });
  await batch(w.a.id, w.b2, w.Q.id, { lot: 'E4', expiry: '2027-01-10', available: 5, cost: { minor: 400n, currency: 'USD', unitId: w.Q.strip } });
  await batch(w.a.id, b3, w.P.id, { lot: 'E5', expiry: '2026-11-05', available: 6, cost: { minor: 100n, currency: 'IQD', unitId: strip } });
  await prisma().phProductBranch.createMany({
    data: [
      { restaurantId: w.a.id, branchId: b3, productId: w.P.id, minQty: 500, reorderQty: 100 },
      { restaurantId: w.a.id, branchId: b3, productId: w.Q.id, minQty: 10, reorderQty: 10 },
    ],
  });

  vi.setSystemTime(new Date('2026-10-28T08:00:00.000Z'));
  const str = (p: Biz['P'], qty: number) => ({ productId: p.id, unitId: p.strip, qty });
  await sell(w, w.cashier3, b3, 'IQD', [str(w.P, 3)], [cash(2700n)]);
  await sell(w, w.cashier3, b3, 'IQD', [str(w.Q, 2)], [card(4000n)]);
  await sell(w, w.usd3, b3, 'USD', [str(w.P, 1)], [card(900n)]);

  vi.setSystemTime(NOW);
  const place = { restaurantId: w.a.id };
  const request = async (from: string, to: string, productId: string, qty: number, send: boolean) => {
    const t = dataOf(await act(w.owner, transferActions.request, { ...place, clientKey: key('req'), fromBranchId: from, toBranchId: to, lines: [{ productId, qty }] }));
    if (send) dataOf(await act(w.owner, transferActions.send, { ...place, transferId: t.id, version: t.version, clientKey: key('send') }));
    return t.id as string;
  };
  w.ids.t4 = await request(b3, w.b1, w.P.id, 7, true);
  w.ids.t5 = await request(w.b1, b3, w.Q.id, 4, false);
  w.ids.t6 = await request(w.b2, b3, w.P.id, 3, true);
  return w;
}
