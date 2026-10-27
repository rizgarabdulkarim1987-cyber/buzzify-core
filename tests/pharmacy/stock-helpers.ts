import { expect } from 'vitest';
import { scopedClient } from '@/server/data/tenant-db';
import { searchTextOf } from '@/server/domain/pharmacy/product-identity';
import { applyMovement } from '@/server/pharmacy/stock';
import { loadActor, type Actor } from '@/server/studio/auth/actor';
import { runAction, type ActionDef } from '@/server/studio/framework/action';
import { runQuery, type QueryDef } from '@/server/studio/framework/query';
import type { ActionResult } from '@/server/studio/framework/result';
import { prisma, type Person } from './fixture';

export const META = { ip: '203.0.113.19', userAgent: 'vitest' };
export const codeOf = (result: ActionResult<unknown>) => (result.ok ? 'OK' : result.error.code);
export const phCodeOf = (result: ActionResult<unknown>) => (result.ok ? 'OK' : (result.error.fields?.phCode ?? result.error.code));
const actorOf = async (who: Person): Promise<Actor> => (await loadActor(prisma(), who.userId)) as Actor;
export const act = async <I, O>(who: Person, def: ActionDef<I, O>, input: unknown) => runAction(prisma(), await actorOf(who), def, input, META);
export const ask = async <I, O>(who: Person, def: QueryDef<I, O>, input: unknown) => runQuery(prisma(), await actorOf(who), def, input);
export const dataOf = <T>(result: ActionResult<T>): T => {
  if (!result.ok) throw new Error(`expected OK, got ${result.error.code}: ${result.error.message} ${JSON.stringify(result.error.fields)}`);
  return result.data;
};
export const refused = (result: ActionResult<unknown>, code: string) => expect(codeOf(result)).toBe(code);

/** A product with a tablet (1) and a strip (10) unit, straight in the database. */
export async function makeProduct(restaurantId: string, tradeName = 'Panadol') {
  const product = await prisma().phProduct.create({
    data: {
      restaurantId,
      tradeName,
      identityKey: `${tradeName}|${restaurantId}`,
      searchText: searchTextOf({ tradeName, genericName: '', activeIngredient: '', strength: '', form: '', manufacturer: '' }),
    },
    select: { id: true },
  });
  const tablet = await prisma().phProductUnit.create({ data: { restaurantId, productId: product.id, level: 0, label: 'tablet', baseQty: 1 }, select: { id: true } });
  const strip = await prisma().phProductUnit.create({ data: { restaurantId, productId: product.id, level: 1, label: 'strip', baseQty: 10 }, select: { id: true } });
  return { id: product.id, tablet: tablet.id, strip: strip.id };
}

type Buckets = Partial<Record<'available' | 'reserved' | 'quarantine' | 'damaged', number>>;

/** A batch with stock in the given buckets of one branch, put there by real RECEIPT/ADJUST movements. */
export async function makeBatch(
  restaurantId: string,
  branchId: string,
  productId: string,
  opts: { lot?: string; expiry?: string; status?: 'ACTIVE' | 'RECALLED' | 'BLOCKED'; buckets?: Buckets; cost?: { unitCostMinor: bigint; costUnitId: string } } = {},
) {
  const batch = await prisma().phBatch.create({
    data: {
      restaurantId,
      productId,
      lot: opts.lot ?? 'L1',
      expiryDate: new Date(`${opts.expiry ?? '2028-03-31'}T00:00:00.000Z`),
      status: opts.status ?? 'ACTIVE',
      ...(opts.cost ? { unitCostMinor: opts.cost.unitCostMinor, costCurrency: 'IQD' as const, costUnitId: opts.cost.costUnitId } : {}),
    },
    select: { id: true },
  });
  await stockInto(restaurantId, branchId, batch.id, opts.buckets ?? {});
  return batch.id;
}

/** Puts stock into a batch in a branch (a RECEIPT, then an ADJUST that spreads it over the other buckets). */
export async function stockInto(restaurantId: string, branchId: string, batchId: string, buckets: Buckets) {
  const b = { available: 0, reserved: 0, quarantine: 0, damaged: 0, ...buckets };
  const scoped = scopedClient(prisma(), { restaurantId, allBranches: true });
  await scoped.$transaction(async (tx) => {
    const base = { restaurantId, branchId, batchId, userId: 'seed' };
    const total = b.available + b.reserved + b.quarantine + b.damaged;
    if (total > 0) await applyMovement(tx, { ...base, type: 'RECEIPT', deltas: { available: total }, reason: '' });
    const others = b.reserved + b.quarantine + b.damaged;
    if (others > 0) {
      await applyMovement(tx, { ...base, type: 'ADJUST', deltas: { available: -others, reserved: b.reserved, quarantine: b.quarantine, damaged: b.damaged }, reason: 'seed' });
    }
  });
}

export const balanceOf = (batchId: string, branchId: string) =>
  prisma().phStockBalance.findFirst({ where: { batchId, branchId }, select: { available: true, reserved: true, quarantine: true, damaged: true } });
