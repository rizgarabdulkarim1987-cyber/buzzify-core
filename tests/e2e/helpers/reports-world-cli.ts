/**
 * The report screens' world for the end-to-end run, built through the REAL pharmacy services (sales, returns, transfers, stock
 * movements) as the people who would do each step. It runs with tsx in a child process (like studio-cli.ts: Playwright's loader
 * cannot load the services' imports) and reads a JSON argument:
 *   { restaurantId, branchA, branchB, owner, mgrA, cashierA, suffix }
 * It prints one line `WORLD {...}` with the ids and the hand figures the spec compares the screens to.
 *
 * The world (all today, Baghdad; no discount rounding):
 *   P tablet 100 IQD / strip (10) 900 IQD, 100 / 900 cents USD; cost 705 IQD per strip at A (batch PB1), 600 at B (PB2).
 *   Q tablet 250 / strip (10) 2000 IQD, no cost (QB1 at A).
 *   A: S1 2 strips P = 1800 IQD cash; S2 3 tablets P with 15 off = 285 IQD card; S4 2 tablets P in USD = 2.00 USD card;
 *      S5 1 strip Q = 2000 IQD; a return of 5 tablets of S1 = 450 IQD cash.   B: S3 5 tablets P = 500 IQD cash.
 *   Transfers: T1 A to B 12 tablets of P, requested and sent; T2 B to A 20 tablets of P, requested only.
 *   Damage: 3 tablets of PB2 at B.
 */
import { randomUUID } from 'node:crypto';
import { createPrisma } from '@/server/data/prisma';
import { scopedClient } from '@/server/data/tenant-db';
import { searchTextOf } from '@/server/domain/pharmacy/product-identity';
import * as returnActions from '@/server/pharmacy/actions/returns';
import * as saleActions from '@/server/pharmacy/actions/sales';
import * as stockActions from '@/server/pharmacy/actions/stock';
import * as transferActions from '@/server/pharmacy/actions/transfers';
import { applyMovement } from '@/server/pharmacy/stock';
import { loadActor, type Actor } from '@/server/studio/auth/actor';
import { runAction, type ActionDef } from '@/server/studio/framework/action';
import type { ActionResult } from '@/server/studio/framework/result';
import { DEV_DB, databaseUrl } from '../../../scripts/db-config';

const input = JSON.parse(process.argv[2] ?? '{}') as { restaurantId: string; branchA: string; branchB: string; owner: string; mgrA: string; cashierA: string; suffix: string };
const prisma = createPrisma(databaseUrl(DEV_DB));
const DAY = 86_400_000;
const dateIn = (days: number) => new Date(Date.now() + days * DAY).toISOString().slice(0, 10);
const { restaurantId, branchA: A, branchB: B } = input;
const key = (label: string) => `${label}-${randomUUID()}`;

async function act<I, O>(userId: string, def: ActionDef<I, O>, raw: unknown): Promise<O> {
  const actor = (await loadActor(prisma, userId)) as Actor;
  const result: ActionResult<O> = await runAction(prisma, actor, def, raw, { ip: '203.0.113.19', userAgent: 'e2e' });
  if (!result.ok) throw new Error(`${def.name} refused: ${result.error.code} ${result.error.message} ${JSON.stringify(result.error.fields)}`);
  return result.data;
}

async function product(name: string, categoryName: string) {
  const category = await prisma.phCategory.create({ data: { restaurantId, name: categoryName, nameKey: categoryName.toLowerCase() }, select: { id: true } });
  const row = await prisma.phProduct.create({
    data: {
      restaurantId,
      tradeName: name,
      categoryId: category.id,
      identityKey: `${name}|${restaurantId}`,
      searchText: searchTextOf({ tradeName: name, genericName: '', activeIngredient: '', strength: '', form: '', manufacturer: '' }),
    },
    select: { id: true },
  });
  const tablet = await prisma.phProductUnit.create({ data: { restaurantId, productId: row.id, level: 0, label: 'tablet', baseQty: 1 }, select: { id: true } });
  const strip = await prisma.phProductUnit.create({ data: { restaurantId, productId: row.id, level: 1, label: 'strip', baseQty: 10 }, select: { id: true } });
  return { id: row.id, tablet: tablet.id, strip: strip.id, category: category.id };
}

const scoped = scopedClient(prisma, { restaurantId, allBranches: true });
async function batch(branchId: string, productId: string, lot: string, expiry: string, available: number, cost?: { minor: bigint; unitId: string }) {
  const made = await prisma.phBatch.create({
    data: { restaurantId, productId, lot, expiryDate: new Date(`${expiry}T00:00:00.000Z`), ...(cost ? { unitCostMinor: cost.minor, costCurrency: 'IQD' as const, costUnitId: cost.unitId } : {}) },
    select: { id: true },
  });
  await scoped.$transaction(async (tx) => {
    await applyMovement(tx, { restaurantId, branchId, batchId: made.id, userId: 'seed', type: 'RECEIPT', deltas: { available }, reason: '' });
  });
  return made.id;
}

const money = (productRow: { id: string; tablet: string; strip: string }, currency: 'IQD' | 'USD', tablet: bigint, strip: bigint) =>
  prisma.phPrice.createMany({
    data: [
      { restaurantId, productId: productRow.id, unitId: productRow.tablet, branchId: null, currency, amountMinor: tablet, validFrom: new Date('2026-01-01T00:00:00.000Z'), changedById: 'seed' },
      { restaurantId, productId: productRow.id, unitId: productRow.strip, branchId: null, currency, amountMinor: strip, validFrom: new Date('2026-01-01T00:00:00.000Z'), changedById: 'seed' },
    ],
  });

async function sell(userId: string, branchId: string, currency: 'IQD' | 'USD', lines: unknown[], payments: unknown[]) {
  const made = await act(userId, saleActions.create, { restaurantId, branchId, clientKey: key('sale'), currency, lines, payments });
  const row = await prisma.phSale.findUniqueOrThrow({ where: { id: (made as { id: string }).id }, include: { lines: true } });
  return { id: row.id, number: (made as { number: string }).number, lineId: row.lines[0]!.id };
}
const pay = (method: 'CASH' | 'CARD_MANUAL', amountMinor: bigint) => ({ method, amountMinor, clientKey: key('pay') });

try {
  await prisma.phSettings.create({ data: { restaurantId, enabledCurrencies: ['IQD', 'USD'] } });
  const P = await product(`Panadol ${input.suffix}`, 'Pain');
  const Q = await product(`Aspirin ${input.suffix}`, 'Cold');
  await money(P, 'IQD', 100n, 900n);
  await money(P, 'USD', 100n, 900n);
  await money(Q, 'IQD', 250n, 2000n);
  for (const [userId, branchId, currency] of [[input.cashierA, A, 'IQD'], [input.mgrA, A, 'USD'], [input.owner, B, 'IQD']] as const) {
    await prisma.phShift.create({ data: { restaurantId, branchId, userId, currency, openingFloatMinor: 0n } });
  }
  const pb1 = await batch(A, P.id, 'PB1', dateIn(20), 200, { minor: 705n, unitId: P.strip });
  const pb2 = await batch(B, P.id, 'PB2', dateIn(45), 200, { minor: 600n, unitId: P.strip });
  const qb1 = await batch(A, Q.id, 'QB1', dateIn(400), 100);
  await prisma.phProductBranch.createMany({
    data: [
      { restaurantId, branchId: A, productId: P.id, minQty: 200, reorderQty: 100 },
      { restaurantId, branchId: B, productId: P.id, minQty: 100, reorderQty: 10 },
    ],
  });

  const s1 = await sell(input.cashierA, A, 'IQD', [{ productId: P.id, unitId: P.strip, qty: 2 }], [pay('CASH', 2000n)]);
  await sell(input.cashierA, A, 'IQD', [{ productId: P.id, unitId: P.tablet, qty: 3, discount: { kind: 'amount', value: 15n, reason: 'Loyal customer' } }], [pay('CARD_MANUAL', 285n)]);
  await sell(input.owner, B, 'IQD', [{ productId: P.id, unitId: P.tablet, qty: 5 }], [pay('CASH', 500n)]);
  await sell(input.mgrA, A, 'USD', [{ productId: P.id, unitId: P.tablet, qty: 2 }], [pay('CARD_MANUAL', 200n)]);
  await sell(input.cashierA, A, 'IQD', [{ productId: Q.id, unitId: Q.strip, qty: 1 }], [pay('CASH', 2000n)]);
  // A return needs an open shift in the sale's currency and the right to return: the owner moves from B (shift closed) to A.
  await prisma.phShift.updateMany({ where: { restaurantId, userId: input.owner, branchId: B }, data: { status: 'CLOSED', closedAt: new Date() } });
  await prisma.phShift.create({ data: { restaurantId, branchId: A, userId: input.owner, currency: 'IQD', openingFloatMinor: 0n } });
  await act(input.owner, returnActions.create, { restaurantId, branchId: A, saleId: s1.id, lines: [{ saleLineId: s1.lineId, baseQty: 5 }], reason: 'Damaged box', refundMethod: 'CASH', clientKey: key('ret') });

  const t1 = (await act(input.owner, transferActions.request, { restaurantId, clientKey: key('req'), fromBranchId: A, toBranchId: B, lines: [{ productId: P.id, qty: 12 }] })) as { id: string; version: number };
  await act(input.owner, transferActions.send, { restaurantId, transferId: t1.id, version: t1.version, clientKey: key('send') });
  const t2 = (await act(input.owner, transferActions.request, { restaurantId, clientKey: key('req'), fromBranchId: B, toBranchId: A, lines: [{ productId: P.id, qty: 20 }] })) as { id: string };
  await act(input.owner, stockActions.damage, { restaurantId, branchId: B, batchId: pb2, fromBucket: 'available', baseQty: 3, reason: 'Broken in storage' });

  console.log(`WORLD ${JSON.stringify({ productP: P.id, productQ: Q.id, pb1, pb2, qb1, t1: t1.id, t2: t2.id, s1: s1.number, names: { P: `Panadol ${input.suffix}`, Q: `Aspirin ${input.suffix}` } })}`);
} finally {
  await prisma.$disconnect();
}
