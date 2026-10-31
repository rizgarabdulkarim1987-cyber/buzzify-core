import { z } from 'zod';
import type { Prisma, PrismaClient } from '@/generated/prisma/client';
import type { BusinessSector } from '@/server/domain/restaurant-profile';
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
 * A business that has since been deleted is in no space, so its rows show in none.
 */
export async function sectorRestaurantIds(db: PrismaClient, space: BusinessSpace): Promise<string[]> {
  const rows = await db.restaurant.findMany({ where: sectorWhere(space), select: { id: true } });
  return rows.map((row) => row.id);
}

/** Refuses a business of the other sector as if it did not exist, so a write through one space never touches the other. */
export async function assertSameSector(db: Pick<PrismaClient, 'restaurant'>, restaurantId: string, space: BusinessSpace): Promise<void> {
  const found = await db.restaurant.findFirst({ where: { id: restaurantId, ...sectorWhere(space) }, select: { id: true } });
  if (!found) throw new StudioError('NOT_FOUND');
}
