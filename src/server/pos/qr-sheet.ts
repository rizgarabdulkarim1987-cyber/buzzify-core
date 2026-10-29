import type { PrismaClient } from '@/generated/prisma/client';
import type { AnyDb } from '@/server/data/tenant-db';
import { scopedClient } from '@/server/data/tenant-db';
import { expiryCutoff } from '@/server/domain/pos/customer-order-rules';
import { DEFAULT_QR_STYLE } from '@/server/domain/qr';
import { previewQr } from '@/server/qr/render';

/** What the till's frame needs on every page: whether QR ordering is on and how many guest orders and unseen bill calls wait. */
export async function readQrFlags(
  prisma: PrismaClient,
  restaurantId: string,
  now: Date = new Date(),
): Promise<{ qrOrdering: boolean; delivery: boolean; pendingRequests: number; billCalls: number; captainApproval: boolean }> {
  const till = scopedClient(prisma, { restaurantId });
  const settings = await till.posSettings.findFirst({ where: { restaurantId }, select: { qrOrderingEnabled: true, deliveryEnabled: true, captainApproval: true } });
  const delivery = settings?.deliveryEnabled === true;
  const captainApproval = settings?.captainApproval === true;
  if (!settings?.qrOrderingEnabled) return { qrOrdering: false, delivery, pendingRequests: 0, billCalls: 0, captainApproval };
  const pendingRequests = await till.posCustomerOrder.count({ where: { restaurantId, status: 'PENDING', createdAt: { gt: expiryCutoff(now) } } });
  // A call left unseen for longer than a request waits stops counting, like the list of calls.
  const billCalls = await till.posBillCall.count({ where: { restaurantId, seenAt: null, createdAt: { gt: expiryCutoff(now) } } });
  return { qrOrdering: true, delivery, pendingRequests, billCalls, captainApproval };
}

export interface QrSheetView {
  enabled: boolean;
  /** The catalog menu's address (its slug) and whether guests can open it; null until a catalog menu is chosen. */
  menu: { id: string; slug: string; published: boolean } | null;
  tables: { id: string; number: number; areaName: string; hasMenuPage: boolean; url: string; svg: string }[];
}

/**
 * The table codes for printing: one per table of the floor, each pointing at the Menu's own table page (`/{address}/t/{n}`),
 * which is the one QR a table has. `db` is scoped to the restaurant and its catalog menu.
 */
export async function readQrSheet(db: AnyDb, restaurantId: string, menuId: string | null, origin: string): Promise<QrSheetView> {
  const settings = await db.posSettings.findFirst({ where: { restaurantId }, select: { qrOrderingEnabled: true } });
  const menu = menuId ? await db.menu.findFirst({ where: { id: menuId, restaurantId }, select: { id: true, slug: true, status: true } }) : null;
  const [areas, menuTables] = await Promise.all([
    db.posArea.findMany({
      where: { restaurantId },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      select: { name: true, tables: { orderBy: { number: 'asc' }, select: { id: true, number: true } } },
    }),
    menu ? db.table.findMany({ where: { menuId: menu.id }, select: { number: true } }) : Promise.resolve([]),
  ]);
  const present = new Set(menuTables.map((table) => table.number));
  const tables = areas.flatMap((area) => area.tables.map((table) => ({ ...table, areaName: area.name })));
  tables.sort((a, b) => a.number - b.number);
  return {
    enabled: settings?.qrOrderingEnabled === true,
    menu: menu ? { id: menu.id, slug: menu.slug, published: menu.status === 'PUBLISHED' } : null,
    tables: tables.map((table) => {
      const url = menu ? `${origin}/${menu.slug}/t/${table.number}` : '';
      return {
        id: table.id,
        number: table.number,
        areaName: table.areaName,
        hasMenuPage: present.has(table.number),
        url,
        svg: url ? previewQr({ url, style: DEFAULT_QR_STYLE, logo: null }) : '',
      };
    }),
  };
}

/** Makes the Menu's table pages for the floor's tables that have none, so every printed code opens something. */
export async function ensureMenuTablesIn(db: AnyDb, restaurantId: string, menuId: string, label: (number: number) => string): Promise<{ created: number }> {
  const tables = await db.posTable.findMany({ where: { restaurantId }, select: { number: true } });
  const existing = new Set((await db.table.findMany({ where: { menuId }, select: { number: true } })).map((table) => table.number));
  const missing = tables.map((table) => table.number).filter((number) => !existing.has(number));
  if (missing.length === 0) return { created: 0 };
  const { count } = await db.table.createMany({ data: missing.map((number) => ({ menuId, number, label: label(number) })), skipDuplicates: true });
  return { created: count };
}
