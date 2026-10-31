import type { LiveOverlay } from '@/server/domain/snapshot';
import { delegates, type AnyDb, type ScopedDb } from './tenant-db';

/**
 * What a menu's guests see change without a publish, read from its draft rows: sold-out and hidden products, stock,
 * and sold-out options. Only rows that differ from the default (available, shown, uncounted) are listed, since
 * `toCatalog` treats an id the overlay does not mention as exactly that.
 */
export function loadOverlay(db: AnyDb, menuId: string): Promise<LiveOverlay>;
export function loadOverlay(db: ScopedDb, menuId: string): Promise<LiveOverlay>;
export async function loadOverlay(client: AnyDb | ScopedDb, menuId: string): Promise<LiveOverlay> {
  const db = delegates(client);
  // One query at a time, so a transaction (one connection) can be passed too.
  const products = await db.product.findMany({
    where: { menuId, OR: [{ isAvailable: false }, { isHidden: true }, { stockCount: { not: null } }, { dropEndsAt: { not: null } }] },
    select: { id: true, isAvailable: true, isHidden: true, stockCount: true, dropStartsAt: true, dropEndsAt: true },
  });
  const options = await db.modifierOption.findMany({
    where: { menuId, isAvailable: false },
    select: { id: true, isAvailable: true },
  });
  return {
    products: Object.fromEntries(
      products.map((p) => [
        p.id,
        {
          isAvailable: p.isAvailable,
          isHidden: p.isHidden,
          stockCount: p.stockCount,
          ...(p.dropStartsAt && p.dropEndsAt ? { dropStartsAt: p.dropStartsAt.toISOString(), dropEndsAt: p.dropEndsAt.toISOString() } : {}),
        },
      ]),
    ),
    options: Object.fromEntries(options.map((o) => [o.id, { isAvailable: o.isAvailable }])),
  };
}
