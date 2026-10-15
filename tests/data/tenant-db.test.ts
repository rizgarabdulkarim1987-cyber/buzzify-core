import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { scopedDb } from '@/server/data/tenant-db';
import { createRestaurantFixture, resetTestData, testPrisma } from '../helpers/db';

const prisma = testPrisma();

describe('scopedDb', () => {
  let a: Awaited<ReturnType<typeof createRestaurantFixture>>;
  let b: Awaited<ReturnType<typeof createRestaurantFixture>>;

  beforeAll(async () => {
    await resetTestData(prisma);
  });

  beforeEach(async () => {
    await resetTestData(prisma);
    a = await createRestaurantFixture(prisma, 'tenant-a');
    b = await createRestaurantFixture(prisma, 'tenant-b');
  });

  afterAll(async () => {
    await resetTestData(prisma);
    await prisma.$disconnect();
  });

  it("lists only the tenant's rows", async () => {
    const products = await scopedDb(prisma, a.restaurant.id).product.findMany();
    expect(products.map((p) => p.id)).toEqual([a.product.id]);
  });

  it("cannot read another tenant's row by id", async () => {
    const found = await scopedDb(prisma, a.restaurant.id).product.findUnique({ where: { id: b.product.id } });
    expect(found).toBeNull();
  });

  it("cannot update another tenant's row", async () => {
    const db = scopedDb(prisma, a.restaurant.id);
    await expect(db.product.update({ where: { id: b.product.id }, data: { basePrice: 1 } })).rejects.toThrow();
    const untouched = await prisma.product.findUniqueOrThrow({ where: { id: b.product.id } });
    expect(untouched.basePrice).toBe(300);
  });

  it("cannot bulk delete another tenant's rows", async () => {
    const result = await scopedDb(prisma, a.restaurant.id).product.deleteMany({});
    expect(result.count).toBe(1);
    expect(await prisma.product.count({ where: { restaurantId: b.restaurant.id } })).toBe(1);
  });

  it('stamps restaurantId on create and rejects a conflicting one', async () => {
    const db = scopedDb(prisma, a.restaurant.id);
    const created = await db.category.create({
      data: { slug: 'tea', translations: { en: { name: 'Tea' } } } as never,
    });
    expect(created.restaurantId).toBe(a.restaurant.id);
    await expect(
      db.category.create({
        data: { slug: 'x', restaurantId: b.restaurant.id, translations: {} },
      }),
    ).rejects.toThrow(/Tenant mismatch/);
  });

  it('cannot move a row to another tenant through update data', async () => {
    const db = scopedDb(prisma, a.restaurant.id);
    await expect(
      db.product.update({ where: { id: a.product.id }, data: { restaurantId: b.restaurant.id } as never }),
    ).rejects.toThrow(/Tenant mismatch/);
    const row = await prisma.product.findUniqueOrThrow({ where: { id: a.product.id } });
    expect(row.restaurantId).toBe(a.restaurant.id);
  });

  it('cannot re-home rows through updateMany, upsert or a relation write', async () => {
    const db = scopedDb(prisma, a.restaurant.id);
    await expect(
      db.product.updateMany({ data: { restaurantId: b.restaurant.id } as never }),
    ).rejects.toThrow(/Tenant mismatch/);
    await expect(
      db.category.upsert({
        where: { id: a.category.id },
        create: { slug: 'x', translations: {} } as never,
        update: { restaurantId: b.restaurant.id } as never,
      }),
    ).rejects.toThrow(/Tenant mismatch/);
    await expect(
      db.product.update({
        where: { id: a.product.id },
        data: { restaurant: { connect: { id: b.restaurant.id } } } as never,
      }),
    ).rejects.toThrow(/Tenant mismatch/);
    const row = await prisma.product.findUniqueOrThrow({ where: { id: a.product.id } });
    expect(row.restaurantId).toBe(a.restaurant.id);
  });

  it('still allows ordinary updates inside the tenant', async () => {
    const db = scopedDb(prisma, a.restaurant.id);
    const updated = await db.product.update({ where: { id: a.product.id }, data: { basePrice: 450 } });
    expect(updated.basePrice).toBe(450);
  });

  it("counts only the tenant's rows", async () => {
    expect(await scopedDb(prisma, a.restaurant.id).product.count()).toBe(1);
  });
});
