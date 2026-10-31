import { createHash } from 'node:crypto';
import type { Prisma, PrismaClient } from '@/generated/prisma/client';
import type { Locale } from '@/lib/locale';
import type { TenantInfo } from '@/server/data/tenant';
import { menuDb } from '@/server/data/tenant-db';
import { QR_LIMITS } from '@/server/domain/pos/customer-order-rules';
import { BASKET_LIMITS, fitsOneOrder, isLive, lastSentOrder, mergedLines, type BasketLine, type BasketPart } from '@/server/domain/pos/table-basket-rules';
import type { Catalog } from '@/server/domain/types';
import { priceRequestLines } from './customer-orders';
import { QrGateClosed, QrOrderRefusal, qrOrderGate, submitCustomerOrder } from './customer-orders-guest';

/**
 * The table basket (plan feature `ordering.tableBasket`, spec 2026-10-31-project-5-table-basket-design.md). Reached without a
 * sign-in from the Menu's table page, so it trusts nothing a phone sends but ids, quantities, notes and a name: every price
 * comes from the published catalog. A guest writes only the part their own token owns.
 */

/** A refusal the guest can be told about, on top of the QR order's. */
export class BasketRefusal extends Error {
  constructor(readonly code: 'INVALID_CART' | 'TOO_MANY_GUESTS' | 'TOO_MANY_LINES' | 'NOTHING_TO_SEND' | 'NOT_A_GUEST') {
    super(code);
  }
}

export const ownerKeyOf = (token: string): string => createHash('sha256').update(token).digest('hex');

export interface BasketLineView {
  name: string;
  quantity: number;
  options: string[];
  note: string;
  /** What the guest pays for the line, in minor units. */
  total: number;
}

export interface BasketPartView {
  mine: boolean;
  name: string;
  lines: BasketLineView[];
  /** The part holds a dish the menu no longer offers; it cannot be sent until the guest changes it. */
  invalid: boolean;
}

export interface BasketView {
  parts: BasketPartView[];
  total: number;
  /** The order the table sent most recently, which every phone follows. */
  sent: { publicId: string } | null;
}

type Tenant = Pick<TenantInfo, 'id' | 'restaurantId' | 'features'>;

/** The gate every call passes: ordering is open at this table and the plan has the basket. */
async function openGate(prisma: PrismaClient, tenant: Tenant, table: number, now: Date): Promise<void> {
  if (!tenant.features.tableBasket) throw new QrGateClosed();
  const gate = await qrOrderGate(prisma, tenant, table, now);
  if (!gate.open) throw new QrGateClosed();
}

const linesOf = (value: Prisma.JsonValue): BasketLine[] => (Array.isArray(value) ? (value as unknown as BasketLine[]) : []);

async function loadParts(prisma: PrismaClient, tenant: Tenant, table: number, now: Date): Promise<BasketPart[]> {
  const cutoff = new Date(now.getTime() - Math.max(BASKET_LIMITS.liveMinutes, BASKET_LIMITS.sentKeepMinutes) * 60_000);
  const rows = await menuDb(prisma, tenant.id).tableBasketPart.findMany({ where: { tableNumber: table, updatedAt: { gt: cutoff } }, orderBy: { updatedAt: 'asc' } });
  return rows.map((row) => ({ ownerKey: row.ownerKey, name: row.name, lines: linesOf(row.lines), updatedAt: row.updatedAt, sentPublicId: row.sentPublicId, sentAt: row.sentAt }));
}

/** The table's live basket as one guest sees it: every part, with names and prices from the catalog. */
export async function readBasket(prisma: PrismaClient, tenant: Tenant, catalog: Catalog, input: { table: number; token: string }, now: Date = new Date()): Promise<BasketView> {
  await openGate(prisma, tenant, input.table, now);
  const mine = ownerKeyOf(input.token);
  const parts = await loadParts(prisma, tenant, input.table, now);
  const views: BasketPartView[] = [];
  let total = 0;
  for (const part of parts.filter((entry) => isLive(entry, now) && entry.lines.length > 0)) {
    const priced = priceRequestLines(catalog, part.lines, now);
    const lines: BasketLineView[] = (priced ?? []).map((line) => {
      const optionsTotal = line.optionsSnapshot.reduce((sum, option) => sum + option.priceDelta, 0);
      return {
        name: line.nameSnapshot,
        quantity: line.quantity,
        options: line.optionsSnapshot.map((option) => option.name),
        note: line.note,
        total: Math.max(0, line.unitPriceSnapshot + optionsTotal - line.promoDiscountPerUnit) * line.quantity,
      };
    });
    total += lines.reduce((sum, line) => sum + line.total, 0);
    views.push({ mine: part.ownerKey === mine, name: part.name, lines, invalid: priced === null });
  }
  const sent = lastSentOrder(parts, now);
  return { parts: views, total, sent: sent ? { publicId: sent.publicId } : null };
}

export interface WritePartInput {
  table: number;
  token: string;
  name: string;
  lines: BasketLine[];
}

/** Replaces the guest's own part with these lines; no lines removes it. Nothing of anyone else's part is read or changed. */
export async function writePart(prisma: PrismaClient, tenant: Tenant, catalog: Catalog, input: WritePartInput, now: Date = new Date()): Promise<void> {
  await openGate(prisma, tenant, input.table, now);
  const ownerKey = ownerKeyOf(input.token);
  const db = menuDb(prisma, tenant.id);
  if (input.lines.length > 0 && priceRequestLines(catalog, input.lines, now) === null) throw new BasketRefusal('INVALID_CART');
  const parts = await loadParts(prisma, tenant, input.table, now);
  const own = parts.find((part) => part.ownerKey === ownerKey);

  if (input.lines.length === 0) {
    // A sent part stays: it is how the table's other phones learn which order to follow.
    await db.tableBasketPart.deleteMany({ where: { tableNumber: input.table, ownerKey, sentPublicId: null } });
    return;
  }
  if (!own && parts.filter((part) => isLive(part, now)).length >= BASKET_LIMITS.maxParts) throw new BasketRefusal('TOO_MANY_GUESTS');
  if (!fitsOneOrder(parts, ownerKey, input.lines, now) || input.lines.length > QR_LIMITS.maxLines) throw new BasketRefusal('TOO_MANY_LINES');

  const data = { name: input.name.trim().slice(0, BASKET_LIMITS.maxName), lines: input.lines as unknown as Prisma.InputJsonValue, updatedAt: now, sentPublicId: null, sentAt: null };
  await db.tableBasketPart.upsert({
    where: { menuId_tableNumber_ownerKey: { menuId: tenant.id, tableNumber: input.table, ownerKey } },
    create: { menuId: tenant.id, tableNumber: input.table, ownerKey, ...data },
    update: data,
  });
}

export interface SendBasketInput {
  table: number;
  token: string;
  locale: Locale;
  note: string;
  card?: { token: string; redeem: boolean };
}

/**
 * Sends every live part as one order request, through the same path as a single phone's order: the server prices it again and
 * the table's limits apply. The parts are marked sent so every phone follows the order, and a second send finds nothing.
 */
export async function sendBasket(prisma: PrismaClient, tenant: TenantInfo, catalog: Catalog, input: SendBasketInput, now: Date = new Date()): Promise<{ publicId: string }> {
  await openGate(prisma, tenant, input.table, now);
  const ownerKey = ownerKeyOf(input.token);
  const parts = await loadParts(prisma, tenant, input.table, now);
  // Only a guest of the table sends for it.
  if (!parts.some((part) => part.ownerKey === ownerKey && isLive(part, now))) throw new BasketRefusal('NOT_A_GUEST');
  const lines = mergedLines(parts, now);
  if (lines.length === 0) throw new BasketRefusal('NOTHING_TO_SEND');
  const { publicId } = await submitCustomerOrder(prisma, tenant, catalog, { table: input.table, locale: input.locale, lines, bundleCount: 0, note: input.note, ...(input.card ? { card: input.card } : {}) }, now);
  // Marked in one statement; a part changed after it was read (its owner added a dish this instant) keeps its newer lines.
  const live = parts.filter((part) => isLive(part, now));
  const db = menuDb(prisma, tenant.id);
  for (const part of live) {
    await db.tableBasketPart.updateMany({ where: { tableNumber: input.table, ownerKey: part.ownerKey, updatedAt: part.updatedAt }, data: { sentPublicId: publicId, sentAt: now } });
  }
  return { publicId };
}

export { QrGateClosed, QrOrderRefusal };
