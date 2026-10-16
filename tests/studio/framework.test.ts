import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { loadActor, type Actor } from '@/server/studio/auth/actor';
import { defineAction, runAction, type CheckedTarget } from '@/server/studio/framework/action';
import { updateWithVersion } from '@/server/studio/framework/concurrency';
import { actorScope, defineQuery, runQuery } from '@/server/studio/framework/query';
import { StudioError, type ActionResult } from '@/server/studio/framework/result';
import { createMenuFixture, resetTestData, testPrisma } from '../helpers/db';

const prisma = testPrisma();
const META = { ip: '203.0.113.7', userAgent: 'vitest' };

/** The error code of a result, or `OK`. */
const codeOf = (result: ActionResult<unknown>) => (result.ok ? 'OK' : result.error.code);

/** Silences `console.error` for the test; the returned function reads what has been logged. */
function captureErrors(): () => string {
  const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
  return () => spy.mock.calls.flat().map(String).join('\n');
}

const restaurantInput = z.object({ restaurantId: z.string().min(1) });
const atRestaurant = (input: { restaurantId: string }) => ({ kind: 'restaurant' as const, restaurantId: input.restaurantId });
const menuInput = z.object({ menuId: z.string().min(1) });
const atMenu = (input: { menuId: string }) => ({ kind: 'menu' as const, menuId: input.menuId });

/** The test-only action the brief describes: renames a restaurant with a version check and audits the change. */
const rename = defineAction({
  name: 'test.rename',
  permission: 'restaurant.edit',
  input: z.object({
    restaurantId: z.string().min(1),
    name: z.string().trim().min(1).max(120),
    version: z.number().int().positive(),
  }),
  target: (i) => ({ kind: 'restaurant', restaurantId: i.restaurantId }),
  run: (ctx, input) =>
    ctx.transaction(async (tx) => {
      const before = await tx.restaurant.findUniqueOrThrow({ where: { id: input.restaurantId }, select: { name: true } });
      await updateWithVersion(
        tx.restaurant,
        { id: input.restaurantId, version: input.version, data: { name: input.name }, entityType: 'Restaurant' },
        tx,
      );
      ctx.audit({
        action: 'restaurant.rename',
        entityType: 'Restaurant',
        entityId: input.restaurantId,
        changes: { name: { before: before.name, after: input.name } },
      });
      return { name: input.name };
    }),
});

describe('Studio action framework', () => {
  let a: Awaited<ReturnType<typeof createMenuFixture>>;
  let b: Awaited<ReturnType<typeof createMenuFixture>>;
  let designerOfA: Actor;
  let ownerOfA: Actor;
  let ownerOfB: Actor;
  let superAdmin: Actor;
  let superAdminWithoutTwoFactor: Actor;

  /** A user with memberships, loaded the way a request loads its actor. */
  async function person(
    id: string,
    name: string,
    memberships: Array<[string, 'DESIGNER' | 'OWNER']>,
    flags: { isSuperAdmin?: boolean; twoFactorEnabled?: boolean } = {},
  ): Promise<Actor> {
    await prisma.user.create({ data: { id, name, email: `${id}@example.com`, ...flags } });
    for (const [restaurantId, role] of memberships) {
      await prisma.membership.create({ data: { userId: id, restaurantId, role } });
    }
    return (await loadActor(prisma, id)) as Actor;
  }

  const inputForA = () => ({ restaurantId: a.restaurant.id, name: 'Alpha Renamed', version: 1 });

  beforeAll(async () => {
    await resetTestData(prisma);
  });

  beforeEach(async () => {
    await resetTestData(prisma);
    a = await createMenuFixture(prisma, 'fw-a', { publish: false });
    b = await createMenuFixture(prisma, 'fw-b', { publish: false });
    designerOfA = await person('designer-a', 'Dana Designer', [[a.restaurant.id, 'DESIGNER']]);
    ownerOfA = await person('owner-a', 'Omar Owner', [[a.restaurant.id, 'OWNER']]);
    ownerOfB = await person('owner-b', 'Bea Owner', [[b.restaurant.id, 'OWNER']]);
    superAdmin = await person('admin', 'Sam Admin', [], { isSuperAdmin: true, twoFactorEnabled: true });
    superAdminWithoutTwoFactor = await person('admin-no-2fa', 'Nia Admin', [], { isSuperAdmin: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await resetTestData(prisma);
    await prisma.$disconnect();
  });

  describe('runAction', () => {
    it('refuses without an actor', async () => {
      expect(codeOf(await runAction(prisma, null, rename, inputForA(), META))).toBe('UNAUTHENTICATED');
      // Before anything else: not even the input is looked at.
      expect(codeOf(await runAction(prisma, null, rename, 'garbage', META))).toBe('UNAUTHENTICATED');
    });

    it('hides another restaurant as NOT_FOUND', async () => {
      expect(codeOf(await runAction(prisma, ownerOfB, rename, inputForA(), META))).toBe('NOT_FOUND');
    });

    it('answers a restaurant or menu that does not exist with the same NOT_FOUND', async () => {
      const missing = { restaurantId: 'no-such-restaurant', name: 'X', version: 1 };
      expect(codeOf(await runAction(prisma, designerOfA, rename, missing, META))).toBe('NOT_FOUND');
      expect(codeOf(await runAction(prisma, superAdmin, rename, missing, META))).toBe('NOT_FOUND');
      const touch = defineAction({
        name: 'test.touchMenu',
        permission: 'content.edit',
        input: menuInput,
        target: atMenu,
        run: async () => 'ran',
      });
      expect(codeOf(await runAction(prisma, superAdmin, touch, { menuId: 'no-such-menu' }, META))).toBe('NOT_FOUND');
    });

    it('refuses a member without the permission', async () => {
      expect(codeOf(await runAction(prisma, ownerOfA, rename, inputForA(), META))).toBe('FORBIDDEN');
      expect(await prisma.auditLog.count()).toBe(0);
    });

    it('lets a designer of A rename A and writes one audit row in the same transaction', async () => {
      const result = await runAction(prisma, designerOfA, rename, inputForA(), META);
      expect(result).toEqual({ ok: true, data: { name: 'Alpha Renamed' } });

      const restaurant = await prisma.restaurant.findUniqueOrThrow({ where: { id: a.restaurant.id } });
      expect(restaurant).toMatchObject({ name: 'Alpha Renamed', version: 2 });

      const rows = await prisma.auditLog.findMany();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        actorId: designerOfA.userId,
        restaurantId: a.restaurant.id,
        menuId: null,
        action: 'restaurant.rename',
        entityType: 'Restaurant',
        entityId: a.restaurant.id,
        changes: { name: { before: 'Restaurant fw-a', after: 'Alpha Renamed' } },
        ip: '203.0.113.7',
        userAgent: 'vitest',
      });
    });

    it('rolls the change back when its audit row cannot be written', async () => {
      const errors = captureErrors();
      let handlerFinished = false;
      const unauditable = defineAction({
        name: 'test.unauditable',
        permission: 'restaurant.edit',
        input: restaurantInput,
        target: atRestaurant,
        run: (ctx, input) =>
          ctx.transaction(async (tx) => {
            await tx.restaurant.update({ where: { id: input.restaurantId }, data: { name: 'Changed' } });
            // PostgreSQL refuses a NUL character in text, so the audit insert fails inside the transaction.
            ctx.audit({ action: 'restaurant.rename', entityType: 'Restaurant', entityId: 'bad\u0000id' });
            handlerFinished = true;
          }),
      });
      const result = await runAction(prisma, designerOfA, unauditable, { restaurantId: a.restaurant.id }, META);
      expect(result).toEqual({ ok: false, error: { code: 'INVALID', message: 'Something went wrong' } });
      // The handler's update ran and then the audit insert failed, so the update was rolled back with it.
      expect(handlerFinished).toBe(true);
      // Prisma's message would quote the row's values, so only its name and code are logged.
      expect(errors()).toMatch(/Action test\.unauditable failed with PrismaClient\w+ \(P\d+\)$/);
      expect((await prisma.restaurant.findUniqueOrThrow({ where: { id: a.restaurant.id } })).name).toBe('Restaurant fw-a');
      expect(await prisma.auditLog.count()).toBe(0);
    });

    it('writes no audit row when the handler throws, and logs the failure without the input', async () => {
      const errors = captureErrors();
      const failing = defineAction({
        name: 'test.failing',
        permission: 'restaurant.edit',
        input: z.object({ restaurantId: z.string(), note: z.string() }),
        target: atRestaurant,
        run: (ctx, input) =>
          ctx.transaction(async (tx) => {
            await tx.restaurant.update({ where: { id: input.restaurantId }, data: { name: 'Changed' } });
            ctx.audit({ action: 'restaurant.rename', entityType: 'Restaurant', entityId: input.restaurantId });
            throw new Error('The handler broke');
          }),
      });
      const result = await runAction(
        prisma,
        designerOfA,
        failing,
        { restaurantId: a.restaurant.id, note: 'pa55word-in-a-note' },
        META,
      );

      expect(result).toEqual({ ok: false, error: { code: 'INVALID', message: 'Something went wrong' } });
      expect((await prisma.restaurant.findUniqueOrThrow({ where: { id: a.restaurant.id } })).name).toBe('Restaurant fw-a');
      expect(await prisma.auditLog.count()).toBe(0);

      const text = errors();
      expect(text).toContain('test.failing');
      expect(text).toContain('The handler broke');
      expect(text).not.toContain('pa55word-in-a-note');
    });

    it('returns a thrown StudioError as its result', async () => {
      const refusing = defineAction({
        name: 'test.refusing',
        permission: 'restaurant.edit',
        input: restaurantInput,
        target: atRestaurant,
        run: async () => {
          throw new StudioError('INVALID', 'The name is taken', { name: 'Choose another name' });
        },
      });
      expect(await runAction(prisma, designerOfA, refusing, { restaurantId: a.restaurant.id }, META)).toEqual({
        ok: false,
        error: { code: 'INVALID', message: 'The name is taken', fields: { name: 'Choose another name' } },
      });
    });

    it('requires two-factor for a Super Admin who has not enabled it', async () => {
      expect(codeOf(await runAction(prisma, superAdminWithoutTwoFactor, rename, inputForA(), META))).toBe(
        'TWO_FACTOR_REQUIRED',
      );
      // Checked before the input.
      expect(codeOf(await runAction(prisma, superAdminWithoutTwoFactor, rename, 'garbage', META))).toBe(
        'TWO_FACTOR_REQUIRED',
      );
      // A Super Admin who has enabled it may act on any restaurant.
      expect(codeOf(await runAction(prisma, superAdmin, rename, inputForA(), META))).toBe('OK');
      // Designers and owners are not required to enable it.
      expect(designerOfA.twoFactorEnabled).toBe(false);
    });

    it('lets an action marked allowWithoutTwoFactor run for a Super Admin without it', async () => {
      const enrol = defineAction({
        name: 'test.enrol',
        permission: null,
        input: z.object({}),
        target: () => ({ kind: 'self' }),
        allowWithoutTwoFactor: true,
        run: async (ctx) => ctx.actor.userId,
      });
      expect(await runAction(prisma, superAdminWithoutTwoFactor, enrol, {}, META)).toEqual({ ok: true, data: 'admin-no-2fa' });
    });

    it('reports Zod field errors as INVALID with fields', async () => {
      const result = await runAction(
        prisma,
        designerOfA,
        rename,
        { restaurantId: a.restaurant.id, name: '   ', version: 'one' },
        META,
      );
      expect(result).toEqual({
        ok: false,
        error: { code: 'INVALID', message: expect.any(String), fields: { name: expect.any(String), version: expect.any(String) } },
      });

      const hours = defineAction({
        name: 'test.hours',
        permission: null,
        input: z.object({ hours: z.object({ mon: z.array(z.string().regex(/^\d\d:\d\d$/)) }) }),
        target: () => ({ kind: 'self' }),
        run: async () => 'ran',
      });
      const nested = await runAction(prisma, designerOfA, hours, { hours: { mon: ['08:00', '8am'] } }, META);
      expect(nested.ok ? null : Object.keys(nested.error.fields ?? {})).toEqual(['hours.mon.1']);

      expect(codeOf(await runAction(prisma, designerOfA, rename, null, META))).toBe('INVALID');
      // Checked before the target, so a malformed id is INVALID, not NOT_FOUND.
      expect(codeOf(await runAction(prisma, ownerOfB, rename, { restaurantId: '', name: 'X', version: 1 }, META))).toBe(
        'INVALID',
      );
    });

    it('raises CONFLICT with who changed the row when the version is stale', async () => {
      expect(codeOf(await runAction(prisma, designerOfA, rename, inputForA(), META))).toBe('OK');
      const saved = await prisma.auditLog.findFirstOrThrow();

      const stale = await runAction(prisma, superAdmin, rename, { ...inputForA(), name: 'Second' }, META);
      expect(stale).toEqual({
        ok: false,
        error: {
          code: 'CONFLICT',
          message: expect.any(String),
          fields: { changedBy: 'Dana Designer', changedAt: saved.occurredAt.toISOString() },
        },
      });
      expect((await prisma.restaurant.findUniqueOrThrow({ where: { id: a.restaurant.id } })).name).toBe('Alpha Renamed');
      expect(await prisma.auditLog.count()).toBe(1);

      // The version the first save produced is current.
      expect(codeOf(await runAction(prisma, superAdmin, rename, { ...inputForA(), name: 'Second', version: 2 }, META))).toBe(
        'OK',
      );
    });

    it('raises NOT_FOUND from updateWithVersion when the row is gone', async () => {
      const ghost = defineAction({
        name: 'test.ghost',
        permission: 'restaurant.edit',
        input: restaurantInput,
        target: atRestaurant,
        run: (ctx) =>
          ctx.transaction(async (tx) => {
            await updateWithVersion(tx.branch, { id: 'no-such-branch', version: 1, data: { name: 'X' }, entityType: 'Branch' }, tx);
          }),
      });
      expect(codeOf(await runAction(prisma, designerOfA, ghost, { restaurantId: a.restaurant.id }, META))).toBe('NOT_FOUND');
    });

    it('follows the client policy: a revoke refuses a designer, a grant admits an owner', async () => {
      await prisma.restaurant.update({
        where: { id: a.restaurant.id },
        data: { permissionPolicy: { DESIGNER: { grant: [], revoke: ['restaurant.edit'] }, OWNER: { grant: ['restaurant.edit'], revoke: [] } } },
      });
      expect(codeOf(await runAction(prisma, designerOfA, rename, inputForA(), META))).toBe('FORBIDDEN');
      expect(codeOf(await runAction(prisma, ownerOfA, rename, inputForA(), META))).toBe('OK');
    });

    it('resolves a menu to its restaurant and scopes the transaction to both', async () => {
      await prisma.branch.create({ data: { restaurantId: a.restaurant.id, name: 'A branch' } });
      await prisma.branch.create({ data: { restaurantId: b.restaurant.id, name: 'B branch' } });
      const inspect = defineAction({
        name: 'test.inspectMenu',
        permission: 'content.edit',
        input: menuInput,
        target: atMenu,
        run: (ctx) =>
          ctx.transaction(async (tx) => {
            ctx.audit({ action: 'menu.inspect', entityType: 'Menu', entityId: ctx.menuId as string });
            return {
              restaurantId: ctx.restaurantId,
              menuId: ctx.menuId,
              products: (await tx.product.findMany()).map((product) => product.id),
              branches: (await tx.branch.findMany()).map((branch) => branch.name),
            };
          }),
      });

      expect(await runAction(prisma, ownerOfA, inspect, { menuId: a.menu.id }, META)).toEqual({
        ok: true,
        data: { restaurantId: a.restaurant.id, menuId: a.menu.id, products: [a.product.id], branches: ['A branch'] },
      });
      expect(await prisma.auditLog.findFirstOrThrow()).toMatchObject({ restaurantId: a.restaurant.id, menuId: a.menu.id });
      expect(codeOf(await runAction(prisma, ownerOfB, inspect, { menuId: a.menu.id }, META))).toBe('NOT_FOUND');
    });

    it("refuses a restaurant transaction's reads of menu rows (fail closed across scope classes)", async () => {
      const errors = captureErrors();
      const peek = defineAction({
        name: 'test.peek',
        permission: 'restaurant.edit',
        input: restaurantInput,
        target: atRestaurant,
        run: (ctx) => ctx.transaction((tx) => tx.product.findMany()),
      });
      expect(await runAction(prisma, designerOfA, peek, { restaurantId: a.restaurant.id }, META)).toEqual({
        ok: false,
        error: { code: 'INVALID', message: 'Something went wrong' },
      });
      expect(errors()).toContain('Product is menu-scoped and this client has no menu');
    });

    it("cannot rename another restaurant's menu through an id smuggled into a restaurant action", async () => {
      const errors = captureErrors();
      const renameMenu = defineAction({
        name: 'test.menuRename',
        permission: 'menu.settings',
        input: z.object({ restaurantId: z.string().min(1), menuId: z.string().min(1), name: z.string().min(1) }),
        target: atRestaurant,
        run: (ctx, input) =>
          ctx.transaction(async (tx) => {
            await tx.menu.update({ where: { id: input.menuId }, data: { name: input.name } });
          }),
      });
      // The actor is a designer of A, so the target check passes; the menu id names B's menu.
      const smuggled = { restaurantId: a.restaurant.id, menuId: b.menu.id, name: 'Hijacked' };
      expect(codeOf(await runAction(prisma, designerOfA, renameMenu, smuggled, META))).toBe('INVALID');
      expect((await prisma.menu.findUniqueOrThrow({ where: { id: b.menu.id } })).name).toBe('Menu fw-b');
      expect(errors()).toMatch(/Action test\.menuRename failed with PrismaClientKnownRequestError \(P2025\)/);

      const own = { restaurantId: a.restaurant.id, menuId: a.menu.id, name: 'Renamed' };
      expect(codeOf(await runAction(prisma, designerOfA, renameMenu, own, META))).toBe('OK');
      expect((await prisma.menu.findUniqueOrThrow({ where: { id: a.menu.id } })).name).toBe('Renamed');
    });

    it('requires the permission at Super Admin level on a platform target', async () => {
      const create = defineAction({
        name: 'test.createRestaurant',
        permission: 'restaurant.create',
        input: z.object({ name: z.string().min(1) }),
        target: () => ({ kind: 'platform' }),
        run: (ctx, input) =>
          ctx.transaction(async (tx) => {
            const created = await tx.restaurant.create({ data: { name: input.name } });
            ctx.audit({ action: 'restaurant.create', entityType: 'Restaurant', entityId: created.id });
            return created.id;
          }),
      });
      expect(codeOf(await runAction(prisma, designerOfA, create, { name: 'Gamma' }, META))).toBe('FORBIDDEN');
      const made = await runAction(prisma, superAdmin, create, { name: 'Gamma' }, META);
      expect(made.ok).toBe(true);
      expect(await prisma.auditLog.findFirstOrThrow()).toMatchObject({
        actorId: superAdmin.userId,
        restaurantId: null,
        menuId: null,
        action: 'restaurant.create',
      });
    });

    describe("an audit entry's restaurant", () => {
      /** A platform action that makes a restaurant and files its audit row under `filedUnder(created id)`. */
      const createAndFile = (filedUnder: (createdId: string) => string | undefined) =>
        defineAction({
          name: 'test.audited.platform',
          permission: 'restaurant.create',
          input: z.object({}),
          target: () => ({ kind: 'platform' }),
          run: (ctx) =>
            ctx.transaction(async (tx) => {
              const created = await tx.restaurant.create({ data: { name: 'Filed' } });
              const restaurantId = filedUnder(created.id);
              ctx.audit({
                action: 'restaurant.created',
                entityType: 'Restaurant',
                entityId: created.id,
                ...(restaurantId === undefined ? {} : { restaurantId }),
              });
              return created.id;
            }),
        });

      /** A restaurant action that renames its restaurant and files its audit row under `filedUnder`. */
      const renameAndFile = (filedUnder: string) =>
        defineAction({
          name: 'test.audited.restaurant',
          permission: 'restaurant.edit',
          input: z.object({ restaurantId: z.string().min(1) }),
          target: (input): CheckedTarget => ({ kind: 'restaurant', restaurantId: input.restaurantId }),
          run: (ctx, input) =>
            ctx.transaction(async (tx) => {
              await tx.restaurant.update({ where: { id: input.restaurantId }, data: { name: 'Touched' } });
              ctx.audit({ action: 'restaurant.touched', entityType: 'Restaurant', entityId: input.restaurantId, restaurantId: filedUnder });
            }),
        });

      it('is filed under the restaurant the platform action names, so its Activity shows it', async () => {
        const made = await runAction(prisma, superAdmin, createAndFile((id) => id), {}, META);
        const createdId = (made as { ok: true; data: string }).data;
        expect(await prisma.auditLog.findFirstOrThrow()).toMatchObject({ restaurantId: createdId, entityId: createdId, menuId: null });
      });

      it('stays null on a platform action that names none', async () => {
        await runAction(prisma, superAdmin, createAndFile(() => undefined), {}, META);
        expect((await prisma.auditLog.findFirstOrThrow()).restaurantId).toBeNull();
      });

      it("accepts the target's own restaurant on a restaurant action", async () => {
        const own = renameAndFile(a.restaurant.id);
        expect(codeOf(await runAction(prisma, designerOfA, own, { restaurantId: a.restaurant.id }, META))).toBe('OK');
        expect((await prisma.auditLog.findFirstOrThrow()).restaurantId).toBe(a.restaurant.id);
      });

      it('refuses any other restaurant on a restaurant action as an internal error, and rolls the action back', async () => {
        const errors = captureErrors();
        const other = renameAndFile(b.restaurant.id);
        const result = await runAction(prisma, designerOfA, other, { restaurantId: a.restaurant.id }, META);
        // Nothing leaves the server but the generic answer; the log names the action.
        expect(result).toEqual({ ok: false, error: { code: 'INVALID', message: 'Something went wrong' } });
        expect(errors()).toMatch(/Action test.audited.restaurant failed with Error: An audit entry names a restaurant other than its target/);
        expect(await prisma.auditLog.count()).toBe(0);
        // The handler's own write went with it.
        expect((await prisma.restaurant.findUniqueOrThrow({ where: { id: a.restaurant.id } })).name).toBe('Restaurant fw-a');
        expect((await prisma.restaurant.findUniqueOrThrow({ where: { id: b.restaurant.id } })).name).toBe('Restaurant fw-b');
      });
    });

    it('lets anyone signed in act on their own account through a self target, with no tenant rows', async () => {
      const errors = captureErrors();
      const whoAmI = defineAction({
        name: 'test.whoAmI',
        permission: null,
        input: z.object({}),
        target: () => ({ kind: 'self' }),
        run: async (ctx) => ({ userId: ctx.actor.userId, restaurantId: ctx.restaurantId, menuId: ctx.menuId }),
      });
      expect(await runAction(prisma, ownerOfB, whoAmI, {}, META)).toEqual({
        ok: true,
        data: { userId: 'owner-b', restaurantId: null, menuId: null },
      });
      expect(codeOf(await runAction(prisma, superAdminWithoutTwoFactor, whoAmI, {}, META))).toBe('TWO_FACTOR_REQUIRED');

      const snoop = defineAction({
        name: 'test.snoop',
        permission: null,
        input: z.object({}),
        target: () => ({ kind: 'self' }),
        run: (ctx) => ctx.transaction((tx) => tx.branch.findMany()),
      });
      expect(codeOf(await runAction(prisma, ownerOfB, snoop, {}, META))).toBe('INVALID');
      expect(errors()).toContain('Branch is restaurant-scoped and this client has no restaurant');
    });

    it('writes the audit rows of an action that has no transaction once it has finished, and caps ip and user agent', async () => {
      const exportMenu = defineAction({
        name: 'test.export',
        permission: 'export.run',
        input: menuInput,
        target: atMenu,
        run: async (ctx) => {
          ctx.audit({ action: 'menu.export', entityType: 'Menu', entityId: ctx.menuId as string });
          return 'name,price';
        },
      });
      const long = { ip: '9'.repeat(100), userAgent: 'u'.repeat(600) };
      expect(await runAction(prisma, designerOfA, exportMenu, { menuId: a.menu.id }, long)).toEqual({ ok: true, data: 'name,price' });
      const row = await prisma.auditLog.findFirstOrThrow();
      expect(row).toMatchObject({ action: 'menu.export', restaurantId: a.restaurant.id, menuId: a.menu.id });
      expect(row.ip).toHaveLength(64);
      expect(row.userAgent).toHaveLength(512);
    });

    it('runs afterCommit callbacks once the transaction has committed, and never after a rollback', async () => {
      const events: string[] = [];
      let auditRowsSeen: Promise<number> | undefined;
      const save = defineAction({
        name: 'test.afterCommit',
        permission: 'restaurant.edit',
        input: z.object({ restaurantId: z.string(), fail: z.boolean() }),
        target: atRestaurant,
        run: async (ctx, input) => {
          await ctx.transaction(async (tx) => {
            ctx.afterCommit(() => {
              events.push('afterCommit');
              // Another connection: it sees the audit row only if the transaction has committed.
              auditRowsSeen = prisma.auditLog.count();
            });
            await tx.restaurant.update({ where: { id: input.restaurantId }, data: { name: 'Saved' } });
            ctx.audit({ action: 'restaurant.rename', entityType: 'Restaurant', entityId: input.restaurantId });
            if (input.fail) throw new StudioError('CONFLICT', 'Changed elsewhere');
            events.push('body done');
          });
          return 'saved';
        },
      });

      expect(codeOf(await runAction(prisma, designerOfA, save, { restaurantId: a.restaurant.id, fail: true }, META))).toBe(
        'CONFLICT',
      );
      expect(events).toEqual([]);

      expect(codeOf(await runAction(prisma, designerOfA, save, { restaurantId: a.restaurant.id, fail: false }, META))).toBe('OK');
      expect(events).toEqual(['body done', 'afterCommit']);
      expect(await auditRowsSeen).toBe(1);
    });

    it('refuses an action whose permission is set but whose target is self', async () => {
      const errors = captureErrors();
      const ran = vi.fn(async () => 'ran');
      const confused = defineAction({
        name: 'test.confused',
        permission: 'restaurant.edit',
        input: z.object({}),
        target: () => ({ kind: 'self' }) as never,
        run: ran,
      });
      expect(codeOf(await runAction(prisma, superAdmin, confused, {}, META))).toBe('INVALID');
      expect(ran).not.toHaveBeenCalled();
      expect(errors()).toContain('a self target takes permission null');
    });
  });

  describe('defineAction and defineQuery', () => {
    it('refuses permission null with any target but self, in its type and when the action is defined', () => {
      expect(() =>
        // @ts-expect-error -- permission null is only allowed with a self target
        defineAction({
          name: 'test.unguarded',
          permission: null,
          input: restaurantInput,
          target: atRestaurant,
          run: async () => 'ran',
        }),
      ).toThrow(/self/);
      expect(() =>
        defineQuery({
          name: 'test.unguardedQuery',
          permission: null,
          input: z.object({}),
          target: (() => ({ kind: 'platform' })) as never,
          run: async () => 'ran',
        }),
      ).toThrow(/self/);
    });

    it('refuses an unknown permission key', () => {
      expect(() =>
        defineAction({
          name: 'test.unknown',
          permission: 'menu.fly' as never,
          input: z.object({}),
          target: () => ({ kind: 'platform' }),
          run: async () => 'ran',
        }),
      ).toThrow(/menu\.fly/);
    });
  });

  describe('runQuery', () => {
    const restaurantNames = defineQuery({
      name: 'test.restaurantNames',
      permission: 'view',
      input: z.object({}),
      target: () => ({ kind: 'platform' }),
      run: async ({ db, scope }) => {
        const rows = await db.restaurant.findMany({
          where: scope.kind === 'all' ? {} : { id: { in: scope.ids } },
          orderBy: { name: 'asc' },
          select: { name: true },
        });
        return rows.map((row) => row.name);
      },
    });

    const profile = defineQuery({
      name: 'test.profile',
      permission: 'view',
      input: restaurantInput,
      target: atRestaurant,
      run: async ({ db, restaurantId, permissions }) => ({
        name: (await db.restaurant.findUniqueOrThrow({ where: { id: restaurantId as string } })).name,
        canEdit: permissions.has('restaurant.edit'),
      }),
    });

    it('limits a designer query to assigned restaurants', async () => {
      expect(await runQuery(prisma, designerOfA, restaurantNames, {})).toEqual({ ok: true, data: ['Restaurant fw-a'] });
      expect(await runQuery(prisma, superAdmin, restaurantNames, {})).toEqual({
        ok: true,
        data: ['Restaurant fw-a', 'Restaurant fw-b'],
      });
      expect(actorScope(designerOfA)).toEqual({ kind: 'restaurants', ids: [a.restaurant.id] });
      expect(actorScope(superAdmin)).toEqual({ kind: 'all' });
    });

    it('applies the same checks as an action', async () => {
      expect(codeOf(await runQuery(prisma, null, restaurantNames, {}))).toBe('UNAUTHENTICATED');
      expect(codeOf(await runQuery(prisma, superAdminWithoutTwoFactor, restaurantNames, {}))).toBe('TWO_FACTOR_REQUIRED');
      expect(codeOf(await runQuery(prisma, designerOfA, profile, { restaurantId: 7 }))).toBe('INVALID');
      expect(codeOf(await runQuery(prisma, ownerOfB, profile, { restaurantId: a.restaurant.id }))).toBe('NOT_FOUND');
    });

    it("lets 'view' through for members and hands the query their permissions there", async () => {
      expect(await runQuery(prisma, ownerOfA, profile, { restaurantId: a.restaurant.id })).toEqual({
        ok: true,
        data: { name: 'Restaurant fw-a', canEdit: false },
      });
      expect(await runQuery(prisma, designerOfA, profile, { restaurantId: a.restaurant.id })).toEqual({
        ok: true,
        data: { name: 'Restaurant fw-a', canEdit: true },
      });
    });

    it('refuses a platform permission to anyone but a Super Admin', async () => {
      const activity = defineQuery({
        name: 'test.activity',
        permission: 'audit.view',
        input: z.object({}),
        target: () => ({ kind: 'platform' }),
        run: async () => [],
      });
      expect(codeOf(await runQuery(prisma, designerOfA, activity, {}))).toBe('FORBIDDEN');
      expect(await runQuery(prisma, superAdmin, activity, {})).toEqual({ ok: true, data: [] });
    });

    it('refuses a member without a named permission', async () => {
      const exportable = defineQuery({
        name: 'test.exportable',
        permission: 'export.run',
        input: menuInput,
        target: atMenu,
        run: async ({ restaurantId, menuId }) => ({ restaurantId, menuId }),
      });
      expect(codeOf(await runQuery(prisma, ownerOfA, exportable, { menuId: a.menu.id }))).toBe('FORBIDDEN');
      expect(await runQuery(prisma, designerOfA, exportable, { menuId: a.menu.id })).toEqual({
        ok: true,
        data: { restaurantId: a.restaurant.id, menuId: a.menu.id },
      });
    });
  });
});
