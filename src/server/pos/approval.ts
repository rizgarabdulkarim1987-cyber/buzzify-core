import { z } from 'zod';
import type { PrismaClient } from '@/generated/prisma/client';
import type { Approver, DiscountReason } from '@/lib/pos-approval';
import type { PosRole } from '@/server/domain/pos/permissions';
import type { RequestMeta } from '@/server/studio/framework/action';
import { idField } from '@/server/studio/services/content';
import { refuse } from './errors';
import { PinLockedError, PinRefusedError, verifyApproverPin } from './pin';

// Why a discount was given: a short list, with a note for the last one (shared with the screens).
export { DISCOUNT_REASONS, type DiscountReason } from '@/lib/pos-approval';

/** The manager who approves at the till: who they are and their own PIN. Optional on every action that may need it. */
export const approvalField = z.object({ staffId: idField, pin: z.string().regex(/^\d{4,8}$/) }).optional();
export type Approval = z.infer<typeof approvalField>;

/** What is stored next to a discount. */
export interface DiscountWhy {
  reason: DiscountReason;
  note: string | null;
  approvedByStaffId: string | null;
}

/**
 * The managers and owners who can approve at this till, for the screen to offer; null when the person needs no approval (not
 * a cashier, or the restaurant switched it off). Only active staff who set a PIN are listed.
 */
export async function approversFor(db: PrismaClient, restaurantId: string, role: PosRole): Promise<Approver[] | null> {
  if (role !== 'CASHIER') return null;
  const settings = await db.posSettings.findUnique({ where: { restaurantId }, select: { requireApproval: true } });
  if (settings && !settings.requireApproval) return null;
  const rows = await db.posStaff.findMany({
    where: { restaurantId, deactivatedAt: null, role: { in: ['OWNER', 'MANAGER'] }, pinHash: { not: null }, user: { deactivatedAt: null } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { id: true, user: { select: { name: true } } },
  });
  return rows.map((row) => ({ staffId: row.id, name: row.user.name }));
}

/**
 * A cashier's discount, cancel of something already made, or cancel of an order with items needs a manager or owner to type
 * their PIN, unless the restaurant switched that off in its settings. A manager or owner never needs a second person.
 * Returns the approving staff id (null when none was needed). Called by the server action, so the rule holds whatever the
 * screen does.
 */
export async function requireApprovalIn(args: {
  db: PrismaClient;
  restaurantId: string;
  role: PosRole;
  /** The signed-in person asking, so a wrong try is filed under their name. */
  userId: string;
  needed: boolean;
  approval: Approval;
  meta: RequestMeta;
}): Promise<string | null> {
  if (!args.needed || args.role !== 'CASHIER') return null;
  const settings = await args.db.posSettings.findUnique({ where: { restaurantId: args.restaurantId }, select: { requireApproval: true } });
  if (settings && !settings.requireApproval) return null;
  if (!args.approval) throw refuse('FORBIDDEN', 'Manager approval is needed');
  try {
    const done = await verifyApproverPin(args.db, { restaurantId: args.restaurantId, staffId: args.approval.staffId, pin: args.approval.pin, meta: args.meta, requestedByUserId: args.userId });
    return done.staffId;
  } catch (error) {
    if (error instanceof PinLockedError) throw refuse('FORBIDDEN', 'This manager is locked for a while');
    if (error instanceof PinRefusedError) throw refuse('FORBIDDEN', 'The approval PIN is wrong');
    throw error;
  }
}
