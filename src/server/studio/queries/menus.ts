import { z } from 'zod';
import type { Prisma } from '@/generated/prisma/client';
import { hostEnv } from '@/server/env';
import { validateForPublish } from '@/server/domain/publish-rules';
import { formatClientId, parseClientId } from '@/server/domain/restaurant-profile';
import { loadDraftSnapshot } from '@/server/publish/draft';
import { defineQuery, type QueryContext } from '@/server/studio/framework/query';
import { StudioError } from '@/server/studio/framework/result';
import { createdBetween, dateField, literal } from '@/server/studio/services/list-filters';
import { getPlatformSettings } from '@/server/studio/services/settings';
import {
  checkSlugAvailable,
  MENU_SORTS,
  menuSlugs,
  menuStatus,
  OFFERED_CURRENCIES,
  OFFERED_TIME_ZONES,
  permissionsIn,
  slugField,
} from '@/server/studio/services/menus';

/**
 * What the menu screens read. All Menus is a platform read limited to the restaurants the person belongs to (every one
 * for a Super Admin), in its rows, counts and filter choices alike; a menu's own page is read through a menu target,
 * which the framework has already checked the reader belongs to.
 */

const PAGE_SIZE = 50;

const idField = z.string().min(1).max(100);
const pageField = z.number().int().min(1).max(100_000).default(1);

const PLATFORM = { kind: 'platform' } as const;
const atMenu = (menuId: string) => ({ kind: 'menu', menuId }) as const;

/** The menu a menu-target query reads. The framework has already resolved it. */
function menuOf(ctx: QueryContext): string {
  if (ctx.menuId === null) throw new Error('A menu query ran without a menu');
  return ctx.menuId;
}

/** The address guests open the menu at. */
const publicUrl = (slug: string) => `${hostEnv().publicOrigin}/${slug}`;

function orderBy(sort: (typeof MENU_SORTS)[number], dir: 'asc' | 'desc'): Prisma.MenuOrderByWithRelationInput[] {
  // The id breaks ties, so a page boundary never repeats or skips a row.
  switch (sort) {
    case 'restaurant':
      return [{ restaurant: { name: dir } }, { name: 'asc' }, { id: 'asc' }];
    case 'status':
      return [{ status: dir }, { name: 'asc' }, { id: 'asc' }];
    default:
      return [{ [sort]: dir }, { id: 'asc' }];
  }
}

export const listMenus = defineQuery({
  name: 'menus.list',
  permission: 'view',
  input: z.object({
    q: z.string().trim().max(100).optional(),
    status: menuStatus.optional(),
    city: z.string().trim().max(200).optional(),
    restaurantId: idField.optional(),
    createdFrom: dateField.optional(),
    createdTo: dateField.optional(),
    unpublished: z.boolean().optional(),
    sort: z.enum(MENU_SORTS).default('name'),
    dir: z.enum(['asc', 'desc']).default('asc'),
    page: pageField,
    pageSize: z.literal(PAGE_SIZE).default(PAGE_SIZE),
  }),
  target: () => PLATFORM,
  run: async (ctx, input) => {
    const scope: Prisma.MenuWhereInput = ctx.scope.kind === 'all' ? {} : { restaurantId: { in: ctx.scope.ids } };
    const restaurantScope: Prisma.RestaurantWhereInput = ctx.scope.kind === 'all' ? {} : { id: { in: ctx.scope.ids } };

    const filters: Prisma.MenuWhereInput[] = [scope];
    const search = input.q ?? '';
    if (search !== '') {
      const clientNumber = parseClientId(search);
      const text = { contains: literal(search), mode: 'insensitive' as const };
      filters.push({
        OR: [
          { name: text },
          { slug: text },
          { restaurant: { name: text } },
          ...(clientNumber !== null ? [{ restaurant: { clientNumber } }] : []),
        ],
      });
    }
    // Archived menus are out of the way unless they are asked for.
    filters.push(input.status ? { status: input.status } : { status: { not: 'ARCHIVED' } });
    if (input.city) filters.push({ restaurant: { city: { equals: input.city, mode: 'insensitive' } } });
    if (input.restaurantId) filters.push({ restaurantId: input.restaurantId });
    const created = createdBetween(input.createdFrom, input.createdTo);
    if (created) filters.push({ createdAt: created });
    // Changes since the live revision: the draft's hash differs from the live one (a menu never published has none).
    if (input.unpublished) filters.push({ liveHash: { not: null }, draftHash: { not: { equals: ctx.db.menu.fields.liveHash } } });
    const where: Prisma.MenuWhereInput = { AND: filters };

    const [total, found, cities, restaurants] = await Promise.all([
      ctx.db.menu.count({ where }),
      ctx.db.menu.findMany({
        where,
        orderBy: orderBy(input.sort, input.dir),
        skip: (input.page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
        select: {
          id: true,
          name: true,
          slug: true,
          status: true,
          draftHash: true,
          liveHash: true,
          updatedAt: true,
          liveRevision: { select: { number: true } },
          restaurant: { select: { id: true, name: true, clientNumber: true, city: true, status: true, permissionPolicy: true } },
        },
      }),
      ctx.db.restaurant.findMany({ where: { AND: [restaurantScope, { city: { not: '' } }] }, distinct: ['city'], orderBy: { city: 'asc' }, select: { city: true } }),
      ctx.db.restaurant.findMany({ where: restaurantScope, orderBy: [{ name: 'asc' }, { id: 'asc' }], select: { id: true, name: true, permissionPolicy: true } }),
    ]);

    return {
      rows: found.map((row) => {
        const can = permissionsIn(ctx.actor, row.restaurant);
        return {
          id: row.id,
          name: row.name,
          slug: row.slug,
          status: row.status,
          restaurant: {
            id: row.restaurant.id,
            name: row.restaurant.name,
            clientId: formatClientId(row.restaurant.clientNumber),
            city: row.restaurant.city,
            status: row.restaurant.status,
          },
          liveRevisionNumber: row.liveRevision?.number ?? null,
          unpublished: row.liveHash !== null && row.draftHash !== row.liveHash,
          updatedAt: row.updatedAt.toISOString(),
          publicUrl: publicUrl(row.slug),
          /** What the reader may do to the menu, for the row's actions; the actions check it again. */
          can: { publish: can.has('publish.now'), status: can.has('menu.status'), duplicate: can.has('menu.duplicate') },
        };
      }),
      total,
      page: input.page,
      pageSize: PAGE_SIZE,
      cities: cities.map((row) => row.city),
      restaurants: restaurants.map((row) => ({ id: row.id, name: row.name })),
      canCreate: restaurants.some((row) => permissionsIn(ctx.actor, row).has('menu.create')),
    };
  },
});

export const getMenu = defineQuery({
  name: 'menus.get',
  permission: 'view',
  input: z.object({ menuId: idField }),
  target: (i) => atMenu(i.menuId),
  run: async (ctx) => {
    const menuId = menuOf(ctx);
    const menu = await ctx.db.menu.findUnique({
      where: { id: menuId },
      include: {
        restaurant: { select: { id: true, name: true, clientNumber: true, status: true } },
        liveRevision: { select: { number: true, wentLiveAt: true, createdAt: true, createdById: true } },
        _count: { select: { categories: true, products: true, tables: true } },
      },
    });
    if (!menu) throw new StudioError('NOT_FOUND');

    const live = menu.liveRevision;
    const [publisher, slugs, snapshot, restaurants] = await Promise.all([
      live?.createdById ? ctx.db.user.findUnique({ where: { id: live.createdById }, select: { name: true } }) : null,
      menuSlugs(ctx.db, menuId),
      loadDraftSnapshot(ctx.db, menuId),
      // Where a Super Admin may duplicate it to; anyone else duplicates within the restaurant.
      ctx.actor.isSuperAdmin
        ? ctx.db.restaurant.findMany({ orderBy: [{ name: 'asc' }, { id: 'asc' }], select: { id: true, name: true, clientNumber: true } })
        : [],
    ]);
    const can = (key: Parameters<typeof ctx.permissions.has>[0]) => ctx.permissions.has(key);

    return {
      id: menu.id,
      name: menu.name,
      slug: menu.slug,
      status: menu.status,
      statusBeforeArchive: menu.statusBeforeArchive,
      version: menu.version,
      locales: menu.locales,
      defaultLocale: menu.defaultLocale,
      currency: menu.currency,
      timezone: menu.timezone,
      numeralSystem: menu.numeralSystem,
      createdAt: menu.createdAt.toISOString(),
      updatedAt: menu.updatedAt.toISOString(),
      restaurant: {
        id: menu.restaurant.id,
        name: menu.restaurant.name,
        clientId: formatClientId(menu.restaurant.clientNumber),
        clientNumber: menu.restaurant.clientNumber,
        status: menu.restaurant.status,
      },
      counts: menu._count,
      liveRevision: live
        ? { number: live.number, wentLiveAt: (live.wentLiveAt ?? live.createdAt).toISOString(), publishedBy: publisher?.name ?? null }
        : null,
      unpublished: menu.liveHash !== null && menu.draftHash !== menu.liveHash,
      publicUrl: publicUrl(menu.slug),
      formerSlugs: slugs.filter((slug) => slug !== menu.slug),
      /** What publishing now would say: the blocking problems and the warnings, in the order of the menu. */
      issues: validateForPublish(snapshot),
      duplicateTargets: restaurants.map((row) => ({ id: row.id, name: row.name, clientId: formatClientId(row.clientNumber) })),
      /** What the reader may do here, for showing or hiding the controls; the actions check it again. */
      can: {
        publish: can('publish.now'),
        status: can('menu.status'),
        settings: can('menu.settings'),
        duplicate: can('menu.duplicate'),
        duplicateElsewhere: can('menu.duplicate') && ctx.actor.isSuperAdmin,
        delete: can('menu.delete'),
      },
    };
  },
});

/** Whether an address can be had, for the forms that ask as the person types. With `menuId`, for that menu. */
export const slugAvailability = defineQuery({
  name: 'menus.slugAvailability',
  permission: 'view',
  input: z.object({ slug: slugField, menuId: idField.optional() }),
  target: (i) => (i.menuId ? atMenu(i.menuId) : PLATFORM),
  run: async (ctx, { slug }) => ({ slug, status: await checkSlugAvailable(ctx.db, slug, ctx.menuId) }),
});

/**
 * What the New menu form offers: the restaurants the person may create menus in (with the number a slug falls back on),
 * the settings a new menu starts with, and the currencies and time zones to choose from. Nobody else gets the form.
 */
export const newMenuOptions = defineQuery({
  name: 'menus.newOptions',
  permission: 'view',
  input: z.object({}),
  target: () => PLATFORM,
  run: async (ctx) => {
    const restaurantScope: Prisma.RestaurantWhereInput = ctx.scope.kind === 'all' ? {} : { id: { in: ctx.scope.ids } };
    const found = await ctx.db.restaurant.findMany({
      where: restaurantScope,
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      select: { id: true, name: true, clientNumber: true, permissionPolicy: true },
    });
    const restaurants = found.filter((row) => permissionsIn(ctx.actor, row).has('menu.create'));
    if (!ctx.actor.isSuperAdmin && restaurants.length === 0) throw new StudioError('FORBIDDEN');
    const { defaults } = await getPlatformSettings(ctx.db);
    return {
      restaurants: restaurants.map((row) => ({ id: row.id, name: row.name, clientId: formatClientId(row.clientNumber), clientNumber: row.clientNumber })),
      // What a new menu starts with: the platform's defaults (Settings).
      defaults: { ...defaults, numeralSystem: 'LATN' },
      currencies: OFFERED_CURRENCIES,
      timeZones: OFFERED_TIME_ZONES,
    };
  },
});
