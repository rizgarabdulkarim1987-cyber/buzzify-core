import { z } from 'zod';
import type { Prisma, PrismaClient } from '@/generated/prisma/client';
import { AUDIT_ACTIONS } from '@/server/domain/audit-actions';
import { createdBetween, dateField } from './list-filters';

/**
 * The audit log as the Studio shows it: filtered, paged, and with the names of the people, restaurants and menus its
 * rows only hold ids for. The log keeps ids, not relations, so it outlives what it describes; a row whose restaurant or
 * menu is gone still reads, with `deleted` where the name would be. What a row changed (`changes`) is never part of
 * these rows: the Activity screen names what happened, where and to whom, not the values.
 */

export const ACTIVITY_PAGE_SIZE = 50;

const idField = z.string().min(1).max(100);

/** What Activity filters by. Every part is optional; a date is a calendar day in the Studio's time zone. */
export const activityFilters = z.object({
  actorId: idField.optional(),
  restaurantId: idField.optional(),
  menuId: idField.optional(),
  action: z.enum(AUDIT_ACTIONS, 'Choose one of the changes offered').optional(),
  from: dateField.optional(),
  to: dateField.optional(),
  page: z.number().int().min(1).max(100_000).default(1),
});

export type ActivityFilters = z.infer<typeof activityFilters>;

/** A person, restaurant or menu a row names: its id and its name, or no name once it no longer exists. */
export interface Named {
  id: string;
  name: string | null;
}

/** One row of the audit log, ready to show. */
export interface AuditRow {
  id: string;
  /** The action's name, such as `menu.published`; the Studio has a label for it in each language. */
  action: string;
  /** The kind of thing it was done to (`Menu`, `User`, ...), and its id. */
  entityType: string;
  entityId: string;
  /** For a person it was done to, their name. */
  entityName: string | null;
  actor: Named | null;
  restaurant: Named | null;
  menu: Named | null;
  occurredAt: string;
}

type Row = Prisma.AuditLogGetPayload<{
  select: { id: true; action: true; entityType: true; entityId: true; actorId: true; restaurantId: true; menuId: true; occurredAt: true };
}>;

export const ROW_SELECT = {
  id: true,
  action: true,
  entityType: true,
  entityId: true,
  actorId: true,
  restaurantId: true,
  menuId: true,
  occurredAt: true,
} as const;

const idsOf = (rows: Row[], pick: (row: Row) => string | null) => [...new Set(rows.map(pick).filter((id): id is string => id !== null))];

/** The names behind the ids of `rows`, three reads for the whole page. */
export async function describeRows(db: PrismaClient, rows: Row[]): Promise<AuditRow[]> {
  const userIds = [...new Set([...idsOf(rows, (row) => row.actorId), ...rows.filter((row) => row.entityType === 'User').map((row) => row.entityId)])];
  const restaurantIds = idsOf(rows, (row) => row.restaurantId);
  const menuIds = idsOf(rows, (row) => row.menuId);
  const [users, restaurants, menus] = await Promise.all([
    userIds.length > 0 ? db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }) : [],
    restaurantIds.length > 0 ? db.restaurant.findMany({ where: { id: { in: restaurantIds } }, select: { id: true, name: true } }) : [],
    menuIds.length > 0 ? db.menu.findMany({ where: { id: { in: menuIds } }, select: { id: true, name: true } }) : [],
  ]);
  const userName = new Map(users.map((user) => [user.id, user.name]));
  const restaurantName = new Map(restaurants.map((restaurant) => [restaurant.id, restaurant.name]));
  const menuName = new Map(menus.map((menu) => [menu.id, menu.name]));
  const named = (id: string | null, names: Map<string, string>): Named | null => (id === null ? null : { id, name: names.get(id) ?? null });

  return rows.map((row) => ({
    id: row.id,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    entityName: row.entityType === 'User' ? (userName.get(row.entityId) ?? null) : null,
    actor: named(row.actorId, userName),
    restaurant: named(row.restaurantId, restaurantName),
    menu: named(row.menuId, menuName),
    occurredAt: row.occurredAt.toISOString(),
  }));
}

/** The log rows that match the filters, newest first (the id breaks ties, so a page boundary never repeats a row). */
export function activityWhere(filters: Omit<ActivityFilters, 'page'>): Prisma.AuditLogWhereInput {
  const occurred = createdBetween(filters.from, filters.to);
  return {
    ...(filters.actorId ? { actorId: filters.actorId } : {}),
    ...(filters.restaurantId ? { restaurantId: filters.restaurantId } : {}),
    ...(filters.menuId ? { menuId: filters.menuId } : {}),
    ...(filters.action ? { action: filters.action } : {}),
    ...(occurred ? { occurredAt: occurred } : {}),
  };
}

export async function listActivityRows(db: PrismaClient, filters: ActivityFilters) {
  const where = activityWhere(filters);
  const [total, found] = await Promise.all([
    db.auditLog.count({ where }),
    db.auditLog.findMany({
      where,
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      skip: (filters.page - 1) * ACTIVITY_PAGE_SIZE,
      take: ACTIVITY_PAGE_SIZE,
      select: ROW_SELECT,
    }),
  ]);
  return { total, rows: await describeRows(db, found) };
}

/** One row of a restaurant's own log: an Activity row, with the names of the fields the change touched. */
export interface RestaurantAuditRow extends AuditRow {
  /** The fields of the change, such as `name` or `city`; never what they held. */
  fields: string[];
}

/** The names of the fields in a row's `changes`, whatever was stored there. */
function fieldNames(changes: unknown): string[] {
  return typeof changes === 'object' && changes !== null && !Array.isArray(changes) ? Object.keys(changes) : [];
}

/**
 * A restaurant's own log, newest first, for its Activity tab: the rows Activity shows (`ROW_SELECT`, named by
 * `describeRows`), each with the names of the fields it changed. The values are read only to list their names and never
 * leave this function: no Studio read returns what a change held.
 */
export async function restaurantActivityRows(
  db: PrismaClient,
  args: { restaurantId: string; page: number; pageSize: number },
): Promise<{ total: number; rows: RestaurantAuditRow[] }> {
  const where = { restaurantId: args.restaurantId };
  const [total, found] = await Promise.all([
    db.auditLog.count({ where }),
    db.auditLog.findMany({
      where,
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      skip: (args.page - 1) * args.pageSize,
      take: args.pageSize,
      select: { ...ROW_SELECT, changes: true },
    }),
  ]);
  const described = await describeRows(db, found);
  return { total, rows: described.map((row, index) => ({ ...row, fields: fieldNames(found[index]!.changes) })) };
}

/** The newest rows of the whole log, for the Overview. */
export async function recentActivityRows(db: PrismaClient, limit: number): Promise<AuditRow[]> {
  const found = await db.auditLog.findMany({ orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }], take: limit, select: ROW_SELECT });
  return describeRows(db, found);
}
