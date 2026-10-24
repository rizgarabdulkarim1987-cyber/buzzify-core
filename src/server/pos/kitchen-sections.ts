import type { PrismaClient } from '@/generated/prisma/client';
import type { ScopedTx } from '@/server/data/tenant-db';
import { StudioError } from '@/server/studio/framework/result';

/**
 * The places an order is made: Grill, Bar, Pastry. A category, a product or a staff member points at one. Deleting a
 * section clears those pointers (the foreign keys set them null) and never touches a product.
 */

export interface KitchenSection {
  id: string;
  name: string;
  sortOrder: number;
}

export async function listKitchenSections(db: PrismaClient, restaurantId: string): Promise<KitchenSection[]> {
  return db.posKitchenSection.findMany({ where: { restaurantId }, select: { id: true, name: true, sortOrder: true }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] });
}

export async function addKitchenSection(tx: ScopedTx, restaurantId: string, name: string): Promise<{ id: string }> {
  const last = await tx.posKitchenSection.aggregate({ _max: { sortOrder: true } });
  const sortOrder = last._max.sortOrder === null || last._max.sortOrder === undefined ? 0 : last._max.sortOrder + 1;
  return tx.posKitchenSection.create({ data: { restaurantId, name, sortOrder }, select: { id: true } });
}

async function sectionRow(tx: ScopedTx, sectionId: string) {
  const row = await tx.posKitchenSection.findFirst({ where: { id: sectionId }, select: { id: true, name: true } });
  if (!row) throw new StudioError('NOT_FOUND');
  return row;
}

export async function renameKitchenSectionIn(tx: ScopedTx, sectionId: string, name: string): Promise<{ id: string; before: string }> {
  const row = await sectionRow(tx, sectionId);
  await tx.posKitchenSection.updateMany({ where: { id: row.id }, data: { name } });
  return { id: row.id, before: row.name };
}

export async function removeKitchenSection(tx: ScopedTx, sectionId: string): Promise<{ id: string; name: string }> {
  const row = await sectionRow(tx, sectionId);
  await tx.posKitchenSection.deleteMany({ where: { id: row.id } });
  return row;
}
