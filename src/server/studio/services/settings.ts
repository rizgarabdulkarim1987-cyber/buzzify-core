import { delegates, type AnyDb, type ScopedDb } from '@/server/data/tenant-db';
import { normalizeReservedSlugs, readPlatformSettings, type PlatformSettings } from '@/server/domain/platform-settings';

/**
 * Reading the platform settings. They are stored one row per key (`PlatformSetting`) and read in one place: every
 * caller gets the built-in defaults with the stored values on top, and a stored value that does not fit its key is
 * ignored rather than thrown on (`readPlatformSettings`). The table is global, so any client reads it, a transaction
 * scoped to a menu or a restaurant included.
 */

/** All the platform settings. Works on the application's client, on a transaction, and on a scoped one. */
export function getPlatformSettings(db: AnyDb): Promise<PlatformSettings>;
export function getPlatformSettings(db: ScopedDb): Promise<PlatformSettings>;
export async function getPlatformSettings(client: AnyDb | ScopedDb): Promise<PlatformSettings> {
  const rows = await delegates(client).platformSetting.findMany({ select: { key: true, value: true } });
  return readPlatformSettings(rows);
}

/**
 * The words the platform has reserved, normalized as slugs are compared. One row is read, for the places that only need
 * the list (every slug check).
 */
export function readReservedSlugs(db: AnyDb): Promise<string[]>;
export function readReservedSlugs(db: ScopedDb): Promise<string[]>;
export async function readReservedSlugs(client: AnyDb | ScopedDb): Promise<string[]> {
  const row = await delegates(client).platformSetting.findUnique({ where: { key: 'reservedSlugs' }, select: { value: true } });
  if (!row || !Array.isArray(row.value)) return [];
  return normalizeReservedSlugs(row.value);
}
