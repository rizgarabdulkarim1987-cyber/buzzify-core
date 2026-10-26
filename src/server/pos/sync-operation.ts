import { createHash } from 'node:crypto';
import type { AnyDb } from '@/server/data/tenant-db';

/** JSON with every object's keys in sorted order, so equal payloads are equal text however the client ordered them. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** The sha256 (hex) of a payload's canonical JSON: the same operation id with another payload is a different request. */
export function payloadHash(payload: unknown): string {
  return createHash('sha256').update(canonical(payload)).digest('hex');
}

export interface StoredOperation {
  userId: string;
  deviceId: string;
  kind: string;
  payloadHash: string;
  result: unknown;
}

/** The operation this restaurant already applied under `operationId`, or null. Another restaurant's row is never found. */
export async function findStoredOperation(db: AnyDb, restaurantId: string, operationId: string): Promise<StoredOperation | null> {
  return db.posSyncOperation.findFirst({
    where: { restaurantId, operationId },
    select: { userId: true, deviceId: true, kind: true, payloadHash: true, result: true },
  });
}
