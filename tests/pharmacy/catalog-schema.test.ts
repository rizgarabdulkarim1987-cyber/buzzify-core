import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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

const product = (restaurantId: string, identityKey = 'paracetamol|500mg|tablet|acme') =>
  prisma().phProduct.create({ data: { restaurantId, tradeName: 'Panadol', identityKey }, select: { id: true } });

const unit = (restaurantId: string, productId: string, level = 0, baseQty = 1) =>
  prisma().phProductUnit.create({
    data: { restaurantId, productId, level, label: level === 0 ? 'tablet' : 'box', baseQty },
    select: { id: true },
  });

describe('the catalog tables', () => {
  it('two products with the same identityKey in one business are refused by the database', async () => {
    const a = await pharmacy('A');
    await product(a.id);
    await expect(product(a.id)).rejects.toMatchObject({ code: 'P2002' });
  });

  it('the same identityKey in two businesses is allowed', async () => {
    const a = await pharmacy('A');
    const b = await pharmacy('B');
    await product(a.id);
    await expect(product(b.id)).resolves.toHaveProperty('id');
  });

  it('a unit with baseQty 0 is refused', async () => {
    const a = await pharmacy('A');
    const p = await product(a.id);
    await expect(unit(a.id, p.id, 1, 0)).rejects.toThrow(/PhProductUnit_baseQty_positive/);
    await expect(unit(a.id, p.id, 0, 2)).rejects.toThrow(/PhProductUnit_base_level_one/);
  });

  it('a negative price is refused', async () => {
    const a = await pharmacy('A');
    const p = await product(a.id);
    const u = await unit(a.id, p.id);
    const price = (amountMinor: bigint) =>
      prisma().phPrice.create({
        data: { restaurantId: a.id, productId: p.id, unitId: u.id, currency: 'IQD', amountMinor, validFrom: new Date(), reason: 't', changedById: 'actor-1' },
      });
    await expect(price(-1n)).rejects.toThrow(/PhPrice_amountMinor_nonnegative/);
    await expect(price(0n)).resolves.toHaveProperty('id');
  });

  it('two barcodes with the same code and unit in one business are refused', async () => {
    const a = await pharmacy('A');
    const p = await product(a.id);
    const u = await unit(a.id, p.id);
    const make = () => prisma().phBarcode.create({ data: { restaurantId: a.id, productId: p.id, unitId: u.id, code: '6281001234567' } });
    await make();
    await expect(make()).rejects.toMatchObject({ code: 'P2002' });
  });

  it('a barcode stored as 0012345678905 keeps its leading zeros on read-back', async () => {
    const a = await pharmacy('A');
    const p = await product(a.id);
    const u = await unit(a.id, p.id);
    const row = await prisma().phBarcode.create({ data: { restaurantId: a.id, productId: p.id, unitId: u.id, code: '0012345678905' } });
    const back = await prisma().phBarcode.findUniqueOrThrow({ where: { id: row.id } });
    expect(back.code).toBe('0012345678905');
  });

  it('a BigInt price above 2,147,483,647 round-trips exactly', async () => {
    const a = await pharmacy('A');
    const p = await product(a.id);
    const u = await unit(a.id, p.id);
    const big = 9_007_199_254_740_993n;
    const row = await prisma().phPrice.create({
      data: { restaurantId: a.id, productId: p.id, unitId: u.id, currency: 'USD', amountMinor: big, validFrom: new Date(), reason: 't', changedById: 'actor-1' },
    });
    const back = await prisma().phPrice.findUniqueOrThrow({ where: { id: row.id } });
    expect(back.amountMinor).toBe(big);
  });
});
