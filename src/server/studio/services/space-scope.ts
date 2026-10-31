import { z } from 'zod';
import type { Prisma, PrismaClient } from '@/generated/prisma/client';
import type { BusinessSector } from '@/server/domain/restaurant-profile';
import type { ScopedTx } from '@/server/data/tenant-db';
import type { ActionContext } from '@/server/studio/framework/action';
import type { ActorScope } from '@/server/studio/framework/query';
import { StudioError } from '@/server/studio/framework/result';

/**
 * The closed spaces of a Super Admin, seen from the data: Menu and Cashier works on FOOD businesses, the Pharmacy on
 * PHARMACY ones (docs/superpowers/specs/2026-10-31-super-admin-project-hub-design.md). A query or action that serves a
 * space takes `space` and cuts its rows by the sector, so a business of the other project is never read or written
 * through it. Only a Super Admin (scope `all`) is cut by space; everyone else sees what they always saw.
 */

/** The `space` input of a query: Menu and Cashier unless the page says Pharmacy. */
export const businessSpace = z.enum(['food', 'pharmacy']).default('food');
export type BusinessSpace = z.infer<typeof businessSpace>;

const SECTORS: Record<BusinessSpace, BusinessSector> = { food: 'FOOD', pharmacy: 'PHARMACY' };

/** The products (billing applications) each space sells and bills. */
export const APPLICATIONS_OF: Record<BusinessSpace, readonly string[]> = { food: ['menu', 'cashier'], pharmacy: ['pharmacy'] };

export const sectorOf = (space: BusinessSpace): BusinessSector => SECTORS[space];

/** The businesses of a space. */
export const sectorWhere = (space: BusinessSpace): { sector: BusinessSector } => ({ sector: SECTORS[space] });

/** The businesses a reader sees through a space: a Super Admin's are cut to its sector, anyone else's are not cut. */
export const restaurantsInSpace = (scope: ActorScope, space: BusinessSpace): Prisma.RestaurantWhereInput => (scope.kind === 'all' ? sectorWhere(space) : {});

/** The menus a reader sees through a space. */
export const menusInSpace = (scope: ActorScope, space: BusinessSpace): Prisma.MenuWhereInput =>
  scope.kind === 'all' ? { restaurant: sectorWhere(space) } : {};

/**
 * The ids of a space's businesses, for the tables that keep a plain restaurant id without a relation (the audit log).
 * A business that has since been deleted is in no sector, so its audit rows are Menu and Cashier's (see auditSpaceWhere).
 */
export async function sectorRestaurantIds(db: PrismaClient, space: BusinessSpace): Promise<string[]> {
  const rows = await db.restaurant.findMany({ where: sectorWhere(space), select: { id: true } });
  return rows.map((row) => row.id);
}

/**
 * The audit rows of a space. The log keeps plain restaurant ids, so the Pharmacy has the rows of its businesses and Menu
 * and Cashier has all the rest: its own businesses, the platform's own events (a setting, an announcement) that name no
 * business, and a business since deleted. Every row is in exactly one space, so nothing in the log is hidden.
 */
export async function auditSpaceWhere(db: PrismaClient, space: BusinessSpace): Promise<Prisma.AuditLogWhereInput> {
  const pharmacyIds = await sectorRestaurantIds(db, 'pharmacy');
  // Platform events that belong to the Pharmacy: its plans, and the announcements written in its space.
  const notes = (await db.announcement.findMany({ where: { space: 'pharmacy' }, select: { id: true } })).map((row) => row.id);
  const pharmacyOwn: Prisma.AuditLogWhereInput = {
    OR: [{ restaurantId: { in: pharmacyIds } }, { entityType: 'AppPlan' }, { entityType: 'Announcement', entityId: { in: notes } }],
  };
  if (space === 'pharmacy') return pharmacyOwn;
  // Everything else. Each exclusion is spelled out because `NOT (x IN ...)` is unknown, not true, for the null restaurant of a platform event.
  return {
    AND: [
      { OR: [{ restaurantId: null }, { restaurantId: { notIn: pharmacyIds } }] },
      { entityType: { not: 'AppPlan' } },
      { OR: [{ entityType: { not: 'Announcement' } }, { entityId: { notIn: notes } }] },
    ],
  };
}

/** Refuses a business of the other sector as if it did not exist, so a write through one space never touches the other. */
export async function assertSameSector(db: PrismaClient | ScopedTx, restaurantId: string, space: BusinessSpace): Promise<void> {
  // A scoped transaction exposes the same `restaurant.findUnique`; the union of two generic signatures is not callable as is.
  const found = await (db as PrismaClient).restaurant.findUnique({ where: { id: restaurantId }, select: { sector: true } });
  if (found?.sector !== SECTORS[space]) throw new StudioError('NOT_FOUND');
}

/** The `space` an action may carry: the page's space, optional so owners and designers are never cut by it. */
export const optionalSpace = z.enum(['food', 'pharmacy']).optional();

/**
 * The first step of an action that works on one business from inside a space: when the page named its space, a business of
 * the other sector is refused as not found and nothing is written. Without `space` it does nothing.
 */
export async function requireSpace(ctx: Pick<ActionContext, 'transaction' | 'restaurantId'>, space: BusinessSpace | undefined): Promise<void> {
  const restaurantId = ctx.restaurantId;
  if (!space || restaurantId === null) return;
  await ctx.transaction((tx) => assertSameSector(tx, restaurantId, space));
}
