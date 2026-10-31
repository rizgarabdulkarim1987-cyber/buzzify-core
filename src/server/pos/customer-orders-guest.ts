import { canRedeem, cardKeyOf } from '@/server/domain/pos/loyalty-rules';
import { randomBytes } from 'node:crypto';
import type { PrismaClient } from '@/generated/prisma/client';
import type { Locale } from '@/lib/locale';
import type { TenantInfo } from '@/server/data/tenant';
import { menuDb, scopedClient } from '@/server/data/tenant-db';
import { expiryCutoff, isExpired, QR_LIMITS } from '@/server/domain/pos/customer-order-rules';
import type { CartLineInput, Catalog } from '@/server/domain/types';
import { posGate } from './actor';
import { awaitingCaptain, priceRequestLines } from './customer-orders';
import { optionsSnapshotSchema } from './orders';

/**
 * The guest's side of a QR order. Everything here is reached without a sign-in, from the Menu's table page, so it trusts
 * nothing the guest sends but ids, quantities and notes: every price and name comes from the Menu's published catalog.
 */

/** The guest path is closed: QR ordering is off, the subscription lapsed, the menu is not the till's, or there is no such table. */
export class QrGateClosed extends Error {
  constructor() {
    super('QR ordering is not available');
  }
}

/** A refusal the guest can be told about. */
export class QrOrderRefusal extends Error {
  constructor(readonly code: 'INVALID_CART' | 'BUNDLES_UNSUPPORTED' | 'TOO_MANY_REQUESTS') {
    super(code);
  }
}

export type QrGate = { open: true; restaurantId: string; tableId: string } | { open: false };

const CLOSED: QrGate = { open: false };

/**
 * Whether guests of this menu may order from this table. The subscription is read first, and a till table only when it is
 * live, so a restaurant with a menu and no cashier issues no till query.
 */
export async function qrOrderGate(prisma: PrismaClient, tenant: Pick<TenantInfo, 'id' | 'restaurantId'>, tableNumber: number, now: Date = new Date()): Promise<QrGate> {
  if (!Number.isInteger(tableNumber) || tableNumber < 1) return CLOSED;
  const gate = await posGate(prisma, tenant.restaurantId, now);
  if (!gate.open) return CLOSED;
  const till = scopedClient(prisma, { restaurantId: tenant.restaurantId });
  const settings = await till.posSettings.findFirst({ where: { restaurantId: tenant.restaurantId }, select: { qrOrderingEnabled: true, catalogMenuId: true } });
  if (!settings?.qrOrderingEnabled || settings.catalogMenuId !== tenant.id) return CLOSED;
  const table = await till.posTable.findFirst({ where: { restaurantId: tenant.restaurantId, number: tableNumber }, select: { id: true } });
  return table ? { open: true, restaurantId: tenant.restaurantId, tableId: table.id } : CLOSED;
}

export interface GuestOrderInput {
  table: number;
  locale: Locale;
  lines: (CartLineInput & { note: string })[];
  bundleCount: number;
  note: string;
  /** The guest's stamp card, when the phone sent one: counted only while the restaurant runs the program and the plan has it. */
  card?: { token: string; redeem: boolean };
}

/**
 * Stores a guest's order as a request waiting for the cashier. The cart is priced again here from the published catalog;
 * the table's limits are counted in the database. Returns the request's public id, which is how the guest reads its state.
 */
export async function submitCustomerOrder(
  prisma: PrismaClient,
  tenant: TenantInfo,
  catalog: Catalog,
  input: GuestOrderInput,
  now: Date = new Date(),
): Promise<{ publicId: string }> {
  const gate = await qrOrderGate(prisma, tenant, input.table, now);
  if (!gate.open) throw new QrGateClosed();
  if (input.bundleCount > 0) throw new QrOrderRefusal('BUNDLES_UNSUPPORTED');
  if (input.lines.length === 0 || input.lines.length > QR_LIMITS.maxLines) throw new QrOrderRefusal('INVALID_CART');

  const lines = priceRequestLines(catalog, input.lines, now);
  if (!lines) throw new QrOrderRefusal('INVALID_CART');
  const till = scopedClient(prisma, { restaurantId: gate.restaurantId });
  const productIds = [...new Set(lines.flatMap((line) => (line.productId ? [line.productId] : [])))];
  const [soldOut, existing] = await Promise.all([
    till.posProductSetting.count({ where: { restaurantId: gate.restaurantId, productId: { in: productIds }, soldOutOverride: true } }),
    menuDb(prisma, tenant.id).product.findMany({ where: { id: { in: productIds } }, select: { id: true } }),
  ]);
  if (soldOut > 0) throw new QrOrderRefusal('INVALID_CART');
  const known = new Set(existing.map((product) => product.id));

  return till.$transaction(async (tx) => {
    // Locks the restaurant's settings row, then the table's row (always in this order): two submissions count the hourly cap
    // and the table's limits one after the other.
    await tx.posSettings.updateMany({ where: { restaurantId: gate.restaurantId }, data: { restaurantId: gate.restaurantId } });
    // Read under that lock: the request keeps the captain step it was sent with, whatever the switch does later.
    const settings = await tx.posSettings.findFirst({ where: { restaurantId: gate.restaurantId }, select: { captainApproval: true, loyaltyEnabled: true, loyaltyStampsRequired: true } });
    const cardKey = input.card && settings?.loyaltyEnabled && tenant.features.stampCard ? cardKeyOf(input.card.token) : null;
    // The reward is asked for only by a card that holds the stamps for it now.
    const redeemReward = cardKey !== null && input.card?.redeem === true && canRedeem((await tx.posLoyaltyCard.findFirst({ where: { restaurantId: gate.restaurantId, cardKey }, select: { stamps: true } }))?.stamps ?? 0, settings?.loyaltyStampsRequired ?? 0);
    const locked = await tx.posTable.updateMany({ where: { id: gate.tableId, restaurantId: gate.restaurantId }, data: { number: input.table } });
    // The table was removed between the gate and here.
    if (locked.count === 0) throw new QrGateClosed();
    const [pending, recentTable, recentRestaurant] = await Promise.all([
      tx.posCustomerOrder.count({ where: { restaurantId: gate.restaurantId, tableId: gate.tableId, status: 'PENDING', createdAt: { gt: expiryCutoff(now) } } }),
      tx.posCustomerOrder.count({ where: { restaurantId: gate.restaurantId, tableId: gate.tableId, createdAt: { gt: new Date(now.getTime() - 10 * 60_000) } } }),
      tx.posCustomerOrder.count({ where: { restaurantId: gate.restaurantId, createdAt: { gt: new Date(now.getTime() - 60 * 60_000) } } }),
    ]);
    if (pending >= QR_LIMITS.pendingPerTable || recentTable >= QR_LIMITS.perTablePer10Min || recentRestaurant >= QR_LIMITS.perRestaurantPerHour) {
      throw new QrOrderRefusal('TOO_MANY_REQUESTS');
    }
    const request = await tx.posCustomerOrder.create({
      data: {
        restaurantId: gate.restaurantId,
        tableId: gate.tableId,
        // Unguessable: the guest's own id is the only thing that lets a status be read.
        publicId: randomBytes(16).toString('base64url'),
        tableNumber: input.table,
        locale: input.locale,
        customerNote: input.note,
        requiresCaptain: settings?.captainApproval ?? false,
        cardKey,
        redeemReward,
        createdAt: now,
        lines: {
          create: lines.map((line) => ({
            restaurantId: gate.restaurantId,
            productId: line.productId && known.has(line.productId) ? line.productId : null,
            nameSnapshot: line.nameSnapshot,
            unitPriceSnapshot: line.unitPriceSnapshot,
            optionsSnapshot: line.optionsSnapshot,
            promoDiscountPerUnit: line.promoDiscountPerUnit,
            quantity: line.quantity,
            note: line.note,
          })),
        },
      },
      select: { id: true, publicId: true },
    });
    await tx.auditLog.create({
      data: {
        actorId: null,
        restaurantId: gate.restaurantId,
        menuId: tenant.id,
        action: 'pos.request.submit',
        entityType: 'PosCustomerOrder',
        entityId: request.id,
        changes: { tableNumber: { before: null, after: input.table }, lines: { before: null, after: lines.length } },
      },
    });
    return { publicId: request.publicId };
  });
}

export type GuestRequestStatus = 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'EXPIRED';

export interface GuestRequestView {
  status: GuestRequestStatus;
  rejectReason: string;
  /** Still waiting and held for the captain's approval before the cashier can take it. */
  awaitingCaptain: boolean;
  lines: { name: string; quantity: number; options: string[]; note: string }[];
}

/** The state of the guest's own request, or null for anything else (the wrong table, another menu, a closed gate). */
export async function readGuestRequest(
  prisma: PrismaClient,
  tenant: Pick<TenantInfo, 'id' | 'restaurantId'>,
  table: number,
  publicId: string,
  now: Date = new Date(),
): Promise<GuestRequestView | null> {
  const gate = await qrOrderGate(prisma, tenant, table, now);
  if (!gate.open) return null;
  const till = scopedClient(prisma, { restaurantId: gate.restaurantId });
  const row = await till.posCustomerOrder.findFirst({
    where: { restaurantId: gate.restaurantId, tableId: gate.tableId, publicId },
    include: { lines: { orderBy: { id: 'asc' } } },
  });
  if (!row) return null;
  const status = row.status === 'PENDING' && isExpired(row.createdAt, now) ? 'EXPIRED' : row.status;
  return {
    status,
    rejectReason: row.rejectReason,
    awaitingCaptain: status === 'PENDING' && awaitingCaptain(row),
    lines: row.lines.map((line) => ({
      name: line.nameSnapshot,
      quantity: line.quantity,
      options: optionsSnapshotSchema.parse(line.optionsSnapshot).map((option) => option.name),
      note: line.note,
    })),
  };
}
