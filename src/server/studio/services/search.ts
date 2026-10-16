import type { Prisma, PrismaClient } from '@/generated/prisma/client';
import { formatClientId, parseClientId } from '@/server/domain/restaurant-profile';
import type { ActorScope } from '@/server/studio/framework/query';
import { literal } from './list-filters';

/**
 * Finding restaurants and menus by what a person types: Jump to, and the pickers that choose a restaurant, a menu or a
 * person without loading them all. A typed `%` or `_` is literal (`literal`), `bz-0007` and `bz7` are client 7, and
 * Arabic-script text matches by substring (the database compares it as it is; there is nothing to fold). Everything is
 * limited to the restaurants in `scope`, and to a few rows: more than that is for the lists.
 */

/** How many of each Jump to shows. */
export const JUMP_LIMIT = 8;

/** How many results a picker shows; the person narrows the rest by typing. */
export const PICK_LIMIT = 20;

const restaurantScope = (scope: ActorScope): Prisma.RestaurantWhereInput => (scope.kind === 'all' ? {} : { id: { in: scope.ids } });
const menuScope = (scope: ActorScope): Prisma.MenuWhereInput => (scope.kind === 'all' ? {} : { restaurantId: { in: scope.ids } });

/** Restaurants whose name or city contains the text, or whose client ID it is. */
function restaurantMatch(q: string): Prisma.RestaurantWhereInput {
  const text = { contains: literal(q), mode: 'insensitive' as const };
  const clientNumber = parseClientId(q);
  return { OR: [{ name: text }, { city: text }, ...(clientNumber !== null ? [{ clientNumber }] : [])] };
}

/** Menus whose name or address (current or former) contains the text, whose restaurant's name does, or whose restaurant's client ID it is. */
function menuMatch(q: string): Prisma.MenuWhereInput {
  const text = { contains: literal(q), mode: 'insensitive' as const };
  const clientNumber = parseClientId(q);
  return {
    OR: [
      { name: text },
      { slug: text },
      { slugs: { some: { slug: text } } },
      { restaurant: { name: text } },
      ...(clientNumber !== null ? [{ restaurant: { clientNumber } }] : []),
    ],
  };
}

export interface RestaurantHit {
  id: string;
  name: string;
  clientId: string;
  city: string;
}

export interface MenuHit {
  id: string;
  name: string;
  slug: string;
  restaurantName: string;
  status: 'DRAFT' | 'PUBLISHED' | 'SUSPENDED' | 'ARCHIVED';
}

/** The restaurants matching `q` (all of them, name order, when `q` is empty), at most `limit`. */
export async function findRestaurants(db: PrismaClient, scope: ActorScope, q: string, limit: number): Promise<RestaurantHit[]> {
  const rows = await db.restaurant.findMany({
    where: { AND: [restaurantScope(scope), q === '' ? {} : restaurantMatch(q)] },
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
    take: limit,
    select: { id: true, name: true, clientNumber: true, city: true },
  });
  return rows.map((row) => ({ id: row.id, name: row.name, clientId: formatClientId(row.clientNumber), city: row.city }));
}

/** The menus matching `q` (all of them, name order, when `q` is empty), at most `limit`. */
export async function findMenus(db: PrismaClient, scope: ActorScope, q: string, limit: number): Promise<MenuHit[]> {
  const rows = await db.menu.findMany({
    where: { AND: [menuScope(scope), q === '' ? {} : menuMatch(q)] },
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
    take: limit,
    select: { id: true, name: true, slug: true, status: true, restaurant: { select: { name: true } } },
  });
  return rows.map((row) => ({ id: row.id, name: row.name, slug: row.slug, restaurantName: row.restaurant.name, status: row.status }));
}

export interface PersonHit {
  id: string;
  name: string;
  email: string;
}

/** The people whose name or address contains `q`, at most `limit`. The caller has checked the reader may see people. */
export async function findPeople(db: PrismaClient, q: string, limit: number): Promise<PersonHit[]> {
  const text = literal(q);
  return db.user.findMany({
    where: q === '' ? {} : { OR: [{ name: { contains: text, mode: 'insensitive' } }, { email: { contains: text.toLowerCase() } }] },
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
    take: limit,
    select: { id: true, name: true, email: true },
  });
}
