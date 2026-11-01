import { z } from 'zod';
import type { Prisma, PrismaClient } from '@/generated/prisma/client';
import type { BusinessSector } from '@/server/domain/restaurant-profile';
import type { ScopedTx } from '@/server/data/tenant-db';
import type { ActionContext } from '@/server/studio/framework/action';
import type { ActorScope } from '@/server/studio/framework/query';
import { StudioError } from '@/server/studio/framework/result';

/**
 * The closed spaces of a Super Admin, seen from the data: Menu and Cashier works on FOOD businesses, the Pharmacy on
 * PHARMACY ones and Retail on RETAIL ones (docs/superpowers/specs/2026-10-31-super-admin-project-hub-design.md). A query or action that serves a
 * space takes `space` and cuts its rows by the sector, so a business of the other project is never read or written
 * through it. Only a Super Admin (scope `all`) is cut by space; everyone else sees what they always saw.
 */

const BUSINESS_SPACES = ['food', 'pharmacy', 'retail'] as const;

/** The `space` input of a query: Menu and Cashier unless the page names another space. */
export const businessSpace = z.enum(BUSINESS_SPACES).default('food');
export type BusinessSpace = z.infer<typeof businessSpace>;

const SECTORS: Record<BusinessSpace, BusinessSector> = { food: 'FOOD', pharmacy: 'PHARMACY', retail: 'RETAIL' };

/** The products (billing applications) each space sells and bills. */
export const APPLICATIONS_OF: Record<BusinessSpace, readonly string[]> = { food: ['menu', 'cashier'], pharmacy: ['pharmacy'], retail: ['retail'] };

export const sectorOf = (space: BusinessSpace): BusinessSector => SECTORS[space];

/** The space a business of a sector belongs to. */
export const spaceOfSector = (sector: BusinessSector): BusinessSpace =>
  (Object.keys(SECTORS) as BusinessSpace[]).find((space) => SECTORS[space] === sector) ?? 'food';

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
 * The audit rows of a space. The log keeps plain restaurant ids, so the Pharmacy and Retail have the rows of their
 * businesses and Menu and Cashier has all the rest: its own businesses, the platform's own events (a setting, an
 * announcement) that name no business, and a business since deleted. A plan (`AppPlan`) row is Retail's when it names
 * a Retail plan and the Pharmacy's otherwise; an announcement row is the space's it was written in. Every row is in
 * exactly one space, so nothing in the log is hidden.
 */
export async function auditSpaceWhere(db: PrismaClient, space: BusinessSpace): Promise<Prisma.AuditLogWhereInput> {
  const [pharmacyIds, retailIds, retailPlans, notes] = await Promise.all([
    sectorRestaurantIds(db, 'pharmacy'),
    sectorRestaurantIds(db, 'retail'),
    // Plans are only taken off sale, never deleted, so a plan row's id still names its product.
    db.appPlan.findMany({ where: { applicationId: 'retail' }, select: { id: true } }),
    db.announcement.findMany({ where: { space: { in: ['pharmacy', 'retail'] } }, select: { id: true, space: true } }),
  ]);
  const retailPlanIds = retailPlans.map((row) => row.id);
  const notesOf = (of: BusinessSpace) => notes.filter((row) => row.space === of).map((row) => row.id);
  // Each exclusion is spelled out because `NOT (x IN ...)` is unknown, not true, for the null restaurant of a platform event.
  const notIn = (ids: string[]): Prisma.AuditLogWhereInput => ({ OR: [{ restaurantId: null }, { restaurantId: { notIn: ids } }] });
  const notNote = (ids: string[]): Prisma.AuditLogWhereInput => ({ OR: [{ entityType: { not: 'Announcement' } }, { entityId: { notIn: ids } }] });

  if (space === 'retail') {
    return {
      OR: [
        { restaurantId: { in: retailIds } },
        { entityType: 'AppPlan', entityId: { in: retailPlanIds } },
        { entityType: 'Announcement', entityId: { in: notesOf('retail') } },
      ],
    };
  }
  if (space === 'pharmacy') {
    // Its businesses, every plan that is not Retail's, and its announcements; never a retail shop's row.
    return {
      AND: [
        {
          OR: [
            { restaurantId: { in: pharmacyIds } },
            { entityType: 'AppPlan', entityId: { notIn: retailPlanIds } },
            { entityType: 'Announcement', entityId: { in: notesOf('pharmacy') } },
          ],
        },
        notIn(retailIds),
      ],
    };
  }
  // Everything else.
  return {
    AND: [notIn([...pharmacyIds, ...retailIds]), { entityType: { not: 'AppPlan' } }, notNote([...notesOf('pharmacy'), ...notesOf('retail')])],
  };
}

/** Refuses a business of the other sector as if it did not exist, so a write through one space never touches the other. */
export async function assertSameSector(db: PrismaClient | ScopedTx, restaurantId: string, space: BusinessSpace): Promise<void> {
  // A scoped transaction exposes the same `restaurant.findUnique`; the union of two generic signatures is not callable as is.
  const found = await (db as PrismaClient).restaurant.findUnique({ where: { id: restaurantId }, select: { sector: true } });
  if (found?.sector !== SECTORS[space]) throw new StudioError('NOT_FOUND');
}

/** The `space` an action may carry: the page's space, optional so owners and designers are never cut by it. */
export const optionalSpace = z.enum(BUSINESS_SPACES).optional();

/**
 * The first step of an action that works on one business from inside a space: when the page named its space, a business of
 * the other sector is refused as not found and nothing is written. Without `space` it does nothing.
 */
export async function requireSpace(ctx: Pick<ActionContext, 'transaction' | 'restaurantId'>, space: BusinessSpace | undefined): Promise<void> {
  const restaurantId = ctx.restaurantId;
  if (!space || restaurantId === null) return;
  await ctx.transaction((tx) => assertSameSector(tx, restaurantId, space));
}
