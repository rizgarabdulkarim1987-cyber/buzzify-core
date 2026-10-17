import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { snapshotHash } from '@/server/domain/snapshot';
import { loadDraftSnapshot } from '@/server/publish/draft';
import { loadActor, type Actor } from '@/server/studio/auth/actor';
import { defineAction, runAction } from '@/server/studio/framework/action';
import { StudioError } from '@/server/studio/framework/result';
import { editDraft } from '@/server/studio/services/draft-edit';
import { createMenuFixture, resetTestData, testPrisma } from '../helpers/db';

const prisma = testPrisma();
const META = { ip: '203.0.113.7', userAgent: 'vitest' };

/** A test-only edit: sets a product's price through `editDraft`, and fails afterwards when asked to. */
const setPrice = defineAction({
  name: 'test.setPrice',
  permission: 'content.prices',
  input: z.object({ menuId: z.string(), productId: z.string(), price: z.number().int(), failAfter: z.boolean().default(false) }),
  target: (i) => ({ kind: 'menu', menuId: i.menuId }),
  run: (ctx, input) =>
    editDraft(ctx, async (tx) => {
      await tx.product.update({ where: { id: input.productId }, data: { basePrice: input.price } });
      if (input.failAfter) throw new StudioError('INVALID', 'Refused after the write');
      return { price: input.price };
    }),
});

/** The same edit with a restaurant target, which has no menu to refresh. */
const withoutMenu = defineAction({
  name: 'test.withoutMenu',
  permission: 'restaurant.edit',
  input: z.object({ restaurantId: z.string() }),
  target: (i) => ({ kind: 'restaurant', restaurantId: i.restaurantId }),
  run: (ctx) => editDraft(ctx, async () => 'unreachable'),
});

describe('editDraft', () => {
  let a: Awaited<ReturnType<typeof createMenuFixture>>;
  let owner: Actor;

  beforeEach(async () => {
    await resetTestData(prisma);
    a = await createMenuFixture(prisma, 'draft-edit');
    await prisma.user.create({ data: { id: 'owner-de', name: 'Owner', email: 'owner-de@example.com' } });
    await prisma.membership.create({ data: { userId: 'owner-de', restaurantId: a.restaurant.id, role: 'OWNER' } });
    owner = (await loadActor(prisma, 'owner-de')) as Actor;
  });

  afterAll(async () => {
    await resetTestData(prisma);
    await prisma.$disconnect();
  });

  it('stores the hash of the draft as it stands at commit', async () => {
    const before = await prisma.menu.findUniqueOrThrow({ where: { id: a.menu.id } });
    const result = await runAction(prisma, owner, setPrice, { menuId: a.menu.id, productId: a.product.id, price: 450 }, META);
    expect(result).toEqual({ ok: true, data: { price: 450 } });

    const menu = await prisma.menu.findUniqueOrThrow({ where: { id: a.menu.id } });
    expect(menu.draftHash).not.toBe(before.draftHash);
    expect(menu.draftHash).toBe(snapshotHash(await loadDraftSnapshot(prisma, a.menu.id)));
    // The draft now differs from what guests see.
    expect(menu.draftHash).not.toBe(menu.liveHash);
  });

  it('rolls the edit and the hash back together when the handler throws', async () => {
    const before = await prisma.menu.findUniqueOrThrow({ where: { id: a.menu.id } });
    const result = await runAction(
      prisma,
      owner,
      setPrice,
      { menuId: a.menu.id, productId: a.product.id, price: 999, failAfter: true },
      META,
    );
    expect(result.ok).toBe(false);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: a.product.id } })).basePrice).toBe(300);
    expect((await prisma.menu.findUniqueOrThrow({ where: { id: a.menu.id } })).draftHash).toBe(before.draftHash);
  });

  it('refuses to run for an action without a menu', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    await prisma.user.update({ where: { id: 'owner-de' }, data: { isSuperAdmin: true, twoFactorEnabled: true } });
    const admin = (await loadActor(prisma, 'owner-de')) as Actor;
    const result = await runAction(prisma, admin, withoutMenu, { restaurantId: a.restaurant.id }, META);
    expect(result.ok).toBe(false);
    expect(errors.mock.calls.flat().join(' ')).toMatch(/editDraft/);
    errors.mockRestore();
  });
});
