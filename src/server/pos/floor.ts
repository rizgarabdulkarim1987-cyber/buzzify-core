import type { PrismaClient } from '@/generated/prisma/client';
import type { ScopedTx } from '@/server/data/tenant-db';
import { LOCKED_STATUSES } from '@/server/domain/pos/order-state';
import { StudioError } from '@/server/studio/framework/result';
import { isUniqueViolation, refuse } from './errors';

/** Tables made by one call: more than a restaurant lays out in one go, and a bound on the work. */
export const MAX_TABLES_PER_CALL = 200;

const live = { status: { notIn: [...LOCKED_STATUSES] } };

export interface FloorView {
  areas: { id: string; name: string; sortOrder: number; tables: { id: string; number: number }[] }[];
}

/** The restaurant's areas with their tables, in display order. */
export async function readFloor(db: PrismaClient, restaurantId: string): Promise<FloorView> {
  const areas = await db.posArea.findMany({
    where: { restaurantId },
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    select: { id: true, name: true, sortOrder: true, tables: { orderBy: { number: 'asc' }, select: { id: true, number: true } } },
  });
  return { areas };
}

async function areaOf(tx: ScopedTx, areaId: string) {
  const area = await tx.posArea.findFirst({ where: { id: areaId }, select: { id: true, name: true } });
  if (!area) throw new StudioError('NOT_FOUND');
  return area;
}

export async function createAreaIn(tx: ScopedTx, restaurantId: string, name: string): Promise<{ id: string }> {
  const last = await tx.posArea.aggregate({ _max: { sortOrder: true } });
  return tx.posArea.create({ data: { restaurantId, name, sortOrder: (last._max.sortOrder ?? -1) + 1 }, select: { id: true } });
}

export async function renameAreaIn(tx: ScopedTx, areaId: string, name: string): Promise<{ id: string; before: string }> {
  const area = await areaOf(tx, areaId);
  await tx.posArea.updateMany({ where: { id: area.id }, data: { name } });
  return { id: area.id, before: area.name };
}

/** Creates tables `from` to `to` in the area, all or nothing: a number already in use fails the whole call. */
export async function createTablesIn(
  tx: ScopedTx,
  restaurantId: string,
  input: { areaId: string; from: number; to: number },
): Promise<{ count: number }> {
  const area = await areaOf(tx, input.areaId);
  const taken = await tx.posTable.count({ where: { number: { gte: input.from, lte: input.to } } });
  if (taken > 0) throw refuse('CONFLICT', 'Table numbers already in use');
  const data = Array.from({ length: input.to - input.from + 1 }, (_, i) => ({ restaurantId, areaId: area.id, number: input.from + i }));
  try {
    await tx.posTable.createMany({ data });
  } catch (error) {
    // A concurrent call passed the check above and then hit the unique index.
    if (isUniqueViolation(error)) throw refuse('CONFLICT', 'Table numbers already in use');
    throw error;
  }
  return { count: data.length };
}

/** Removes a table unless it has an unfinished order; finished orders keep existing without a table. */
export async function deleteTableIn(tx: ScopedTx, tableId: string): Promise<{ id: string; number: number }> {
  const table = await tx.posTable.findFirst({ where: { id: tableId }, select: { id: true, number: true } });
  if (!table) throw new StudioError('NOT_FOUND');
  // The guard is in the delete itself, so an order opened a moment ago is not raced past.
  const { count } = await tx.posTable.deleteMany({ where: { id: table.id, orders: { none: live } } });
  if (count === 0) throw refuse('CONFLICT', 'A table has an open order');
  return table;
}

/** Removes an area and its tables; refused while any of its tables has an unfinished order. */
export async function deleteAreaIn(tx: ScopedTx, areaId: string): Promise<{ id: string; name: string; tables: number }> {
  const area = await areaOf(tx, areaId);
  const { count: tables } = await tx.posTable.deleteMany({ where: { areaId: area.id, orders: { none: live } } });
  if ((await tx.posTable.count({ where: { areaId: area.id } })) > 0) throw refuse('CONFLICT', 'A table has an open order');
  await tx.posArea.deleteMany({ where: { id: area.id } });
  return { ...area, tables };
}

export async function moveTableIn(tx: ScopedTx, tableId: string, areaId: string): Promise<{ id: string; from: string }> {
  const table = await tx.posTable.findFirst({ where: { id: tableId }, select: { id: true, areaId: true } });
  if (!table) throw new StudioError('NOT_FOUND');
  const area = await areaOf(tx, areaId);
  await tx.posTable.updateMany({ where: { id: table.id }, data: { areaId: area.id } });
  return { id: table.id, from: table.areaId };
}
