import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { globalDb, menuDb, restaurantDb, scopedClient, type ScopedTx } from '@/server/data/tenant-db';
import { createMenuFixture, resetTestData, testPrisma } from '../helpers/db';

const prisma = testPrisma();

/** Takes the client a scoped transaction hands to its callback, which is what ScopedTx names. */
async function branchNames(tx: ScopedTx): Promise<string[]> {
  return (await tx.branch.findMany()).map((branch) => branch.name);
}

describe('tenant scoping', () => {
  let a: Awaited<ReturnType<typeof createMenuFixture>>;
  let b: Awaited<ReturnType<typeof createMenuFixture>>;

  beforeAll(async () => {
    await resetTestData(prisma);
  });

  beforeEach(async () => {
    await resetTestData(prisma);
    a = await createMenuFixture(prisma, 'tenant-a');
    b = await createMenuFixture(prisma, 'tenant-b');
  });

  afterAll(async () => {
    await resetTestData(prisma);
    await prisma.$disconnect();
  });

  describe('menuDb', () => {
    it("lists only the menu's rows", async () => {
      const products = await menuDb(prisma, a.menu.id).product.findMany();
      expect(products.map((p) => p.id)).toEqual([a.product.id]);
    });

    it("cannot read another menu's row by id", async () => {
      const found = await menuDb(prisma, a.menu.id).product.findUnique({ where: { id: b.product.id } });
      expect(found).toBeNull();
    });

    it("cannot update another menu's row", async () => {
      const db = menuDb(prisma, a.menu.id);
      await expect(db.product.update({ where: { id: b.product.id }, data: { basePrice: 1 } })).rejects.toThrow();
      const untouched = await prisma.product.findUniqueOrThrow({ where: { id: b.product.id } });
      expect(untouched.basePrice).toBe(300);
    });

    it("cannot bulk delete another menu's rows", async () => {
      const result = await menuDb(prisma, a.menu.id).product.deleteMany({});
      expect(result.count).toBe(1);
      expect(await prisma.product.count({ where: { menuId: b.menu.id } })).toBe(1);
    });

    it('stamps menuId on create and rejects a conflicting one', async () => {
      const db = menuDb(prisma, a.menu.id);
      const created = await db.category.create({
        data: { slug: 'tea', translations: { en: { name: 'Tea' } } } as never,
      });
      expect(created.menuId).toBe(a.menu.id);
      await expect(
        db.category.create({
          data: { slug: 'x', menuId: b.menu.id, translations: {} },
        }),
      ).rejects.toThrow(/Tenant mismatch/);
    });

    it('cannot move a row to another menu through update data', async () => {
      const db = menuDb(prisma, a.menu.id);
      await expect(
        db.product.update({ where: { id: a.product.id }, data: { menuId: b.menu.id } as never }),
      ).rejects.toThrow(/Tenant mismatch/);
      const row = await prisma.product.findUniqueOrThrow({ where: { id: a.product.id } });
      expect(row.menuId).toBe(a.menu.id);
    });

    it('cannot re-home rows through updateMany, upsert or a relation write', async () => {
      const db = menuDb(prisma, a.menu.id);
      await expect(db.product.updateMany({ data: { menuId: b.menu.id } as never })).rejects.toThrow(
        /Tenant mismatch/,
      );
      await expect(
        db.category.upsert({
          where: { id: a.category.id },
          create: { slug: 'x', translations: {} } as never,
          update: { menuId: b.menu.id } as never,
        }),
      ).rejects.toThrow(/Tenant mismatch/);
      await expect(
        db.product.update({
          where: { id: a.product.id },
          data: { menu: { connect: { id: b.menu.id } } } as never,
        }),
      ).rejects.toThrow(/Tenant mismatch/);
      const row = await prisma.product.findUniqueOrThrow({ where: { id: a.product.id } });
      expect(row.menuId).toBe(a.menu.id);
    });

    it('still allows ordinary updates inside the menu', async () => {
      const db = menuDb(prisma, a.menu.id);
      const updated = await db.product.update({ where: { id: a.product.id }, data: { basePrice: 450 } });
      expect(updated.basePrice).toBe(450);
    });

    it("counts only the menu's rows", async () => {
      expect(await menuDb(prisma, a.menu.id).product.count()).toBe(1);
    });

    it('refuses an empty menu id', () => {
      expect(() => menuDb(prisma, '')).toThrow(/menuId/);
    });
  });

  describe('restaurantDb and scopedClient', () => {
    beforeEach(async () => {
      await prisma.branch.create({ data: { restaurantId: a.restaurant.id, name: 'A branch' } });
      await prisma.branch.create({ data: { restaurantId: b.restaurant.id, name: 'B branch' } });
    });

    it("lists only the restaurant's branches", async () => {
      const branches = await restaurantDb(prisma, a.restaurant.id).branch.findMany();
      expect(branches.map((branch) => branch.name)).toEqual(['A branch']);
    });

    it('stamps restaurantId on a branch and rejects a conflicting one', async () => {
      const db = restaurantDb(prisma, a.restaurant.id);
      const created = await db.branch.create({ data: { name: 'Second' } as never });
      expect(created.restaurantId).toBe(a.restaurant.id);
      await expect(db.branch.create({ data: { name: 'Stolen', restaurantId: b.restaurant.id } })).rejects.toThrow(
        /Tenant mismatch/,
      );
    });

    it('scopes menu rows and branches together when given both ids', async () => {
      const db = scopedClient(prisma, { menuId: a.menu.id, restaurantId: a.restaurant.id });
      expect((await db.product.findMany()).map((p) => p.id)).toEqual([a.product.id]);
      expect((await db.branch.findMany()).map((branch) => branch.name)).toEqual(['A branch']);
    });

    it('scopes statements inside an interactive transaction', async () => {
      const db = scopedClient(prisma, { menuId: a.menu.id, restaurantId: a.restaurant.id });
      const seen = await db.$transaction(async (tx) => ({
        products: (await tx.product.findMany()).map((p) => p.id),
        branches: await branchNames(tx),
      }));
      expect(seen).toEqual({ products: [a.product.id], branches: ['A branch'] });
    });

    it('needs at least one id', () => {
      expect(() => scopedClient(prisma, {})).toThrow(/menuId or a restaurantId/);
    });
  });

  // A client scoped to one class of rows must not serve the other class unscoped: it refuses instead (ruling R13).
  describe('failing closed across scope classes', () => {
    beforeEach(async () => {
      await prisma.branch.create({ data: { restaurantId: a.restaurant.id, name: 'A branch' } });
      await prisma.branch.create({ data: { restaurantId: b.restaurant.id, name: 'B branch' } });
    });

    it('menuDb refuses every restaurant-scoped model, for reads and writes', async () => {
      const db = menuDb(prisma, a.menu.id);
      await expect(db.branch.findMany()).rejects.toThrow(/Branch is restaurant-scoped/);
      await expect(db.branch.count()).rejects.toThrow(/Branch is restaurant-scoped/);
      await expect(db.branch.create({ data: { restaurantId: a.restaurant.id, name: 'Sneaky' } })).rejects.toThrow(
        /Branch is restaurant-scoped/,
      );
      await expect(db.branch.deleteMany({})).rejects.toThrow(/Branch is restaurant-scoped/);
      expect(await prisma.branch.count()).toBe(2);
    });

    it('restaurantDb refuses every menu-scoped model, for reads and writes', async () => {
      const db = restaurantDb(prisma, a.restaurant.id);
      await expect(db.product.findMany()).rejects.toThrow(/Product is menu-scoped/);
      await expect(db.menuRevision.findFirst()).rejects.toThrow(/MenuRevision is menu-scoped/);
      await expect(db.category.updateMany({ data: { isActive: false } })).rejects.toThrow(/Category is menu-scoped/);
      expect(await prisma.category.count({ where: { isActive: false } })).toBe(0);
    });

    it('scopedClient with one id refuses the other class; with both, scopes each class by its own id', async () => {
      await expect(scopedClient(prisma, { menuId: a.menu.id }).branch.findMany()).rejects.toThrow(/restaurant-scoped/);
      await expect(scopedClient(prisma, { restaurantId: a.restaurant.id }).product.findMany()).rejects.toThrow(/menu-scoped/);

      const both = scopedClient(prisma, { menuId: a.menu.id, restaurantId: a.restaurant.id });
      expect((await both.product.findMany()).map((p) => p.id)).toEqual([a.product.id]);
      expect(await branchNames(both)).toEqual(['A branch']);
    });

    it('leaves global and lookup models alone', async () => {
      const db = menuDb(prisma, a.menu.id);
      expect(await db.restaurant.count()).toBe(2);
      expect(await db.menu.count()).toBe(2);
      expect(await restaurantDb(prisma, a.restaurant.id).menu.count()).toBe(2);
    });

    it('globalDb serves only global and lookup models', async () => {
      const db = globalDb(prisma);
      await expect(db.product.findMany()).rejects.toThrow(/Product is menu-scoped/);
      await expect(db.branch.findMany()).rejects.toThrow(/Branch is restaurant-scoped/);
      expect(await db.restaurant.count()).toBe(2);
      const seen = await db.$transaction(async (tx) => tx.menu.count());
      expect(seen).toBe(2);
    });
  });
});
