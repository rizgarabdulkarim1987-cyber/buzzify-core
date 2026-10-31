import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { deleteBillingRows } from '../helpers/db';
import { searchTextOf } from '@/server/domain/pharmacy/product-identity';
import { pharmacy, prisma, resetWorld, useTestDatabase } from './fixture';

const globalForPrisma = globalThis as unknown as { __prisma?: unknown };

beforeAll(() => {
  useTestDatabase();
  delete globalForPrisma.__prisma;
});
afterAll(async () => {
  await prisma().$disconnect();
  delete globalForPrisma.__prisma;
});
beforeEach(resetWorld);

const EXPIRY = new Date('2027-03-31T00:00:00.000Z');

/** A business with a product, its base unit and one batch. */
async function stocked(name = 'A') {
  const biz = await pharmacy(name);
  const product = await prisma().phProduct.create({
    data: {
      restaurantId: biz.id,
      tradeName: 'Panadol',
      identityKey: `paracetamol|500mg|tablet|${name}`,
      searchText: searchTextOf({ tradeName: 'Panadol', genericName: '', activeIngredient: '', strength: '', form: '', manufacturer: '' }),
    },
    select: { id: true },
  });
  const unit = await prisma().phProductUnit.create({
    data: { restaurantId: biz.id, productId: product.id, level: 0, label: 'tablet', baseQty: 1 },
    select: { id: true },
  });
  const batch = await prisma().phBatch.create({
    data: { restaurantId: biz.id, productId: product.id, lot: 'L1', expiryDate: EXPIRY },
    select: { id: true },
  });
  return { biz, productId: product.id, unitId: unit.id, batchId: batch.id };
}

const balance = (s: Awaited<ReturnType<typeof stocked>>, over: Record<string, unknown> = {}) =>
  prisma().phStockBalance.create({
    data: { restaurantId: s.biz.id, branchId: s.biz.branchId, productId: s.productId, batchId: s.batchId, ...over },
    select: { id: true },
  });

const movement = (s: Awaited<ReturnType<typeof stocked>>, over: Record<string, unknown> = {}) =>
  prisma().phStockMovement.create({
    data: {
      restaurantId: s.biz.id,
      branchId: s.biz.branchId,
      productId: s.productId,
      batchId: s.batchId,
      type: 'RECEIPT',
      availableDelta: 5,
      userId: 'actor-1',
      ...over,
    },
    select: { id: true },
  });

describe('the stock balance', () => {
  it.each(['available', 'reserved', 'quarantine', 'damaged'] as const)('refuses a negative %s bucket', async (bucket) => {
    const s = await stocked();
    await expect(balance(s, { [bucket]: -1 })).rejects.toThrow(new RegExp(`PhStockBalance_${bucket}_nonnegative`));
  });

  it('refuses a change that would take a bucket below zero, and allows one that reaches zero', async () => {
    const s = await stocked();
    const row = await balance(s, { available: 3 });
    await expect(prisma().phStockBalance.update({ where: { id: row.id }, data: { available: { decrement: 4 } } })).rejects.toThrow(
      /PhStockBalance_available_nonnegative/,
    );
    await expect(prisma().phStockBalance.update({ where: { id: row.id }, data: { available: { decrement: 3 } } })).resolves.toHaveProperty('available', 0);
  });

  it('holds one row per batch and branch', async () => {
    const s = await stocked();
    await balance(s);
    await expect(balance(s)).rejects.toMatchObject({ code: 'P2002' });
  });

  it("refuses a branch of another business (composite foreign key)", async () => {
    const s = await stocked('A');
    const other = await pharmacy('B');
    await expect(balance(s, { branchId: other.branchId })).rejects.toMatchObject({ code: 'P2003' });
    await expect(movement(s, { branchId: other.branchId })).rejects.toMatchObject({ code: 'P2003' });
    await expect(
      prisma().phReceipt.create({ data: { restaurantId: s.biz.id, branchId: other.branchId, clientKey: 'k', receivedOn: EXPIRY, createdById: 'u' } }),
    ).rejects.toMatchObject({ code: 'P2003' });
    await expect(
      prisma().phStockCount.create({ data: { restaurantId: s.biz.id, branchId: other.branchId, countedById: 'u' } }),
    ).rejects.toMatchObject({ code: 'P2003' });
    await expect(
      prisma().phExpiryAction.create({ data: { restaurantId: s.biz.id, branchId: other.branchId, batchId: s.batchId, updatedById: 'u' } }),
    ).rejects.toMatchObject({ code: 'P2003' });
  });

  it("refuses a batch or product of another business", async () => {
    const s = await stocked('A');
    const other = await stocked('B');
    await expect(balance(s, { batchId: other.batchId })).rejects.toMatchObject({ code: 'P2003' });
    await expect(balance(s, { productId: other.productId })).rejects.toMatchObject({ code: 'P2003' });
  });
});

describe('the batch', () => {
  it('is one row per product, lot and expiry date, whatever the supplier', async () => {
    const s = await stocked();
    const again = (over: Record<string, unknown> = {}) =>
      prisma().phBatch.create({ data: { restaurantId: s.biz.id, productId: s.productId, lot: 'L1', expiryDate: EXPIRY, ...over } });
    await expect(again()).rejects.toMatchObject({ code: 'P2002' });
    await expect(again({ supplierName: 'Acme' })).rejects.toMatchObject({ code: 'P2002' });
    await expect(again({ expiryDate: new Date('2031-01-01T00:00:00.000Z') })).resolves.toHaveProperty('id');
    await expect(again({ lot: 'L2' })).resolves.toHaveProperty('id');
  });

  it('keeps the cost as BigInt minor units with a currency and the unit it was bought in, or none of the three', async () => {
    const s = await stocked();
    const make = (over: Record<string, unknown>) =>
      prisma().phBatch.create({ data: { restaurantId: s.biz.id, productId: s.productId, lot: `C${Math.random()}`, expiryDate: EXPIRY, ...over } });
    const ok = await make({ unitCostMinor: 5_000_000_000n, costCurrency: 'IQD', costUnitId: s.unitId });
    expect((await prisma().phBatch.findUniqueOrThrow({ where: { id: ok.id } })).unitCostMinor).toBe(5_000_000_000n);
    await expect(make({ unitCostMinor: 100n })).rejects.toThrow(/PhBatch_cost_together/);
    await expect(make({ costCurrency: 'IQD', costUnitId: s.unitId })).rejects.toThrow(/PhBatch_cost_together/);
    await expect(make({ unitCostMinor: -1n, costCurrency: 'USD', costUnitId: s.unitId })).rejects.toThrow(/PhBatch_unitCostMinor_nonnegative/);
  });

  it('stores the expiry as a calendar date', async () => {
    const s = await stocked();
    const row = await prisma().phBatch.findUniqueOrThrow({ where: { id: s.batchId } });
    expect(row.expiryDate.toISOString()).toBe('2027-03-31T00:00:00.000Z');
  });
});

describe('the stock movement ledger', () => {
  it('refuses a movement that changes nothing, and a receipt that does anything but add to available', async () => {
    const s = await stocked();
    await expect(movement(s, { type: 'ADJUST', availableDelta: 0 })).rejects.toThrow(/PhStockMovement_some_delta/);
    await expect(movement(s, { availableDelta: -1 })).rejects.toThrow(/PhStockMovement_receipt_adds/);
    await expect(movement(s, { availableDelta: 5, quarantineDelta: 1 })).rejects.toThrow(/PhStockMovement_receipt_adds/);
    await expect(movement(s, { type: 'DAMAGE', availableDelta: -2, damagedDelta: 2 })).resolves.toHaveProperty('id');
  });

  it('refuses to update a movement', async () => {
    const s = await stocked();
    const m = await movement(s);
    await expect(prisma().phStockMovement.update({ where: { id: m.id }, data: { reason: 'edited' } })).rejects.toThrow(/append-only/);
    await expect(prisma().phStockMovement.updateMany({ data: { availableDelta: 99 } })).rejects.toThrow(/append-only/);
    expect((await prisma().phStockMovement.findUniqueOrThrow({ where: { id: m.id } })).availableDelta).toBe(5);
  });

  it('refuses to delete a movement', async () => {
    const s = await stocked();
    const m = await movement(s);
    await expect(prisma().phStockMovement.delete({ where: { id: m.id } })).rejects.toThrow(/append-only/);
    await expect(prisma().phStockMovement.deleteMany()).rejects.toThrow(/append-only/);
    expect(await prisma().phStockMovement.count()).toBe(1);
  });

  it('is still removed with its business when the business is deleted', async () => {
    const s = await stocked();
    await movement(s);
    await deleteBillingRows(prisma(), [s.biz.id]);
    await prisma().restaurant.delete({ where: { id: s.biz.id } });
    expect(await prisma().phStockMovement.count()).toBe(0);
  });

  it('can be reversed once, by a new movement', async () => {
    const s = await stocked();
    const original = await movement(s);
    const reversal = await movement(s, { type: 'ADJUST', availableDelta: -5, reversesId: original.id, reason: 'entered twice' });
    const stored = await prisma().phStockMovement.findUniqueOrThrow({ where: { id: reversal.id } });
    expect(stored.reversesId).toBe(original.id);
    await expect(movement(s, { type: 'ADJUST', availableDelta: -5, reversesId: original.id })).rejects.toMatchObject({ code: 'P2002' });
  });

  it('allows many movements that reverse nothing', async () => {
    const s = await stocked();
    await movement(s);
    await expect(movement(s)).resolves.toHaveProperty('id');
  });
});

describe('the receipt', () => {
  it('is idempotent by clientKey per business', async () => {
    const a = await pharmacy('A');
    const b = await pharmacy('B');
    const make = (biz: { id: string; branchId: string }, clientKey: string) =>
      prisma().phReceipt.create({ data: { restaurantId: biz.id, branchId: biz.branchId, clientKey, receivedOn: EXPIRY, createdById: 'u' } });
    await make(a, 'k1');
    await expect(make(a, 'k1')).rejects.toMatchObject({ code: 'P2002' });
    await expect(make(b, 'k1')).resolves.toHaveProperty('id');
  });

  it('refuses a line with no quantity or a negative cost', async () => {
    const s = await stocked();
    const receipt = await prisma().phReceipt.create({ data: { restaurantId: s.biz.id, branchId: s.biz.branchId, clientKey: 'k', receivedOn: EXPIRY, createdById: 'u' } });
    let lineNo = 0;
    const line = (over: Record<string, unknown>) =>
      prisma().phReceiptLine.create({
        data: {
          restaurantId: s.biz.id,
          receiptId: receipt.id,
          lineNo: (lineNo += 1),
          productId: s.productId,
          unitId: s.unitId,
          qty: 1,
          baseQty: 1,
          lot: 'L1',
          expiryDate: EXPIRY,
          ...over,
        },
      });
    await expect(line({ qty: 0 })).rejects.toThrow(/PhReceiptLine_qty_positive/);
    await expect(line({ baseQty: 0 })).rejects.toThrow(/PhReceiptLine_baseQty_positive/);
    await expect(line({ unitCostMinor: -1n, costCurrency: 'IQD' })).rejects.toThrow(/PhReceiptLine_unitCostMinor_nonnegative/);
    await expect(line({ unitCostMinor: 5n })).rejects.toThrow(/PhReceiptLine_cost_together/);
    await expect(line({ unitCostMinor: 5n, costCurrency: 'IQD' })).resolves.toHaveProperty('id');
  });
});

describe('the stock count', () => {
  it('refuses a negative expected or counted quantity', async () => {
    const s = await stocked();
    const count = await prisma().phStockCount.create({ data: { restaurantId: s.biz.id, branchId: s.biz.branchId, countedById: 'u' } });
    const line = (over: Record<string, unknown>) =>
      prisma().phStockCountLine.create({
        data: { restaurantId: s.biz.id, countId: count.id, productId: s.productId, batchId: s.batchId, expectedQty: 3, ...over },
      });
    await expect(line({ expectedQty: -1 })).rejects.toThrow(/PhStockCountLine_expectedQty_nonnegative/);
    await expect(line({ countedQty: -1 })).rejects.toThrow(/PhStockCountLine_countedQty_nonnegative/);
    await expect(line({ countedQty: 0 })).resolves.toHaveProperty('id');
  });
});

describe('the expiry follow-up', () => {
  it('is one row per batch and branch', async () => {
    const s = await stocked();
    const make = () => prisma().phExpiryAction.create({ data: { restaurantId: s.biz.id, branchId: s.biz.branchId, batchId: s.batchId, updatedById: 'u' } });
    await make();
    await expect(make()).rejects.toMatchObject({ code: 'P2002' });
  });
});
