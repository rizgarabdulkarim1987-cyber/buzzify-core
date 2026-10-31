import { z } from 'zod';
import type { Prisma } from '@/generated/prisma/client';
import { parseOverrides } from '@/lib/templates/resolve';
import { expireMenu } from '@/server/data/cache';
import { allows } from '@/server/domain/entitlements';
import { nextMenuStatus } from '@/server/domain/menu-status';
import { bestRail, clampBrandChoices, sceneFeature } from '@/server/domain/plan-choices';
import { snapshotAssetIds } from '@/server/domain/snapshot';
import { COPYABLE, copyAssetsForMenu } from '@/server/media/copy';
import { loadDraftSnapshot, refreshDraftHash, writeDraftFromSnapshot } from '@/server/publish/draft';
import { PublishError, publishMenu } from '@/server/publish/publish';
import { defineAction, runAction, type ActionContext } from '@/server/studio/framework/action';
import { updateWithVersion } from '@/server/studio/framework/concurrency';
import { StudioError } from '@/server/studio/framework/result';
import { getPlatformSettings } from '@/server/studio/services/settings';
import { storedChoices } from '@/server/studio/services/brand';
import { entitlementsFor } from '@/server/data/plans';
import {
  BULK_ACTIONS,
  claimSlug,
  type BulkResult,
  DEFAULT_SCHEDULE,
  defaultBrand,
  isUniqueViolation,
  menuName,
  menuSlugs,
  newMenuInput,
  requireSlugAvailable,
  slugField,
  slugRefusal,
  statusAction,
} from '@/server/studio/services/menus';
import { settingsFields, updateSettings as saveSettings } from '@/server/studio/services/menu-settings';
import { pendingSchedule } from '@/server/publish/revisions';

/**
 * Menus: creating one in a restaurant, publishing it, changing its status and its address, duplicating and deleting it,
 * and doing one of those to many at once. Each change writes its audit row in the same transaction and expires every
 * cached address of the menu once it has committed, so guests see it at once.
 *
 * Audit rows for changes that move the menu's `version` (its address, a publish, which takes the row as its lock) are
 * filed as `Menu`, so a save refused for a stale version names who made the change in between. A status change does not
 * move the version and is filed as `MenuStatus`.
 */

const idField = z.string().min(1).max(100);
const versionField = z.number().int().positive();

const atMenu = (menuId: string) => ({ kind: 'menu', menuId }) as const;
const atRestaurant = (restaurantId: string) => ({ kind: 'restaurant', restaurantId }) as const;

/** The menu a menu-target action works on. The framework has already resolved it. */
function menuOf(ctx: ActionContext): string {
  if (ctx.menuId === null) throw new Error('A menu action ran without a menu');
  return ctx.menuId;
}

/** The restaurant a restaurant- or menu-target action works in. */
function restaurantOf(ctx: ActionContext): string {
  if (ctx.restaurantId === null) throw new Error('A menu action ran without a restaurant');
  return ctx.restaurantId;
}

const json = (value: unknown) => value as Prisma.InputJsonValue;

// Creating ------------------------------------------------------------------------------------------------------------

export const MENUS_FOOD_ONLY = 'Menus are only for food businesses';

export const createMenu = defineAction({
  name: 'menus.create',
  permission: 'menu.create',
  input: newMenuInput,
  target: (i) => atRestaurant(i.restaurantId),
  run: async (ctx, input) => {
    const restaurantId = restaurantOf(ctx);
    // What the form leaves out is the platform's default (Settings), and the default language must be one of the languages.
    const defaults = (await getPlatformSettings(ctx.db)).defaults;
    const locales = input.locales ?? defaults.locales;
    const defaultLocale = input.defaultLocale ?? (locales.includes(defaults.defaultLocale) ? defaults.defaultLocale : locales[0]);
    if (defaultLocale === undefined || !locales.includes(defaultLocale)) {
      const message = 'Choose the default language among the menu languages';
      throw new StudioError('INVALID', message, { defaultLocale: message });
    }
    const currency = input.currency ?? defaults.currency;
    const timezone = input.timezone ?? defaults.timezone;
    // The menu's rows need a client scoped to it, so the transaction is scoped to the id it is about to get.
    const menuId = ctx.newId();
    await ctx.transactionIn({ restaurantId, menuId }, async (tx) => {
      const restaurant = await tx.restaurant.findUnique({ where: { id: restaurantId }, select: { name: true, logoAssetId: true, sector: true } });
      if (!restaurant) throw new StudioError('NOT_FOUND');
      // Menus are a food business's product; a pharmacy or retail shop has none.
      if (restaurant.sector !== 'FOOD') throw new StudioError('CONFLICT', MENUS_FOOD_ONLY);
      await requireSlugAvailable(tx, input.slug, null);
      try {
        await tx.menu.create({
          data: {
            id: menuId,
            restaurantId,
            name: input.name,
            slug: input.slug,
            locales,
            defaultLocale,
            currency,
            timezone,
            numeralSystem: input.numeralSystem,
          },
        });
      } catch (error) {
        if (isUniqueViolation(error)) throw slugRefusal('taken');
        throw error;
      }
      await claimSlug(tx, input.slug, menuId);
      // The restaurant's logo starts the new menu's brand kit, on the best rail its plan allows, so nothing in a new kit
      // is locked.
      const railStyle = ctx.plan ? bestRail(ctx.plan.entitlements) : undefined;
      await tx.brandConfig.create({ data: { menuId, ...defaultBrand(restaurant.name), logoAssetId: restaurant.logoAssetId, ...(railStyle ? { railStyle } : {}) } });
      await tx.daypartSchedule.createMany({ data: DEFAULT_SCHEDULE.map((window) => ({ menuId, ...window })) });
      await refreshDraftHash(tx, menuId);

      ctx.audit({
        action: 'menu.created',
        entityType: 'Menu',
        entityId: menuId,
        changes: {
          name: { before: null, after: input.name },
          slug: { before: null, after: input.slug },
          locales: { before: null, after: locales },
          currency: { before: null, after: currency },
        },
      });
      // A guest who tried the address before it existed left it cached as missing.
      ctx.afterCommit(() => expireMenu([input.slug], menuId));
    });
    return { menuId };
  },
});

// Publishing ----------------------------------------------------------------------------------------------------------

export const publish = defineAction({
  name: 'menus.publish',
  permission: 'publish.now',
  input: z.object({ menuId: idField, note: z.string().trim().max(500, 'This is too long').optional() }),
  target: (i) => atMenu(i.menuId),
  run: (ctx, { note }) =>
    ctx.transaction(async (tx) => {
      const menuId = menuOf(ctx);
      const before = await tx.menu.findUnique({ where: { id: menuId }, select: { liveRevision: { select: { number: true } } } });
      let outcome;
      try {
        outcome = await publishMenu(tx, { menuId, actorId: ctx.actor.userId, ...(note ? { note } : {}), now: new Date() });
      } catch (error) {
        if (error instanceof PublishError) {
          throw error.code === 'ARCHIVED' ? new StudioError('INVALID', 'Archived menus cannot be published') : new StudioError('NOT_FOUND');
        }
        throw error;
      }
      // Blocked: the issues go back to be listed, and the transaction (with the version it took) is rolled back.
      if (!outcome.ok) throw new StudioError('INVALID', 'This menu cannot be published yet', undefined, outcome.issues);

      ctx.audit({
        action: 'menu.published',
        entityType: 'Menu',
        entityId: menuId,
        changes: { revision: { before: before?.liveRevision?.number ?? null, after: outcome.number } },
      });
      const slugs = await menuSlugs(tx, menuId);
      ctx.afterCommit(() => expireMenu(slugs, menuId));
      // A revision scheduled for later still goes live at its time; the person is told it is waiting.
      return { revisionId: outcome.revisionId, number: outcome.number, warnings: outcome.warnings, pendingSchedule: await pendingSchedule(tx, menuId) };
    }),
});

// Status --------------------------------------------------------------------------------------------------------------

export const changeMenuStatus = defineAction({
  name: 'menus.changeStatus',
  permission: 'menu.status',
  input: z.object({ menuId: idField, action: statusAction }),
  target: (i) => atMenu(i.menuId),
  run: (ctx, { action }) =>
    ctx.transaction(async (tx) => {
      const menuId = menuOf(ctx);
      const row = await tx.menu.findUnique({
        where: { id: menuId },
        select: { status: true, statusBeforeArchive: true, liveRevisionId: true },
      });
      if (!row) throw new StudioError('NOT_FOUND');
      const next = nextMenuStatus(row.status, action, {
        hasLiveRevision: row.liveRevisionId !== null,
        statusBeforeArchive: row.statusBeforeArchive,
      });
      if (next === null) throw new StudioError('INVALID', 'This change is not possible from the current status');

      // Not a setting, so the version stays; the status it was read at must still be the status it changes from.
      const { count } = await tx.menu.updateMany({
        where: { id: menuId, status: row.status },
        data: { status: next, statusBeforeArchive: next === 'ARCHIVED' ? row.status : null },
      });
      if (count === 0) throw new StudioError('CONFLICT');

      ctx.audit({
        action: 'menu.status_changed',
        entityType: 'MenuStatus',
        entityId: menuId,
        changes: { status: { before: row.status, after: next } },
      });
      const slugs = await menuSlugs(tx, menuId);
      ctx.afterCommit(() => expireMenu(slugs, menuId));
      return { status: next };
    }),
});

// The address ---------------------------------------------------------------------------------------------------------

export const changeMenuSlug = defineAction({
  name: 'menus.changeSlug',
  permission: 'menu.settings',
  input: z.object({ menuId: idField, slug: slugField, version: versionField }),
  target: (i) => atMenu(i.menuId),
  run: (ctx, { slug, version }) =>
    ctx.transaction(async (tx) => {
      const menuId = menuOf(ctx);
      const row = await tx.menu.findUnique({ where: { id: menuId }, select: { slug: true, version: true } });
      if (!row) throw new StudioError('NOT_FOUND');
      if (row.slug === slug) return { slug, version: row.version };

      // Its own former addresses are the menu's to take back; anyone else's, or a deleted menu's, never.
      await requireSlugAvailable(tx, slug, menuId);
      try {
        await updateWithVersion(tx.menu, { id: menuId, version, data: { slug }, entityType: 'Menu' }, tx);
      } catch (error) {
        if (isUniqueViolation(error)) throw slugRefusal('taken');
        throw error;
      }
      // The old address keeps its row, so it redirects to this one for good.
      await claimSlug(tx, slug, menuId);

      ctx.audit({ action: 'menu.slug_changed', entityType: 'Menu', entityId: menuId, changes: { slug: { before: row.slug, after: slug } } });
      const slugs = await menuSlugs(tx, menuId);
      ctx.afterCommit(() => expireMenu(slugs, menuId));
      return { slug, version: version + 1 };
    }),
});

// Duplicating ---------------------------------------------------------------------------------------------------------

export const duplicateMenu = defineAction({
  name: 'menus.duplicate',
  permission: 'menu.duplicate',
  input: z.object({ menuId: idField, name: menuName, slug: slugField, targetRestaurantId: idField.optional() }),
  target: (i) => atMenu(i.menuId),
  run: async (ctx, input) => {
    const sourceId = menuOf(ctx);
    const restaurantId = input.targetRestaurantId ?? restaurantOf(ctx);
    // Another restaurant is a Super Admin's to copy into (`transactionIn` holds to it too); say so before reading.
    if (restaurantId !== ctx.restaurantId && !ctx.actor.isSuperAdmin) throw new StudioError('FORBIDDEN');

    // What is copied, read from the source: its settings, brand kit and tables, and its draft as it would be published
    // (so inactive categories with their products, inactive rules and bundles stay behind, and nothing is sold out).
    const source = await ctx.transaction(async (tx) => {
      const menu = await tx.menu.findUnique({ where: { id: sourceId } });
      if (!menu) throw new StudioError('NOT_FOUND');
      const brand = await tx.brandConfig.findUnique({ where: { menuId: sourceId } });
      const tables = await tx.table.findMany({ orderBy: { number: 'asc' }, select: { number: true, label: true } });
      const snapshot = await loadDraftSnapshot(tx, sourceId);
      // Into another restaurant, the library assets the menu shows go with it as that restaurant's own copies; they are
      // read here, on the source's side, which the target's transaction cannot read.
      const assetIds = restaurantId === ctx.restaurantId ? [] : snapshotAssetIds(snapshot);
      const assets = assetIds.length === 0 ? [] : await tx.mediaAsset.findMany({ where: { id: { in: assetIds } }, select: COPYABLE });
      return { menu, brand, tables, snapshot, assets };
    });

    // What the restaurant the copy lands in has bought: the target's own plan, or (a Super Admin copying elsewhere) that
    // restaurant's.
    if (ctx.plan === null) throw new Error('menus.duplicate ran without a plan');
    const destination =
      restaurantId === ctx.restaurantId
        ? ctx.plan.entitlements
        : await entitlementsFor(ctx.db, restaurantId).catch(() => {
            throw new StudioError('NOT_FOUND');
          });
    const menuId = ctx.newId();
    await ctx.transactionIn({ restaurantId, menuId }, async (tx) => {
      await requireSlugAvailable(tx, input.slug, null);
      const { menu, brand } = source;
      try {
        await tx.menu.create({
          data: {
            id: menuId,
            restaurantId,
            name: input.name,
            slug: input.slug,
            currency: menu.currency,
            defaultLocale: menu.defaultLocale,
            locales: menu.locales,
            timezone: menu.timezone,
            numeralSystem: menu.numeralSystem,
            engineConfig: json(menu.engineConfig),
            seo: json(menu.seo),
          },
        });
      } catch (error) {
        if (isUniqueViolation(error)) throw slugRefusal('taken');
        throw error;
      }
      await claimSlug(tx, input.slug, menuId);
      if (brand) {
        await tx.brandConfig.create({
          data: {
            menuId,
            tokens: json(brand.tokens),
            typography: json(brand.typography),
            theme: brand.theme,
            motionIntensity: brand.motionIntensity,
            navStyle: brand.navStyle,
            railStyle: brand.railStyle,
            logoText: brand.logoText,
          },
        });
      }
      // New ids for every row and every reference; the draft hash is computed at the end.
      const assetMap = source.assets.length === 0 ? undefined : await copyAssetsForMenu(tx, { assets: source.assets, toRestaurantId: restaurantId });
      await writeDraftFromSnapshot(tx, menuId, source.snapshot, assetMap);
      if (source.tables.length > 0) await tx.table.createMany({ data: source.tables.map((table) => ({ menuId, ...table })) });
      // A copy is a new menu: its kit starts within the plan of the restaurant it lands in, as a new menu's does, and
      // it takes the motions only where that plan includes them. A background file that plan lacks stays behind in the
      // design (the file itself is copied like any other): guests of the copy get the template's own scene.
      const copied = await tx.brandConfig.findFirst({ where: { menuId } });
      if (copied) {
        const within = clampBrandChoices(storedChoices(copied), destination);
        const media = source.snapshot.brand.design?.media;
        const design = parseOverrides(copied.design);
        const dropScene = media !== undefined && design.sceneAsset !== undefined && !allows(destination, sceneFeature(media.kind));
        if (dropScene) delete design.sceneAsset;
        await tx.brandConfig.update({ where: { id: copied.id }, data: { ...within, ...(dropScene ? { design: json(design) } : {}) } });
      }
      await refreshDraftHash(tx, menuId);

      ctx.audit({
        action: 'menu.duplicated',
        entityType: 'Menu',
        entityId: menuId,
        changes: {
          duplicatedFrom: { before: null, after: sourceId },
          name: { before: null, after: input.name },
          slug: { before: null, after: input.slug },
        },
      });
      ctx.afterCommit(() => expireMenu([input.slug], menuId));
    });
    return { menuId };
  },
});

// Deleting ------------------------------------------------------------------------------------------------------------

/**
 * Erases a menu in any status, with nothing left behind: its catalog, revisions, brand kit, tables and events (the
 * cascade), its addresses (no tombstone, so they can be used again) and the activity filed under it. Not the one a
 * restaurant's cashier sells from, which would stop the till. The deletion itself is not written down.
 */
export const deleteMenu = defineAction({
  name: 'menus.delete',
  permission: 'menu.delete',
  input: z.object({ menuId: idField, confirmName: z.string().max(200) }),
  target: (i) => atMenu(i.menuId),
  run: async (ctx, { confirmName }) => {
    const menuId = menuOf(ctx);
    const row = await ctx.db.menu.findUnique({ where: { id: menuId }, select: { name: true } });
    if (!row) throw new StudioError('NOT_FOUND');
    if (confirmName.trim() !== row.name) {
      const message = 'Type the menu name exactly to confirm';
      throw new StudioError('INVALID', message, { confirmName: message });
    }
    if (await ctx.db.posSettings.findFirst({ where: { catalogMenuId: menuId }, select: { id: true } })) {
      throw new StudioError('INVALID', 'This menu is the product list of the restaurant’s cashier. Choose another one first.');
    }
    return ctx.transaction(async (tx) => {
      const slugs = await menuSlugs(tx, menuId);
      await tx.menuSlug.deleteMany({ where: { menuId } });
      await tx.auditLog.deleteMany({ where: { menuId } });
      const { count } = await tx.menu.deleteMany({ where: { id: menuId } });
      if (count === 0) throw new StudioError('CONFLICT');
      ctx.afterCommit(() => expireMenu(slugs, menuId));
      return { deleted: true as const };
    });
  },
});

/** Erases up to 200 menus, each one as `menus.delete` run for the same person; the word DELETE stands for each menu's name. */
export const bulkDeleteMenus = defineAction({
  name: 'menus.bulkDelete',
  permission: null,
  input: z.object({
    menuIds: z
      .array(idField)
      .min(1, 'Choose at least one menu')
      .max(200, 'Choose at most 200 menus')
      .refine((ids) => new Set(ids).size === ids.length, 'Each menu can be listed only once'),
    confirm: z.literal('DELETE', 'Type DELETE to confirm'),
  }),
  target: () => ({ kind: 'self' }),
  run: async (ctx, { menuIds }) => {
    const results: BulkResult[] = [];
    for (const menuId of menuIds) {
      // The name is only handed to the delete, which checks the person's right to the menu first.
      const row = await ctx.db.menu.findUnique({ where: { id: menuId }, select: { name: true } });
      const result = await runAction(ctx.db, ctx.actor, deleteMenu, { menuId, confirmName: row?.name ?? '' }, ctx.meta);
      results.push(result.ok ? { menuId, ok: true } : { menuId, ok: false, code: result.error.code });
    }
    return { results };
  },
});

// Many at once --------------------------------------------------------------------------------------------------------

/**
 * Publishes, suspends, archives or restores up to 200 menus. Each one is the single action run for the same person
 * (`runAction`), so its checks, its transaction and its audit row are exactly those of doing it alone; one that fails
 * (blocked, not allowed in its status, outside the person's restaurants) is reported and the others go on.
 */
export const bulkMenuAction = defineAction({
  name: 'menus.bulk',
  permission: null,
  input: z.object({
    menuIds: z
      .array(idField)
      .min(1, 'Choose at least one menu')
      .max(200, 'Choose at most 200 menus')
      .refine((ids) => new Set(ids).size === ids.length, 'Each menu can be listed only once'),
    action: z.enum(BULK_ACTIONS, 'Choose one of the changes offered'),
  }),
  target: () => ({ kind: 'self' }),
  run: async (ctx, { menuIds, action }) => {
    const results: BulkResult[] = [];
    // One at a time: each is its own transaction, and a long list should not take every connection.
    for (const menuId of menuIds) {
      const result =
        action === 'publish'
          ? await runAction(ctx.db, ctx.actor, publish, { menuId }, ctx.meta)
          : await runAction(ctx.db, ctx.actor, changeMenuStatus, { menuId, action }, ctx.meta);
      results.push(
        result.ok
          ? { menuId, ok: true }
          : { menuId, ok: false, code: result.error.code, ...(result.error.issues ? { issues: result.error.issues } : {}) },
      );
    }
    return { results };
  },
});

// Settings ------------------------------------------------------------------------------------------------------------

export const updateSettings = defineAction({
  name: 'menus.updateSettings',
  permission: 'menu.settings',
  input: z.object({ menuId: idField, ...settingsFields }),
  target: (i) => atMenu(i.menuId),
  run: (ctx, input) => saveSettings(ctx, input),
});
