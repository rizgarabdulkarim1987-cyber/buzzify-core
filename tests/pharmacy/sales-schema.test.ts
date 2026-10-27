import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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
const NOW = new Date('2026-10-28T09:00:00.000Z');

type World = Awaited<ReturnType<typeof world>>;

/** A business with a product, its base unit and one batch. */
async function world(name = 'A') {
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

const shift = (w: World, over: Record<string, unknown> = {}) =>
  prisma().phShift.create({
    data: { restaurantId: w.biz.id, branchId: w.biz.branchId, userId: 'cashier-1', currency: 'IQD', ...over } as never,
    select: { id: true },
  });

let seq = 0;
const sale = async (w: World, shiftId: string, over: Record<string, unknown> = {}) =>
  prisma().phSale.create({
    data: {
      restaurantId: w.biz.id,
      branchId: w.biz.branchId,
      shiftId,
      status: 'HELD',
      currency: 'IQD',
      clientKey: `sale-${(seq += 1)}`,
      soldById: 'cashier-1',
      ...over,
    } as never,
    select: { id: true },
  });

/** A completed sale with a total of 1000, paid in full. */
const completed = (w: World, shiftId: string, over: Record<string, unknown> = {}) =>
  sale(w, shiftId, {
    status: 'COMPLETED',
    number: `20261028-${(seq += 1)}`,
    subtotalMinor: 1000n,
    totalMinor: 1000n,
    paidMinor: 1000n,
    completedAt: NOW,
    ...over,
  });

async function lineWorld() {
  const w = await world();
  const sh = await shift(w);
  const s = await sale(w, sh.id);
  return { w, sh, s };
}

const line = (w: World, saleId: string, over: Record<string, unknown> = {}) =>
  prisma().phSaleLine.create({
    data: {
      restaurantId: w.biz.id,
      saleId,
      lineNo: (seq += 1),
      productId: w.productId,
      unitId: w.unitId,
      qty: 2,
      baseQty: 2,
      unitPriceMinor: 500n,
      totalMinor: 1000n,
      ...over,
    } as never,
    select: { id: true },
  });

const allocation = (w: World, saleLineId: string, over: Record<string, unknown> = {}) =>
  prisma().phSaleLineAllocation.create({
    data: { restaurantId: w.biz.id, saleLineId, batchId: w.batchId, baseQty: 2, expirySnapshot: EXPIRY, ...over } as never,
    select: { id: true },
  });

describe('the shift', () => {
  it('allows one open shift per user per branch; a closed one frees the slot', async () => {
    const w = await world();
    const first = await shift(w);
    await expect(shift(w)).rejects.toThrow(/PhShift_one_open_per_user/);
    // another user, and another business, are separate
    await expect(shift(w, { userId: 'cashier-2' })).resolves.toHaveProperty('id');
    const other = await world('B');
    await expect(shift(other)).resolves.toHaveProperty('id');
    await prisma().phShift.update({ where: { id: first.id }, data: { status: 'CLOSED', closedAt: NOW } });
    await expect(shift(w)).resolves.toHaveProperty('id');
    // a second branch of the same business is separate too
    const two = await pharmacy('C', { branches: 2 });
    const [b1, b2] = two.branchIds;
    await prisma().phShift.create({ data: { restaurantId: two.id, branchId: b1!, userId: 'u', currency: 'IQD' } });
    await expect(prisma().phShift.create({ data: { restaurantId: two.id, branchId: b2!, userId: 'u', currency: 'IQD' } })).resolves.toHaveProperty('id');
  });

  it('refuses a negative float and a negative count', async () => {
    const w = await world();
    await expect(shift(w, { openingFloatMinor: -1n })).rejects.toThrow(/PhShift_openingFloatMinor_nonnegative/);
    await expect(shift(w, { status: 'CLOSED', closedAt: NOW, countedMinor: -1n })).rejects.toThrow(/PhShift_countedMinor_nonnegative/);
  });

  it('is closed exactly when it has a closing time', async () => {
    const w = await world();
    await expect(shift(w, { status: 'CLOSED' })).rejects.toThrow(/PhShift_closed_together/);
    await expect(shift(w, { closedAt: NOW })).rejects.toThrow(/PhShift_closed_together/);
  });

  it('refuses a branch of another business (composite foreign key)', async () => {
    const a = await world('A');
    const b = await pharmacy('B');
    await expect(shift(a, { branchId: b.branchId })).rejects.toMatchObject({ code: 'P2003' });
  });
});

describe('the cash movement', () => {
  const movement = (w: World, shiftId: string, over: Record<string, unknown> = {}) =>
    prisma().phCashMovement.create({
      data: { restaurantId: w.biz.id, shiftId, type: 'FLOAT_OPEN', amountMinor: 1000n, currency: 'IQD', userId: 'cashier-1', ...over } as never,
      select: { id: true },
    });

  it('keeps money in positive and money out negative, never zero', async () => {
    const w = await world();
    const sh = await shift(w);
    await expect(movement(w, sh.id, { amountMinor: 0n })).rejects.toThrow(/PhCashMovement_amount_sign/);
    await expect(movement(w, sh.id, { type: 'SALE_CASH', amountMinor: -5n })).rejects.toThrow(/PhCashMovement_amount_sign/);
    await expect(movement(w, sh.id, { type: 'CHANGE_OUT', amountMinor: 5n })).rejects.toThrow(/PhCashMovement_amount_sign/);
    await expect(movement(w, sh.id, { type: 'PAID_OUT', amountMinor: 5n })).rejects.toThrow(/PhCashMovement_amount_sign/);
    await expect(movement(w, sh.id, { type: 'REFUND_CASH', amountMinor: -250n, refType: 'return', refId: 'r1' })).resolves.toHaveProperty('id');
  });

  it('refuses the shift of another business', async () => {
    const a = await world('A');
    const b = await world('B');
    const shB = await shift(b);
    await expect(movement(a, shB.id)).rejects.toMatchObject({ code: 'P2003' });
  });
});

describe('the sale', () => {
  it('refuses negative totals and a discount above the subtotal', async () => {
    const { w, sh } = await lineWorld();
    await expect(sale(w, sh.id, { subtotalMinor: -1n })).rejects.toThrow(/PhSale_subtotalMinor_nonnegative/);
    await expect(sale(w, sh.id, { discountMinor: -1n })).rejects.toThrow(/PhSale_discountMinor_nonnegative/);
    await expect(sale(w, sh.id, { totalMinor: -1n })).rejects.toThrow(/PhSale_totalMinor_nonnegative/);
    await expect(sale(w, sh.id, { paidMinor: -1n })).rejects.toThrow(/PhSale_paidMinor_nonnegative/);
    await expect(sale(w, sh.id, { changeMinor: -1n })).rejects.toThrow(/PhSale_changeMinor_nonnegative/);
    await expect(sale(w, sh.id, { subtotalMinor: 100n, discountMinor: 101n })).rejects.toThrow(/PhSale_within_subtotal/);
    await expect(sale(w, sh.id, { subtotalMinor: 100n, discountMinor: 100n, totalMinor: 0n })).resolves.toHaveProperty('id');
  });

  it('must be paid in full and numbered once completed or returned, but a hold may be neither', async () => {
    const { w, sh } = await lineWorld();
    await expect(completed(w, sh.id, { paidMinor: 999n })).rejects.toThrow(/PhSale_paid_covers_total/);
    await expect(completed(w, sh.id, { status: 'RETURNED_PARTIAL', paidMinor: 0n })).rejects.toThrow(/PhSale_paid_covers_total/);
    await expect(completed(w, sh.id, { status: 'RETURNED_FULL', paidMinor: 0n })).rejects.toThrow(/PhSale_paid_covers_total/);
    await expect(completed(w, sh.id, { number: null })).rejects.toThrow(/PhSale_numbered_when_done/);
    await expect(sale(w, sh.id, { subtotalMinor: 1000n, totalMinor: 1000n })).resolves.toHaveProperty('id');
    await expect(completed(w, sh.id, { paidMinor: 1500n, changeMinor: 500n })).resolves.toHaveProperty('id');
  });

  it('is idempotent by clientKey per business, and numbered once per branch', async () => {
    const a = await world('A');
    const b = await world('B');
    const shA = await shift(a);
    const shB = await shift(b);
    await sale(a, shA.id, { clientKey: 'k1' });
    await expect(sale(a, shA.id, { clientKey: 'k1' })).rejects.toMatchObject({ code: 'P2002' });
    await expect(sale(b, shB.id, { clientKey: 'k1' })).resolves.toHaveProperty('id');
    await completed(a, shA.id, { number: '20261028-000001' });
    await expect(completed(a, shA.id, { number: '20261028-000001' })).rejects.toMatchObject({ code: 'P2002' });
    // unnumbered holds do not collide, and another branch's numbers are its own
    await sale(a, shA.id);
    await expect(sale(a, shA.id)).resolves.toHaveProperty('id');
    await expect(completed(b, shB.id, { number: '20261028-000001' })).resolves.toHaveProperty('id');
  });

  it('refuses a shift or branch of another business, and a shift of another branch', async () => {
    const a = await world('A');
    const b = await world('B');
    const shB = await shift(b);
    await expect(sale(a, shB.id)).rejects.toMatchObject({ code: 'P2003' });
    await expect(sale(a, (await shift(a)).id, { branchId: b.biz.branchId })).rejects.toMatchObject({ code: 'P2003' });
    const two = await pharmacy('C', { branches: 2 });
    const sh1 = await prisma().phShift.create({ data: { restaurantId: two.id, branchId: two.branchIds[0]!, userId: 'u', currency: 'IQD' } });
    await expect(
      prisma().phSale.create({
        data: { restaurantId: two.id, branchId: two.branchIds[1]!, shiftId: sh1.id, currency: 'IQD', clientKey: 'x', soldById: 'u' },
      }),
    ).rejects.toMatchObject({ code: 'P2003' });
  });

  it('keeps the rounding difference signed', async () => {
    const { w, sh } = await lineWorld();
    await expect(completed(w, sh.id, { subtotalMinor: 1010n, totalMinor: 1000n, roundingMinor: -10n })).resolves.toHaveProperty('id');
    await expect(completed(w, sh.id, { subtotalMinor: 990n, totalMinor: 1000n, roundingMinor: 10n })).resolves.toHaveProperty('id');
  });
});

describe('the sale line', () => {
  it('refuses no quantity, no base quantity, negative money and a discount above the gross', async () => {
    const { w, s } = await lineWorld();
    await expect(line(w, s.id, { qty: 0 })).rejects.toThrow(/PhSaleLine_qty_positive/);
    await expect(line(w, s.id, { baseQty: 0 })).rejects.toThrow(/PhSaleLine_baseQty_positive/);
    await expect(line(w, s.id, { unitPriceMinor: -1n })).rejects.toThrow(/PhSaleLine_unitPriceMinor_nonnegative/);
    await expect(line(w, s.id, { discountMinor: -1n })).rejects.toThrow(/PhSaleLine_discountMinor_nonnegative/);
    await expect(line(w, s.id, { totalMinor: -1n })).rejects.toThrow(/PhSaleLine_totalMinor_nonnegative/);
    // the gross is 2 x 500 = 1000
    await expect(line(w, s.id, { discountMinor: 1001n, totalMinor: 0n })).rejects.toThrow(/PhSaleLine_within_gross/);
    await expect(line(w, s.id, { discountMinor: 1000n, totalMinor: 0n })).resolves.toHaveProperty('id');
  });

  it('refuses the sale, product or unit of another business', async () => {
    const { w, s } = await lineWorld();
    const other = await world('B');
    await expect(line(other, s.id, { productId: other.productId, unitId: other.unitId })).rejects.toMatchObject({ code: 'P2003' });
    await expect(line(w, s.id, { productId: other.productId })).rejects.toMatchObject({ code: 'P2003' });
    await expect(line(w, s.id, { unitId: other.unitId })).rejects.toMatchObject({ code: 'P2003' });
  });

  it('stores the rx level it was sold at and the price row it used, never one of another business', async () => {
    const { w, s } = await lineWorld();
    const price = await prisma().phPrice.create({
      data: { restaurantId: w.biz.id, productId: w.productId, unitId: w.unitId, currency: 'IQD', amountMinor: 500n, validFrom: NOW, changedById: 'u' },
    });
    const made = await line(w, s.id, { priceId: price.id, rxLevel: 'RX', pharmacistId: 'ph-1', priceOverrideReason: 'matching', discountReason: 'loyal' });
    const row = await prisma().phSaleLine.findUniqueOrThrow({ where: { id: made.id } });
    expect(row).toMatchObject({ priceId: price.id, rxLevel: 'RX', pharmacistId: 'ph-1' });
    const other = await world('B');
    const foreign = await prisma().phPrice.create({
      data: { restaurantId: other.biz.id, productId: other.productId, unitId: other.unitId, currency: 'IQD', amountMinor: 1n, validFrom: NOW, changedById: 'u' },
    });
    await expect(line(w, s.id, { priceId: foreign.id })).rejects.toMatchObject({ code: 'P2003' });
  });
});

describe('the sale line allocation', () => {
  it('refuses no quantity and a negative cost; a cost needs its currency', async () => {
    const { w, s } = await lineWorld();
    const l = await line(w, s.id);
    await expect(allocation(w, l.id, { baseQty: 0 })).rejects.toThrow(/PhSaleLineAllocation_baseQty_positive/);
    await expect(allocation(w, l.id, { costSnapshotMinor: -1n, costCurrency: 'IQD' })).rejects.toThrow(/PhSaleLineAllocation_costSnapshotMinor_nonnegative/);
    await expect(allocation(w, l.id, { costSnapshotMinor: 5n })).rejects.toThrow(/PhSaleLineAllocation_cost_together/);
    await expect(allocation(w, l.id, { costCurrency: 'IQD' })).rejects.toThrow(/PhSaleLineAllocation_cost_together/);
    await expect(allocation(w, l.id, { costSnapshotMinor: 5n, costCurrency: 'IQD' })).resolves.toHaveProperty('id');
  });

  it('keeps returnedBaseQty between 0 and what was sold', async () => {
    const { w, s } = await lineWorld();
    const l = await line(w, s.id);
    await expect(allocation(w, l.id, { returnedBaseQty: -1 })).rejects.toThrow(/PhSaleLineAllocation_returned_within_sold/);
    await expect(allocation(w, l.id, { returnedBaseQty: 3 })).rejects.toThrow(/PhSaleLineAllocation_returned_within_sold/);
    const a = await allocation(w, l.id);
    expect((await prisma().phSaleLineAllocation.findUniqueOrThrow({ where: { id: a.id } })).returnedBaseQty).toBe(0);
    await expect(prisma().phSaleLineAllocation.update({ where: { id: a.id }, data: { returnedBaseQty: { increment: 2 } } })).resolves.toHaveProperty('returnedBaseQty', 2);
    await expect(prisma().phSaleLineAllocation.update({ where: { id: a.id }, data: { returnedBaseQty: { increment: 1 } } })).rejects.toThrow(
      /PhSaleLineAllocation_returned_within_sold/,
    );
  });

  it('refuses the batch of another business', async () => {
    const { w, s } = await lineWorld();
    const l = await line(w, s.id);
    const other = await world('B');
    await expect(allocation(w, l.id, { batchId: other.batchId })).rejects.toMatchObject({ code: 'P2003' });
  });

  it('stores the expiry as a calendar date', async () => {
    const { w, s } = await lineWorld();
    const a = await allocation(w, (await line(w, s.id)).id);
    const row = await prisma().phSaleLineAllocation.findUniqueOrThrow({ where: { id: a.id } });
    expect(row.expirySnapshot.toISOString()).toBe('2027-03-31T00:00:00.000Z');
  });
});

describe('the payment', () => {
  const pay = (w: World, saleId: string, over: Record<string, unknown> = {}) =>
    prisma().phPayment.create({
      data: { restaurantId: w.biz.id, saleId, method: 'CASH', amountMinor: 1000n, currency: 'IQD', clientKey: `pay-${(seq += 1)}`, ...over } as never,
      select: { id: true },
    });

  it('is a positive amount in the currency of its sale', async () => {
    const { w, s } = await lineWorld();
    await expect(pay(w, s.id, { amountMinor: 0n })).rejects.toThrow(/PhPayment_amountMinor_positive/);
    await expect(pay(w, s.id, { currency: 'USD' })).rejects.toMatchObject({ code: 'P2003' });
    await expect(pay(w, s.id, { method: 'CARD_MANUAL', reference: 'POS-77' })).resolves.toHaveProperty('id');
  });

  it('is idempotent by clientKey per business', async () => {
    const { w, s } = await lineWorld();
    await pay(w, s.id, { clientKey: 'p1' });
    await expect(pay(w, s.id, { clientKey: 'p1' })).rejects.toMatchObject({ code: 'P2002' });
  });

  it('refuses the sale of another business', async () => {
    const { s } = await lineWorld();
    const other = await world('B');
    await expect(pay(other, s.id)).rejects.toMatchObject({ code: 'P2003' });
  });
});

describe('the return', () => {
  async function returnable() {
    const { w, sh } = await lineWorld();
    const done = await completed(w, sh.id);
    const l = await line(w, done.id);
    const a = await allocation(w, l.id);
    return { w, sh, saleId: done.id, allocationId: a.id };
  }
  const ret = (r: Awaited<ReturnType<typeof returnable>>, over: Record<string, unknown> = {}) =>
    prisma().phReturn.create({
      data: {
        restaurantId: r.w.biz.id,
        branchId: r.w.biz.branchId,
        saleId: r.saleId,
        shiftId: r.sh.id,
        reason: 'wrong item',
        approvedById: 'manager-1',
        refundMethod: 'CASH',
        refundMinor: 500n,
        currency: 'IQD',
        clientKey: `ret-${(seq += 1)}`,
        ...over,
      } as never,
      select: { id: true },
    });

  it('refunds a non-negative amount in the currency of the sale', async () => {
    const r = await returnable();
    await expect(ret(r, { refundMinor: -1n })).rejects.toThrow(/PhReturn_refundMinor_nonnegative/);
    await expect(ret(r, { currency: 'USD' })).rejects.toMatchObject({ code: 'P2003' });
    await expect(ret(r)).resolves.toHaveProperty('id');
  });

  it('is idempotent by clientKey and numbered once per branch', async () => {
    const r = await returnable();
    await ret(r, { clientKey: 'r1', number: 'R-1' });
    await expect(ret(r, { clientKey: 'r1' })).rejects.toMatchObject({ code: 'P2002' });
    await expect(ret(r, { number: 'R-1' })).rejects.toMatchObject({ code: 'P2002' });
    await expect(ret(r, { number: null })).resolves.toHaveProperty('id');
  });

  it('refuses the branch or shift of another business', async () => {
    const r = await returnable();
    const other = await world('B');
    const shB = await shift(other);
    await expect(ret(r, { branchId: other.biz.branchId })).rejects.toMatchObject({ code: 'P2003' });
    await expect(ret(r, { shiftId: shB.id })).rejects.toMatchObject({ code: 'P2003' });
  });

  it('has lines of a positive quantity and a non-negative refund, one per allocation', async () => {
    const r = await returnable();
    const made = await ret(r);
    const rl = (over: Record<string, unknown> = {}) =>
      prisma().phReturnLine.create({
        data: { restaurantId: r.w.biz.id, returnId: made.id, saleLineAllocationId: r.allocationId, baseQty: 1, refundMinor: 500n, ...over } as never,
        select: { id: true },
      });
    await expect(rl({ baseQty: 0 })).rejects.toThrow(/PhReturnLine_baseQty_positive/);
    await expect(rl({ refundMinor: -1n })).rejects.toThrow(/PhReturnLine_refundMinor_nonnegative/);
    await expect(rl()).resolves.toHaveProperty('id');
    await expect(rl()).rejects.toMatchObject({ code: 'P2002' });
    // another business's id on a fresh allocation (so the one-per-allocation rule does not answer first)
    const sale2 = await sale(r.w, r.sh.id);
    const second = await allocation(r.w, (await line(r.w, sale2.id)).id);
    const other = await world('B');
    await expect(rl({ restaurantId: other.biz.id, saleLineAllocationId: second.id })).rejects.toMatchObject({ code: 'P2003' });
  });
});

describe('the receipt reprint', () => {
  it('names a sale or a return, not both and not neither', async () => {
    const { w, sh } = await lineWorld();
    const done = await completed(w, sh.id);
    const reprint = (over: Record<string, unknown>) =>
      prisma().phReceiptReprint.create({ data: { restaurantId: w.biz.id, userId: 'u', copyNumber: 1, ...over } as never, select: { id: true } });
    await expect(reprint({})).rejects.toThrow(/PhReceiptReprint_one_target/);
    await expect(reprint({ saleId: done.id, returnId: 'x' })).rejects.toThrow(/PhReceiptReprint_one_target/);
    await expect(reprint({ saleId: done.id, copyNumber: 0 })).rejects.toThrow(/PhReceiptReprint_copyNumber_positive/);
    await expect(reprint({ saleId: done.id })).resolves.toHaveProperty('id');
    await expect(reprint({ saleId: done.id })).rejects.toMatchObject({ code: 'P2002' });
    await expect(reprint({ saleId: done.id, copyNumber: 2 })).resolves.toHaveProperty('id');
  });
});

describe('the pharmacy settings', () => {
  it('start with no rounding, a 5 percent discount limit, no variance limit and a 30 day return window', async () => {
    const w = await world();
    const row = await prisma().phSettings.create({ data: { restaurantId: w.biz.id } });
    expect(row).toMatchObject({ roundingStepMinor: 0n, maxDiscountPercent: 5, shiftVarianceLimitMinor: 0n, returnWindowDays: 30 });
  });

  it('refuse a negative step or limit and a percent outside 0 to 100', async () => {
    const w = await world();
    const make = (over: Record<string, unknown>) => prisma().phSettings.create({ data: { restaurantId: w.biz.id, ...over } as never });
    await expect(make({ roundingStepMinor: -1n })).rejects.toThrow(/PhSettings_roundingStepMinor_nonnegative/);
    await expect(make({ maxDiscountPercent: 101 })).rejects.toThrow(/PhSettings_maxDiscountPercent_range/);
    await expect(make({ maxDiscountPercent: -1 })).rejects.toThrow(/PhSettings_maxDiscountPercent_range/);
    await expect(make({ shiftVarianceLimitMinor: -1n })).rejects.toThrow(/PhSettings_shiftVarianceLimitMinor_nonnegative/);
    await expect(make({ returnWindowDays: -1 })).rejects.toThrow(/PhSettings_returnWindowDays_nonnegative/);
  });
});
