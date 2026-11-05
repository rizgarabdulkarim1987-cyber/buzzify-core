import { z } from 'zod';
import type { Prisma, PrismaClient } from '@/generated/prisma/client';
import type { BusinessSector } from '@/server/domain/restaurant-profile';
import { DEFAULT_RETAIL_ACTIVITY, type RetailActivity } from '@/server/domain/retail/activity';
import type { ScopedTx } from '@/server/data/tenant-db';
import type { ActionContext } from '@/server/studio/framework/action';
import type { ActorScope } from '@/server/studio/framework/query';
import { StudioError } from '@/server/studio/framework/result';

/**
 * The closed spaces of a Super Admin, seen from the data: Menu and Cashier works on FOOD businesses, the Pharmacy on
 * PHARMACY ones, and each of the three Retail products (Supermarket, Electronics, Clothing) on the RETAIL businesses of
 * its own product (`RetailLink.activity`; docs/superpowers/specs/2026-10-31-super-admin-project-hub-design.md). A query or
 * action that serves a space takes `space` and cuts its rows by the sector and, for a Retail product, by the product, so
 * a business of another project is never read or written through it. Only a Super Admin (scope `all`) is cut by space;
 * everyone else sees what they always saw.
 */

const RETAIL_SPACES = ['supermarket', 'electronics', 'clothing'] as const;
const BUSINESS_SPACES = ['food', 'pharmacy', ...RETAIL_SPACES] as const;

/** The `space` input of a query: Menu and Cashier unless the page names another space. */
export const businessSpace = z.enum(BUSINESS_SPACES).default('food');
export type BusinessSpace = z.infer<typeof businessSpace>;
export type RetailSpace = (typeof RETAIL_SPACES)[number];
/** A Retail product's space, for what only those spaces read. */
export const retailSpace = z.enum(RETAIL_SPACES);

const SECTORS: Record<BusinessSpace, BusinessSector> = { food: 'FOOD', pharmacy: 'PHARMACY', supermarket: 'RETAIL', electronics: 'RETAIL', clothing: 'RETAIL' };
const ACTIVITY: Record<RetailSpace, RetailActivity> = { supermarket: 'SUPERMARKET', electronics: 'ELECTRONICS', clothing: 'CLOTHING' };

export const isRetailSpace = (space: string): space is RetailSpace => (RETAIL_SPACES as readonly string[]).includes(space);

/** The Retail product a space works on; null for Menu and Cashier and the Pharmacy. */
export const activityOf = (space: BusinessSpace): RetailActivity | null => (isRetailSpace(space) ? ACTIVITY[space] : null);

/**
 * The products (billing applications) each space sells and bills. The three Retail products share the one `retail`
 * product and its plans for now: plans of their own per product are a later step.
 */
export const APPLICATIONS_OF: Record<BusinessSpace, readonly string[]> = {
  food: ['menu', 'cashier'],
  pharmacy: ['pharmacy'],
  supermarket: ['retail'],
  electronics: ['retail'],
  clothing: ['retail'],
};

/** The products a business of a sector may be billed for. */
export const applicationsOfSector = (sector: BusinessSector): readonly string[] =>
  sector === 'RETAIL' ? ['retail'] : sector === 'PHARMACY' ? ['pharmacy'] : ['menu', 'cashier'];

export const sectorOf = (space: BusinessSpace): BusinessSector => SECTORS[space];

/** The space a business belongs to: its sector, and for a RETAIL business its product (a shop without a link is a supermarket). */
export function spaceOfBusiness(sector: BusinessSector, activity?: RetailActivity | null): BusinessSpace {
  if (sector === 'PHARMACY') return 'pharmacy';
  if (sector !== 'RETAIL') return 'food';
  const wanted = activity ?? DEFAULT_RETAIL_ACTIVITY;
  return RETAIL_SPACES.find((space) => ACTIVITY[space] === wanted) ?? 'supermarket';
}

/**
 * The businesses of a space. A Retail product's are the RETAIL businesses whose link names it; a RETAIL business with no
 * link at all (none is made that way, but one could be left by hand) counts as a supermarket, so it is never in no space.
 */
export function sectorWhere(space: BusinessSpace): Prisma.RestaurantWhereInput {
  if (!isRetailSpace(space)) return { sector: SECTORS[space] };
  const activity = ACTIVITY[space];
  const linked: Prisma.RestaurantWhereInput = { retailLink: { is: { activity } } };
  return { sector: 'RETAIL', ...(activity === DEFAULT_RETAIL_ACTIVITY ? { OR: [linked, { retailLink: { is: null } }] } : linked) };
}

/**
 * The values an announcement of a space may be stored under. Those written in the single Retail space, before the three
 * products, were stored as "retail": they belong to the Supermarket, as every shop of that time does.
 */
export const announcementSpaces = (space: BusinessSpace): string[] => (space === 'supermarket' ? ['supermarket', 'retail'] : [space]);

/** The businesses a reader sees through a space: a Super Admin's are cut to its sector (and product), anyone else's are not cut. */
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
 * The audit rows of a space. The log keeps plain restaurant ids, so the Pharmacy and each Retail product have the rows
 * of their own businesses and Menu and Cashier has all the rest: its own businesses, the platform's own events (a
 * setting, an announcement) that name no business, and a business since deleted. A plan (`AppPlan`) row of the `retail`
 * product is shown in each Retail product (they share its plans for now), any other plan row in the Pharmacy; an
 * announcement row is the space's it was written in. Nothing in the log is hidden; only the shared Retail plans' rows
 * are in more than one space.
 */
export async function auditSpaceWhere(db: PrismaClient, space: BusinessSpace): Promise<Prisma.AuditLogWhereInput> {
  const [pharmacyIds, retailIds, ownRetailIds, retailPlans, notes] = await Promise.all([
    sectorRestaurantIds(db, 'pharmacy'),
    db.restaurant.findMany({ where: { sector: 'RETAIL' }, select: { id: true } }).then((rows) => rows.map((row) => row.id)),
    isRetailSpace(space) ? sectorRestaurantIds(db, space) : Promise.resolve<string[]>([]),
    // Plans are only taken off sale, never deleted, so a plan row's id still names its product.
    db.appPlan.findMany({ where: { applicationId: 'retail' }, select: { id: true } }),
    db.announcement.findMany({ where: { space: { not: 'food' } }, select: { id: true, space: true } }),
  ]);
  const retailPlanIds = retailPlans.map((row) => row.id);
  const notesOf = (spaces: readonly string[]) => notes.filter((row) => spaces.includes(row.space)).map((row) => row.id);
  // Each exclusion is spelled out because `NOT (x IN ...)` is unknown, not true, for the null restaurant of a platform event.
  const notIn = (ids: string[]): Prisma.AuditLogWhereInput => ({ OR: [{ restaurantId: null }, { restaurantId: { notIn: ids } }] });
  const notNote = (ids: string[]): Prisma.AuditLogWhereInput => ({ OR: [{ entityType: { not: 'Announcement' } }, { entityId: { notIn: ids } }] });

  if (isRetailSpace(space)) {
    return {
      OR: [
        { restaurantId: { in: ownRetailIds } },
        { entityType: 'AppPlan', entityId: { in: retailPlanIds } },
        { entityType: 'Announcement', entityId: { in: notesOf(announcementSpaces(space)) } },
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
            { entityType: 'Announcement', entityId: { in: notesOf(['pharmacy']) } },
          ],
        },
        notIn(retailIds),
      ],
    };
  }
  // Everything else: no business of another space, no plan, and no announcement written in another space.
  return {
    AND: [notIn([...pharmacyIds, ...retailIds]), { entityType: { not: 'AppPlan' } }, notNote(notes.map((row) => row.id))],
  };
}

/** Refuses a business of another space as if it did not exist, so a write through one space never touches another. */
export async function assertSameSector(db: PrismaClient | ScopedTx, restaurantId: string, space: BusinessSpace): Promise<void> {
  // A scoped transaction exposes the same `restaurant.findUnique`; the union of two generic signatures is not callable as is.
  const found = await (db as PrismaClient).restaurant.findUnique({ where: { id: restaurantId }, select: { sector: true, retailLink: { select: { activity: true } } } });
  if (!found || spaceOfBusiness(found.sector, found.retailLink?.activity) !== space) throw new StudioError('NOT_FOUND');
}

/** The `space` an action may carry: the page's space, optional so owners and designers are never cut by it. */
export const optionalSpace = z.enum(BUSINESS_SPACES).optional();

/**
 * The first step of an action that works on one business from inside a space: when the page named its space, a business of
 * another space is refused as not found and nothing is written. Without `space` it does nothing.
 */
export async function requireSpace(ctx: Pick<ActionContext, 'transaction' | 'restaurantId'>, space: BusinessSpace | undefined): Promise<void> {
  const restaurantId = ctx.restaurantId;
  if (!space || restaurantId === null) return;
  await ctx.transaction((tx) => assertSameSector(tx, restaurantId, space));
}
