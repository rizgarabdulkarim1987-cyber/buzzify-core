import type { PrismaClient } from '@/generated/prisma/client';
import type { TenantInfo } from '@/server/data/tenant';
import { scopedClient } from '@/server/data/tenant-db';
import { COMPLAINT_CATEGORIES, COMPLAINT_LIMITS } from '@/server/domain/pos/complaint-rules';
import { LOCKED_STATUSES } from '@/server/domain/pos/order-state';
import { posGate } from './actor';
import { isUniqueViolation } from './errors';

/**
 * The guest's side of the complaints box. It is reached without a sign-in from the Menu's own host, so it trusts nothing the
 * guest sends but the text: the table is resolved by number against the till, the live order (if the table has one) is found
 * here, and only those references are stored. The contact is kept on the complaint alone, never in the audit row.
 */

/** The box is closed: complaints are off, the subscription lapsed, the menu is not the till's, or there is no such table. */
export class ComplaintGateClosed extends Error {
  constructor() {
    super('Complaints are not available');
  }
}

export class ComplaintTooMany extends Error {
  constructor() {
    super('Too many complaints');
  }
}

export type ComplaintGate = { open: true; restaurantId: string; tableId: string } | { open: false };

const CLOSED: ComplaintGate = { open: false };

/** Whether this menu is the till's and the table is one of its tables, so a message can be linked to it. The subscription is read first. */
export async function complaintGate(prisma: PrismaClient, tenant: Pick<TenantInfo, 'id' | 'restaurantId'>, tableNumber: number, now: Date = new Date()): Promise<ComplaintGate> {
  if (!Number.isInteger(tableNumber) || tableNumber < 1) return CLOSED;
  const gate = await posGate(prisma, tenant.restaurantId, now);
  if (!gate.open) return CLOSED;
  const till = scopedClient(prisma, { restaurantId: tenant.restaurantId });
  const settings = await till.posSettings.findFirst({ where: { restaurantId: tenant.restaurantId }, select: { catalogMenuId: true } });
  // The till's own switch no longer decides: the menu's box is open to every guest, and this only finds the table to link.
  if (!settings || settings.catalogMenuId !== tenant.id) return CLOSED;
  const table = await till.posTable.findFirst({ where: { restaurantId: tenant.restaurantId, number: tableNumber }, select: { id: true } });
  return table ? { open: true, restaurantId: tenant.restaurantId, tableId: table.id } : CLOSED;
}

export type FeedbackGate = { open: true; restaurantId: string; tableId: string | null } | { open: false };

/**
 * Whether guests of this menu may leave a message, and which table it belongs to. The box belongs to the menu, not the till:
 * it is open unless the menu switched it off (read live, so the switch is immediate). A table number the till knows links the
 * message to that table; any other number, or none, stores it without one.
 */
export async function feedbackGate(prisma: PrismaClient, tenant: Pick<TenantInfo, 'id' | 'restaurantId'>, tableNumber: number | null, now: Date = new Date()): Promise<FeedbackGate> {
  const menu = await prisma.menu.findUnique({ where: { id: tenant.id }, select: { feedbackEnabled: true } });
  if (!menu?.feedbackEnabled) return { open: false };
  if (tableNumber === null) return { open: true, restaurantId: tenant.restaurantId, tableId: null };
  const table = await complaintGate(prisma, tenant, tableNumber, now);
  return { open: true, restaurantId: tenant.restaurantId, tableId: table.open ? table.tableId : null };
}

export interface GuestComplaint {
  table: number | null;
  locale: string;
  clientKey: string;
  body: string;
  category?: (typeof COMPLAINT_CATEGORIES)[number];
  contactName?: string;
  contactPhone?: string;
}

/**
 * Stores a complaint. The same client key twice is one complaint (the second call answers as accepted). The limits are counted
 * in the database under a lock on the table, so a flood cannot slip past. Returns whether a row was written.
 */
export async function submitComplaint(prisma: PrismaClient, tenant: Pick<TenantInfo, 'id' | 'restaurantId'>, input: GuestComplaint, now: Date = new Date()): Promise<{ stored: boolean }> {
  const gate = await feedbackGate(prisma, tenant, input.table, now);
  if (!gate.open) throw new ComplaintGateClosed();
  // A table number that the till does not know is not stored: the message is kept without a table.
  const tableNumber = gate.tableId === null ? null : input.table;
  const till = scopedClient(prisma, { restaurantId: gate.restaurantId });
  if (await till.posComplaint.findFirst({ where: { restaurantId: gate.restaurantId, clientKey: input.clientKey }, select: { id: true } })) return { stored: false };
  try {
    return await till.$transaction(async (tx) => {
      await tx.posSettings.updateMany({ where: { restaurantId: gate.restaurantId }, data: { restaurantId: gate.restaurantId } });
      const tableId = gate.tableId;
      if (tableId === null) {
        // No table to lock on: the restaurant's settings row (when it has a till) or nothing; the hourly limit is the guard.
        await tx.posSettings.updateMany({ where: { restaurantId: gate.restaurantId }, data: { restaurantId: gate.restaurantId } });
      } else {
        const locked = await tx.posTable.updateMany({ where: { id: tableId, restaurantId: gate.restaurantId }, data: { number: input.table ?? undefined } });
        if (locked.count === 0) throw new ComplaintGateClosed();
      }
      const [recentTable, dayTable, recentRestaurant] = await Promise.all([
        tableId === null ? 0 : tx.posComplaint.count({ where: { restaurantId: gate.restaurantId, tableId, createdAt: { gt: new Date(now.getTime() - 10 * 60_000) } } }),
        tableId === null ? 0 : tx.posComplaint.count({ where: { restaurantId: gate.restaurantId, tableId, createdAt: { gt: new Date(now.getTime() - 24 * 3_600_000) } } }),
        tx.posComplaint.count({ where: { restaurantId: gate.restaurantId, createdAt: { gt: new Date(now.getTime() - 3_600_000) } } }),
      ]);
      if (recentTable >= COMPLAINT_LIMITS.perTablePer10Minutes || dayTable >= COMPLAINT_LIMITS.perTablePerDay || recentRestaurant >= COMPLAINT_LIMITS.perRestaurantPerHour) throw new ComplaintTooMany();
      // The live order of the table, only when there is one: guessing the previous party's order could blame the wrong people.
      const order =
        tableId === null
          ? null
          : await tx.posOrder.findFirst({
              where: { restaurantId: gate.restaurantId, tableId, status: { notIn: [...LOCKED_STATUSES] } },
              select: { id: true, number: true },
            });
      const hasContact = Boolean(input.contactName || input.contactPhone);
      const complaint = await tx.posComplaint.create({
        data: {
          restaurantId: gate.restaurantId,
          clientKey: input.clientKey,
          category: input.category ?? null,
          body: input.body,
          tableId,
          tableNumber,
          orderId: order?.id ?? null,
          orderNumber: order?.number ?? null,
          contactName: input.contactName ?? null,
          contactPhone: input.contactPhone ?? null,
          contactConsentAt: hasContact ? now : null,
          locale: input.locale,
          createdAt: now,
        },
        select: { id: true },
      });
      // No body text, no name and no phone in the audit row: only what a manager needs to count and trace it.
      await tx.auditLog.create({
        data: {
          actorId: null,
          restaurantId: gate.restaurantId,
          menuId: tenant.id,
          action: 'pos.complaint.submit',
          entityType: 'PosComplaint',
          entityId: complaint.id,
          changes: { length: { before: null, after: [...input.body].length }, hasContact: { before: null, after: hasContact }, linkedOrder: { before: null, after: order !== null } },
        },
      });
      return { stored: true };
    });
  } catch (error) {
    // The same key sent twice at once: the loser reads the winner's row.
    if (isUniqueViolation(error)) return { stored: false };
    throw error;
  }
}
