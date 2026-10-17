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

    it('globalDb refuses scoped models and filters nothing else', async () => {
      const db = globalDb(prisma);
      await expect(db.product.findMany()).rejects.toThrow(/Product is menu-scoped/);
      await expect(db.branch.findMany()).rejects.toThrow(/Branch is restaurant-scoped/);
      expect(await db.restaurant.count()).toBe(2);
      const seen = await db.$transaction(async (tx) => tx.menu.count());
      expect(seen).toBe(2);
    });
  });

  // A client that carries a restaurant also confines its Restaurant row, its menus and its memberships; one that
  // carries a menu confines that Menu row (ruling R25). The extension sees top-level queries only, so these are what
  // keep a nested include or write from them inside the owner, as long as it does not pass through a global model.
  describe('confining menus, the restaurant row and memberships', () => {
    let membershipA: { id: string };
    let membershipB: { id: string };

    beforeEach(async () => {
      for (const id of ['user-a', 'user-b', 'user-c']) {
        await prisma.user.create({ data: { id, name: id, email: `${id}@example.com` } });
      }
      membershipA = await prisma.membership.create({ data: { userId: 'user-a', restaurantId: a.restaurant.id, role: 'DESIGNER' } });
      membershipB = await prisma.membership.create({ data: { userId: 'user-b', restaurantId: b.restaurant.id, role: 'OWNER' } });
    });

    const menuData = (slug: string) => ({ name: slug, slug, timezone: 'Asia/Baghdad', locales: ['en'] });

    it("shows a restaurant's transaction only its menus, and through include only their products", async () => {
      const seen = await restaurantDb(prisma, a.restaurant.id).$transaction(async (tx) => ({
        menus: (await tx.menu.findMany()).map((menu) => menu.id),
        products: (await tx.menu.findMany({ include: { products: true } })).flatMap((menu) => menu.products.map((p) => p.id)),
        count: await tx.menu.count(),
        byId: await tx.menu.findUnique({ where: { id: b.menu.id } }),
      }));
      expect(seen).toEqual({ menus: [a.menu.id], products: [a.product.id], count: 1, byId: null });
    });

    it('does not follow a nested include through a global model: that leaves the restaurant, as tenantScope says', async () => {
      // The person in A also works in B. Their membership in A is confined; the include through User is not.
      await prisma.membership.create({ data: { userId: 'user-a', restaurantId: b.restaurant.id, role: 'OWNER' } });
      const reached = await restaurantDb(prisma, a.restaurant.id).$transaction(async (tx) => {
        const rows = await tx.membership.findMany({ include: { user: { include: { memberships: true } } } });
        return rows.flatMap((row) => row.user.memberships.map((membership) => membership.restaurantId));
      });
      expect(reached).toContain(b.restaurant.id);
    });

    it("cannot update, delete through or re-home another restaurant's menu", async () => {
      const db = restaurantDb(prisma, a.restaurant.id);
      await expect(db.menu.update({ where: { id: b.menu.id }, data: { name: 'Hijacked' } })).rejects.toThrow();
      expect((await db.menu.updateMany({ where: { id: b.menu.id }, data: { name: 'Hijacked' } })).count).toBe(0);
      await expect(
        db.menu.update({ where: { id: b.menu.id }, data: { products: { deleteMany: {} } } }),
      ).rejects.toThrow();
      expect((await db.menu.deleteMany({ where: { id: b.menu.id } })).count).toBe(0);
      expect(await prisma.product.count({ where: { menuId: b.menu.id } })).toBe(1);
      expect((await prisma.menu.findUniqueOrThrow({ where: { id: b.menu.id } })).name).toBe('Menu tenant-b');

      await expect(
        db.menu.update({ where: { id: a.menu.id }, data: { restaurantId: b.restaurant.id } }),
      ).rejects.toThrow(/Tenant mismatch/);
      await expect(
        db.menu.update({ where: { id: a.menu.id }, data: { restaurant: { connect: { id: b.restaurant.id } } } }),
      ).rejects.toThrow(/Tenant mismatch/);
      expect((await prisma.menu.findUniqueOrThrow({ where: { id: a.menu.id } })).restaurantId).toBe(a.restaurant.id);
    });

    it('stamps its restaurant on a new menu and refuses one for another restaurant', async () => {
      const db = restaurantDb(prisma, a.restaurant.id);
      const created = await db.menu.create({ data: menuData('tenant-a-second') as never });
      expect(created.restaurantId).toBe(a.restaurant.id);
      await expect(
        db.menu.create({ data: { ...menuData('tenant-a-stolen'), restaurantId: b.restaurant.id } }),
      ).rejects.toThrow(/Tenant mismatch/);
    });

    it('confines the Restaurant row to its own and refuses creating one', async () => {
      const db = restaurantDb(prisma, a.restaurant.id);
      expect((await db.restaurant.findMany()).map((r) => r.id)).toEqual([a.restaurant.id]);
      await expect(db.restaurant.update({ where: { id: b.restaurant.id }, data: { name: 'Hijacked' } })).rejects.toThrow();
      expect((await prisma.restaurant.findUniqueOrThrow({ where: { id: b.restaurant.id } })).name).toBe('Restaurant tenant-b');
      await expect(db.restaurant.create({ data: { name: 'Another' } })).rejects.toThrow(/cannot create a Restaurant/);
      await expect(
        db.restaurant.update({ where: { id: a.restaurant.id }, data: { id: 'renamed-id' } }),
      ).rejects.toThrow(/Tenant mismatch/);
      expect((await db.restaurant.update({ where: { id: a.restaurant.id }, data: { name: 'Alpha' } })).name).toBe('Alpha');
    });

    it('sees and writes only its own memberships', async () => {
      const db = restaurantDb(prisma, a.restaurant.id);
      expect((await db.membership.findMany()).map((m) => m.userId)).toEqual(['user-a']);
      const created = await db.membership.create({ data: { userId: 'user-c', role: 'OWNER' } as never });
      expect(created.restaurantId).toBe(a.restaurant.id);
      await expect(db.membership.update({ where: { id: membershipB.id }, data: { role: 'DESIGNER' } })).rejects.toThrow();
      expect((await db.membership.deleteMany({ where: { id: membershipB.id } })).count).toBe(0);
      await expect(
        db.membership.update({ where: { id: membershipA.id }, data: { restaurantId: b.restaurant.id } }),
      ).rejects.toThrow(/Tenant mismatch/);
      expect(await prisma.membership.count({ where: { restaurantId: b.restaurant.id } })).toBe(1);
    });

    it('shows a menu-scoped client only its own Menu row and refuses creating one', async () => {
      const db = menuDb(prisma, a.menu.id);
      expect((await db.menu.findMany()).map((menu) => menu.id)).toEqual([a.menu.id]);
      expect(await db.menu.findUnique({ where: { id: b.menu.id } })).toBeNull();
      expect((await db.menu.updateMany({ data: { notes: 'touched' } })).count).toBe(1);
      expect((await prisma.menu.findUniqueOrThrow({ where: { id: b.menu.id } })).notes).toBe('');
      await expect(
        db.menu.create({ data: { ...menuData('tenant-a-new'), restaurantId: a.restaurant.id } }),
      ).rejects.toThrow(/cannot create a Menu/);

      const both = scopedClient(prisma, { menuId: a.menu.id, restaurantId: a.restaurant.id });
      expect((await both.menu.findMany()).map((menu) => menu.id)).toEqual([a.menu.id]);
      expect((await both.restaurant.findMany()).map((r) => r.id)).toEqual([a.restaurant.id]);
    });

    it('lets a client scoped to a menu id that does not exist yet create that one menu, in its restaurant only', async () => {
      const db = scopedClient(prisma, { menuId: 'tenant-new-menu', restaurantId: a.restaurant.id });
      // Any other id, or none, is still refused.
      await expect(db.menu.create({ data: { ...menuData('tenant-other'), id: 'tenant-other-id' } as never })).rejects.toThrow(/cannot create a Menu/);
      await expect(db.menu.create({ data: menuData('tenant-none') as never })).rejects.toThrow(/cannot create a Menu/);
      // Its restaurant is stamped, and another one refused.
      await expect(
        db.menu.create({ data: { ...menuData('tenant-stolen'), id: 'tenant-new-menu', restaurantId: b.restaurant.id } }),
      ).rejects.toThrow(/Tenant mismatch/);
      const created = await db.menu.create({ data: { ...menuData('tenant-new'), id: 'tenant-new-menu' } as never });
      expect(created).toMatchObject({ id: 'tenant-new-menu', restaurantId: a.restaurant.id });
      // And its menu rows can be written through the same client.
      expect((await db.table.create({ data: { number: 1, label: 'T1' } as never })).menuId).toBe('tenant-new-menu');
    });

    it('leaves slugs, domains and users unfiltered, and Restaurant and Membership without a restaurant', async () => {
      // What the handler must key by trusted ids itself (see ActionContext.transaction).
      expect(await restaurantDb(prisma, a.restaurant.id).menuSlug.count()).toBe(2);
      expect(await restaurantDb(prisma, a.restaurant.id).user.count()).toBe(3);
      expect(await menuDb(prisma, a.menu.id).restaurant.count()).toBe(2);
      expect(await menuDb(prisma, a.menu.id).membership.count()).toBe(2);
      expect(await globalDb(prisma).membership.count()).toBe(2);
    });
  });
});
