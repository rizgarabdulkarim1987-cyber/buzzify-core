import { z } from 'zod';
import { expireMenu } from '@/server/data/cache';
import { PLAN_TIERS } from '@/server/domain/entitlements';
import { defineAction, type ActionContext } from '@/server/studio/framework/action';
import { updateWithVersion } from '@/server/studio/framework/concurrency';
import { describeError, StudioError } from '@/server/studio/framework/result';
import { deleteUnsharedFiles } from '@/server/studio/services/media';
import {
  addedFields,
  arrangeBranches,
  branchData,
  branchInput,
  branchProfileOf,
  changedFields,
  menuAddresses,
  pickBranch,
  pickProfile,
  profileData,
  profileOf,
  refreshDraftHashes,
  removeRestaurant,
  restaurantInput,
  restaurantStatus,
  seesAgencyNotes,
} from '@/server/studio/services/restaurants';

/**
 * Restaurants and their branches. Creating a restaurant is a platform action (`restaurant.create`, which only Super
 * Admins hold); everything else acts on one restaurant. Profile and branch saves carry the version the form started
 * from and are refused, with who changed the row and when, if it has moved on. Every change writes its audit row in the
 * same transaction, under the restaurant it concerns.
 */

const idField = z.string().min(1).max(100);
const versionField = z.number().int().positive();

const PLATFORM = { kind: 'platform' } as const;
const atRestaurant = (restaurantId: string) => ({ kind: 'restaurant', restaurantId }) as const;

/** The restaurant a restaurant-target action works on. The framework has already resolved it. */
function restaurantOf(ctx: ActionContext): string {
  if (ctx.restaurantId === null) throw new Error('A restaurant action ran without a restaurant');
  return ctx.restaurantId;
}

// The restaurant ------------------------------------------------------------------------------------------------------

export const createRestaurant = defineAction({
  name: 'restaurants.create',
  permission: 'restaurant.create',
  // The plan is the platform owner's to choose; from anyone else it is ignored and the restaurant starts on Basic.
  input: restaurantInput.extend({ plan: z.enum(PLAN_TIERS, 'Choose one of the plans offered').optional() }),
  target: () => PLATFORM,
  run: (ctx, { plan: chosen, ...input }) =>
    ctx.transaction(async (tx) => {
      const plan = ctx.actor.isPlatformOwner ? (chosen ?? 'BASIC') : 'BASIC';
      const created = await tx.restaurant.create({ data: { ...profileData(input), plan }, select: { id: true } });
      // A platform action has no restaurant of its own, so it names the one it made: its Activity tab starts here.
      ctx.audit({
        action: 'restaurant.created',
        entityType: 'Restaurant',
        entityId: created.id,
        restaurantId: created.id,
        changes: { ...addedFields(input), plan: { before: null, after: plan } },
      });
      return { restaurantId: created.id };
    }),
});

export const updateRestaurant = defineAction({
  name: 'restaurants.update',
  permission: 'restaurant.edit',
  input: restaurantInput.extend({
    restaurantId: idField,
    version: versionField,
    // The restaurant's logo in its library (or the shared one); left out, it stays as it is.
    logoAssetId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).nullable().optional(),
  }),
  target: (i) => atRestaurant(i.restaurantId),
  run: async (ctx, { version, logoAssetId, ...fields }) => {
    const saved = await ctx.transaction(async (tx) => {
      const restaurantId = restaurantOf(ctx);
      const input = pickProfile(fields);
      const row = await tx.restaurant.findUnique({ where: { id: restaurantId } });
      if (!row) throw new StudioError('NOT_FOUND');
      const before = profileOf(row);
      // The agency's notes are not the client's to read, so an owner's save cannot write them either.
      const next = { ...input, notes: seesAgencyNotes(ctx.actor, restaurantId) ? input.notes : before.notes };
      const changes: Record<string, { before: unknown; after: unknown }> = changedFields(before, next);
      const logoChanged = logoAssetId !== undefined && logoAssetId !== row.logoAssetId;
      if (logoChanged && logoAssetId !== null && !(await tx.mediaAsset.findFirst({ where: { id: logoAssetId }, select: { id: true } }))) {
        throw new StudioError('NOT_FOUND');
      }
      if (logoChanged) changes.logoAssetId = { before: row.logoAssetId, after: logoAssetId };
      if (Object.keys(changes).length === 0) return { version: row.version, menuIds: [] };

      const data = { ...profileData(next), ...(logoChanged ? { logoAssetId } : {}) };
      await updateWithVersion(tx.restaurant, { id: restaurantId, version, data, entityType: 'Restaurant' }, tx);
      ctx.audit({ action: 'restaurant.updated', entityType: 'Restaurant', entityId: restaurantId, changes });
      // Guests see the restaurant's name on every menu (it is part of the published snapshot), so a new name is a change
      // to each menu's draft; nothing else in the profile reaches a menu.
      const menuIds = 'name' in changes ? (await tx.menu.findMany({ select: { id: true } })).map((menu) => menu.id) : [];
      return { version: version + 1, menuIds };
    });
    // Once the rename has committed, and before answering, so the page the person opens next already says the menus
    // have unpublished changes. The restaurant's client cannot read menu rows, so this uses the application's client.
    await refreshDraftHashes(ctx.db, saved.menuIds);
    return { version: saved.version };
  },
});

export const setRestaurantStatus = defineAction({
  name: 'restaurants.setStatus',
  permission: 'restaurant.status',
  input: z.object({ restaurantId: idField, status: restaurantStatus }),
  target: (i) => atRestaurant(i.restaurantId),
  run: (ctx, { status }) =>
    ctx.transaction(async (tx) => {
      const restaurantId = restaurantOf(ctx);
      const row = await tx.restaurant.findUnique({ where: { id: restaurantId }, select: { status: true } });
      if (!row) throw new StudioError('NOT_FOUND');
      if (row.status === status) return { status };

      // The status is not a field of the profile form, so it does not move the profile's version.
      await tx.restaurant.update({ where: { id: restaurantId }, data: { status } });
      // Filed apart from the profile, whose version this does not move, so a refused profile save names who last edited
      // the profile rather than who last changed the status.
      ctx.audit({
        action: 'restaurant.status_changed',
        entityType: 'RestaurantStatus',
        entityId: restaurantId,
        changes: { status: { before: row.status, after: status } },
      });

      // The public page reads the restaurant's status live, but it caches what each address resolves to: every address
      // of every menu is expired once this has committed, so guests see the change at once.
      const menus = await menuAddresses(tx);
      ctx.afterCommit(() => {
        for (const { menuId, slugs } of menus) expireMenu(slugs, menuId);
      });
      return { status };
    }),
});

export const deleteRestaurant = defineAction({
  name: 'restaurants.delete',
  permission: 'restaurant.delete',
  input: z.object({ restaurantId: idField, confirmName: z.string().max(200) }),
  target: (i) => atRestaurant(i.restaurantId),
  run: async (ctx, { confirmName }) => {
    const restaurantId = restaurantOf(ctx);
    const pictures = await ctx.transaction(async (tx) => {
      // Read before the deletion cascades to them: their files go once it has committed.
      const assets = await tx.mediaAsset.findMany({ where: { restaurantId }, select: { storageKey: true, variants: true } });
      const removed = await removeRestaurant(tx, { restaurantId, confirmName });
      ctx.audit({
        action: 'restaurant.deleted',
        entityType: 'Restaurant',
        entityId: restaurantId,
        changes: {
          name: { before: removed.name, after: null },
          ...(removed.memberships > 0 ? { memberships: { before: removed.memberships, after: 0 } } : {}),
          ...(removed.invitations > 0 ? { invitations: { before: removed.invitations, after: 0 } } : {}),
          ...(removed.branches > 0 ? { branches: { before: removed.branches, after: 0 } } : {}),
        },
      });
      return assets;
    });
    try {
      await deleteUnsharedFiles(ctx.db, pictures);
    } catch (error) {
      // The restaurant is gone either way; files left behind are only storage, and the log says which restaurant.
      console.error(`[studio] Deleting the files of restaurant ${restaurantId} failed with ${describeError(error)}`);
    }
    return { deleted: true as const };
  },
});

// Branches ------------------------------------------------------------------------------------------------------------

export const createBranch = defineAction({
  name: 'restaurants.createBranch',
  permission: 'restaurant.edit',
  input: branchInput.extend({ restaurantId: idField }),
  target: (i) => atRestaurant(i.restaurantId),
  run: (ctx, fields) =>
    ctx.transaction(async (tx) => {
      const input = pickBranch(fields);
      // New branches go last.
      const last = await tx.branch.aggregate({ _max: { sortOrder: true } });
      const created = await tx.branch.create({
        data: { ...branchData(input), restaurantId: restaurantOf(ctx), sortOrder: (last._max.sortOrder ?? -1) + 1 },
        select: { id: true },
      });
      ctx.audit({ action: 'branch.created', entityType: 'Branch', entityId: created.id, changes: { name: { before: null, after: input.name } } });
      return { branchId: created.id };
    }),
});

export const updateBranch = defineAction({
  name: 'restaurants.updateBranch',
  permission: 'restaurant.edit',
  input: branchInput.extend({ restaurantId: idField, branchId: idField, version: versionField }),
  target: (i) => atRestaurant(i.restaurantId),
  run: (ctx, { branchId, version, ...fields }) =>
    ctx.transaction(async (tx) => {
      const input = pickBranch(fields);
      const row = await tx.branch.findFirst({ where: { id: branchId } });
      if (!row) throw new StudioError('NOT_FOUND');
      const changes = changedFields(branchProfileOf(row), input);
      if (Object.keys(changes).length === 0) return { version: row.version };

      await updateWithVersion(tx.branch, { id: branchId, version, data: branchData(input), entityType: 'Branch' }, tx);
      ctx.audit({ action: 'branch.updated', entityType: 'Branch', entityId: branchId, changes });
      return { version: version + 1 };
    }),
});

export const deleteBranch = defineAction({
  name: 'restaurants.deleteBranch',
  permission: 'restaurant.edit',
  input: z.object({ restaurantId: idField, branchId: idField }),
  target: (i) => atRestaurant(i.restaurantId),
  run: (ctx, { branchId }) =>
    ctx.transaction(async (tx) => {
      const row = await tx.branch.findFirst({ where: { id: branchId }, select: { id: true, name: true } });
      if (!row) throw new StudioError('NOT_FOUND');
      await tx.branch.deleteMany({ where: { id: row.id } });
      ctx.audit({ action: 'branch.deleted', entityType: 'Branch', entityId: row.id, changes: { name: { before: row.name, after: null } } });
      return { deleted: true as const };
    }),
});

export const reorderBranches = defineAction({
  name: 'restaurants.reorderBranches',
  permission: 'restaurant.edit',
  input: z.object({
    restaurantId: idField,
    order: z
      .array(idField)
      .min(1)
      .max(500)
      .refine((ids) => new Set(ids).size === ids.length, 'Each branch can be listed only once'),
  }),
  target: (i) => atRestaurant(i.restaurantId),
  run: (ctx, { order }) =>
    ctx.transaction(async (tx) => {
      const restaurantId = restaurantOf(ctx);
      const { before, after } = await arrangeBranches(tx, order);
      if (JSON.stringify(before) !== JSON.stringify(after)) {
        // The order of the restaurant's branches, filed apart from the profile and from each branch (a reorder moves no
        // version), so a refused save of either names who changed that row.
        ctx.audit({ action: 'branch.reordered', entityType: 'BranchOrder', entityId: restaurantId, changes: { order: { before, after } } });
      }
      return { order: after };
    }),
});
