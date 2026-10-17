import { z } from 'zod';
import type { Prisma } from '@/generated/prisma/client';
import type { Permission } from '@/server/domain/permissions';
import { formatClientId, parseClientId, readWorkingHours, RESTAURANT_STATUSES, RESTAURANT_TYPES } from '@/server/domain/restaurant-profile';
import { defineQuery, type QueryContext } from '@/server/studio/framework/query';
import { StudioError } from '@/server/studio/framework/result';
import { restaurantActivityRows } from '@/server/studio/services/activity';
import { profileOf, seesAgencyNotes } from '@/server/studio/services/restaurants';
import { createdBetween, dateField, literal } from '@/server/studio/services/list-filters';

/**
 * What the Restaurants screens read. The list is a platform read: every restaurant for a Super Admin, and for anyone
 * else only the ones they belong to, in the rows, the counts and the filter choices alike. Everything else is read
 * through a restaurant target, which the framework has already checked the reader belongs to.
 */

const PAGE_SIZE = 50;
const ACTIVITY_PAGE_SIZE = 25;

const idField = z.string().min(1).max(100);
const pageField = z.number().int().min(1).max(100_000).default(1);

const PLATFORM = { kind: 'platform' } as const;
const atRestaurant = (restaurantId: string) => ({ kind: 'restaurant', restaurantId }) as const;

/** The restaurant a restaurant-target query reads. The framework has already resolved it. */
function restaurantOf(ctx: QueryContext): string {
  if (ctx.restaurantId === null) throw new Error('A restaurant query ran without a restaurant');
  return ctx.restaurantId;
}

export const listRestaurants = defineQuery({
  name: 'restaurants.list',
  permission: 'view',
  input: z.object({
    q: z.string().trim().max(100).optional(),
    city: z.string().trim().max(200).optional(),
    type: z.enum(RESTAURANT_TYPES).optional(),
    status: z.enum(RESTAURANT_STATUSES).optional(),
    createdFrom: dateField.optional(),
    createdTo: dateField.optional(),
    sort: z.enum(['name', 'createdAt', 'city']).default('name'),
    dir: z.enum(['asc', 'desc']).default('asc'),
    page: pageField,
    pageSize: z.literal(PAGE_SIZE).default(PAGE_SIZE),
  }),
  target: () => PLATFORM,
  run: async (ctx, input) => {
    const scope: Prisma.RestaurantWhereInput = ctx.scope.kind === 'all' ? {} : { id: { in: ctx.scope.ids } };

    const search = input.q ?? '';
    const clientNumber = parseClientId(search);
    const filters: Prisma.RestaurantWhereInput[] = [scope];
    if (search !== '') {
      filters.push({
        OR: [
          { name: { contains: literal(search), mode: 'insensitive' } },
          { city: { contains: literal(search), mode: 'insensitive' } },
          ...(clientNumber !== null ? [{ clientNumber }] : []),
        ],
      });
    }
    if (input.city) filters.push({ city: { equals: input.city, mode: 'insensitive' } });
    if (input.type) filters.push({ type: input.type });
    if (input.status) filters.push({ status: input.status });
    const created = createdBetween(input.createdFrom, input.createdTo);
    if (created) filters.push({ createdAt: created });
    const where: Prisma.RestaurantWhereInput = { AND: filters };

    const [total, found, cities] = await Promise.all([
      ctx.db.restaurant.count({ where }),
      ctx.db.restaurant.findMany({
        where,
        // The id breaks ties, so a page boundary never repeats or skips a row.
        orderBy: [{ [input.sort]: input.dir }, { id: 'asc' }],
        skip: (input.page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
        select: {
          id: true,
          clientNumber: true,
          name: true,
          type: true,
          city: true,
          status: true,
          createdAt: true,
          _count: { select: { menus: true } },
        },
      }),
      // The cities the city filter offers: those of the restaurants the reader can see, and no others.
      ctx.db.restaurant.findMany({ where: { AND: [scope, { city: { not: '' } }] }, distinct: ['city'], orderBy: { city: 'asc' }, select: { city: true } }),
    ]);

    return {
      rows: found.map((row) => ({
        id: row.id,
        clientId: formatClientId(row.clientNumber),
        name: row.name,
        type: row.type,
        city: row.city,
        status: row.status,
        menuCount: row._count.menus,
        createdAt: row.createdAt.toISOString(),
      })),
      total,
      page: input.page,
      pageSize: PAGE_SIZE,
      cities: cities.map((row) => row.city),
      canCreate: ctx.permissions.has('restaurant.create'),
    };
  },
});

/** Whether the reader may open the form for a new restaurant. Super Admins only. */
export const newRestaurantAccess = defineQuery({
  name: 'restaurants.newAccess',
  permission: 'restaurant.create',
  input: z.object({}),
  target: () => PLATFORM,
  run: async () => ({ allowed: true as const }),
});

export const getRestaurant = defineQuery({
  name: 'restaurants.get',
  permission: 'view',
  input: z.object({ restaurantId: idField }),
  target: (i) => atRestaurant(i.restaurantId),
  run: async (ctx) => {
    const restaurantId = restaurantOf(ctx);
    const row = await ctx.db.restaurant.findUnique({
      where: { id: restaurantId },
      include: { _count: { select: { menus: true, branches: true } } },
    });
    if (!row) throw new StudioError('NOT_FOUND');
    const profile = profileOf(row);
    const can = (key: Permission) => ctx.permissions.has(key);
    return {
      id: row.id,
      clientId: formatClientId(row.clientNumber),
      ...profile,
      // The agency's notes are not the client's to read.
      notes: seesAgencyNotes(ctx.actor, restaurantId) ? profile.notes : null,
      status: row.status,
      version: row.version,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      menuCount: row._count.menus,
      branchCount: row._count.branches,
      /** What the reader may do here, for showing or hiding the controls; the actions check it again. */
      can: {
        edit: can('restaurant.edit'),
        status: can('restaurant.status'),
        delete: can('restaurant.delete'),
        invite: can('people.invite'),
        manage: can('people.manage'),
        permissions: can('permissions.manage'),
        audit: can('audit.view'),
      },
    };
  },
});

export const restaurantBranches = defineQuery({
  name: 'restaurants.branches',
  permission: 'view',
  input: z.object({ restaurantId: idField }),
  target: (i) => atRestaurant(i.restaurantId),
  run: async (ctx) => {
    const branches = await ctx.db.branch.findMany({
      where: { restaurantId: restaurantOf(ctx) },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    });
    return branches.map((branch) => ({
      id: branch.id,
      name: branch.name,
      address: branch.address,
      city: branch.city,
      phone: branch.phone,
      workingHours: readWorkingHours(branch.workingHours),
      version: branch.version,
    }));
  },
});

export const restaurantMenus = defineQuery({
  name: 'restaurants.menus',
  permission: 'view',
  input: z.object({ restaurantId: idField }),
  target: (i) => atRestaurant(i.restaurantId),
  run: async (ctx) => {
    const menus = await ctx.db.menu.findMany({
      where: { restaurantId: restaurantOf(ctx) },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      select: { id: true, name: true, slug: true, status: true, defaultLocale: true, updatedAt: true },
    });
    return menus.map((menu) => ({
      id: menu.id,
      name: menu.name,
      slug: menu.slug,
      status: menu.status,
      defaultLocale: menu.defaultLocale,
      updatedAt: menu.updatedAt.toISOString(),
    }));
  },
});

/**
 * The restaurant's own Activity: the rows the platform's Activity shows, filed under this restaurant, with the names of
 * the fields each change touched. Like Activity, it never returns what a change held.
 */
export const restaurantActivity = defineQuery({
  name: 'restaurants.activity',
  permission: 'audit.view',
  input: z.object({ restaurantId: idField, page: pageField }),
  target: (i) => atRestaurant(i.restaurantId),
  run: async (ctx, { page }) => {
    const { total, rows } = await restaurantActivityRows(ctx.db, { restaurantId: restaurantOf(ctx), page, pageSize: ACTIVITY_PAGE_SIZE });
    return { rows, total, page, pageSize: ACTIVITY_PAGE_SIZE };
  },
});
