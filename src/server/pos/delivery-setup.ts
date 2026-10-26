import type { PrismaClient } from '@/generated/prisma/client';
import type { ScopedTx } from '@/server/data/tenant-db';
import { StudioError } from '@/server/studio/framework/result';
import { refuse } from './errors';

/** The delivery areas (with their fee) and the drivers of one restaurant. Drivers never sign in; they are a name and a phone. */

export const MAX_ZONES = 50;
export const MAX_DRIVERS = 100;

export interface ZoneRow {
  id: string;
  name: string;
  fee: number;
  active: boolean;
  sortOrder: number;
}

export interface DriverRow {
  id: string;
  name: string;
  phone: string;
  active: boolean;
}

const zoneSelect = { id: true, name: true, fee: true, active: true, sortOrder: true } as const;
const driverSelect = { id: true, name: true, phone: true, active: true } as const;

export async function listZones(db: PrismaClient, restaurantId: string, options: { activeOnly?: boolean } = {}): Promise<ZoneRow[]> {
  return db.posDeliveryZone.findMany({
    where: { restaurantId, ...(options.activeOnly ? { active: true } : {}) },
    select: zoneSelect,
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }, { id: 'asc' }],
  });
}

export async function listDrivers(db: PrismaClient, restaurantId: string, options: { activeOnly?: boolean } = {}): Promise<DriverRow[]> {
  return db.posDriver.findMany({
    where: { restaurantId, ...(options.activeOnly ? { active: true } : {}) },
    select: driverSelect,
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
  });
}

async function assertZoneNameFree(tx: ScopedTx, name: string, exceptId?: string): Promise<void> {
  const clash = await tx.posDeliveryZone.findFirst({
    where: { name: { equals: name, mode: 'insensitive' }, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { id: true },
  });
  if (clash) throw refuse('CONFLICT', 'A delivery zone with this name already exists', { name: 'A delivery zone with this name already exists' });
}

export async function createZoneIn(tx: ScopedTx, restaurantId: string, input: { name: string; fee: number }): Promise<{ id: string }> {
  if ((await tx.posDeliveryZone.count()) >= MAX_ZONES) throw refuse('CONFLICT', 'Create at most 50 delivery zones');
  await assertZoneNameFree(tx, input.name);
  const last = await tx.posDeliveryZone.aggregate({ _max: { sortOrder: true } });
  return tx.posDeliveryZone.create({ data: { restaurantId, name: input.name, fee: input.fee, sortOrder: (last._max.sortOrder ?? -1) + 1 }, select: { id: true } });
}

export async function updateZoneIn(tx: ScopedTx, zoneId: string, input: { name?: string; fee?: number; active?: boolean }) {
  const zone = await tx.posDeliveryZone.findFirst({ where: { id: zoneId }, select: zoneSelect });
  if (!zone) throw new StudioError('NOT_FOUND');
  if (input.name !== undefined) await assertZoneNameFree(tx, input.name, zone.id);
  await tx.posDeliveryZone.updateMany({ where: { id: zone.id }, data: input });
  return { before: zone, after: { ...zone, ...input } };
}

export async function deleteZoneIn(tx: ScopedTx, zoneId: string): Promise<ZoneRow> {
  const zone = await tx.posDeliveryZone.findFirst({ where: { id: zoneId }, select: zoneSelect });
  if (!zone) throw new StudioError('NOT_FOUND');
  await tx.posDeliveryZone.deleteMany({ where: { id: zone.id } });
  return zone;
}

export async function createDriverIn(tx: ScopedTx, restaurantId: string, input: { name: string; phone: string }): Promise<{ id: string }> {
  if ((await tx.posDriver.count()) >= MAX_DRIVERS) throw refuse('CONFLICT', 'Create at most 100 drivers');
  return tx.posDriver.create({ data: { restaurantId, name: input.name, phone: input.phone }, select: { id: true } });
}

export async function updateDriverIn(tx: ScopedTx, driverId: string, input: { name?: string; phone?: string; active?: boolean }) {
  const driver = await tx.posDriver.findFirst({ where: { id: driverId }, select: driverSelect });
  if (!driver) throw new StudioError('NOT_FOUND');
  await tx.posDriver.updateMany({ where: { id: driver.id }, data: input });
  return { before: driver, after: { ...driver, ...input } };
}
