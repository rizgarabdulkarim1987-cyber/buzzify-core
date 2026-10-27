import { z } from 'zod';
import type { PrismaClient } from '@/generated/prisma/client';
import type { PosRole } from '@/server/domain/pos/permissions';
import type { RequestMeta } from '@/server/studio/framework/action';
import { idField } from '@/server/studio/services/content';
import { refuse } from './errors';
import { PinLockedError, PinRefusedError, verifyApproverPin } from './pin';

/** Why a discount was given: a short list, with a note for the last one. */
export const DISCOUNT_REASONS = ['MANAGER_DECISION', 'REGULAR_GUEST', 'COMPLAINT', 'STAFF_MEAL', 'OTHER'] as const;
export type DiscountReason = (typeof DISCOUNT_REASONS)[number];

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
 * A cashier's discount, cancel of something already made, or cancel of an order with items needs a manager or owner to type
 * their PIN, unless the restaurant switched that off in its settings. A manager or owner never needs a second person.
 * Returns the approving staff id (null when none was needed). Called by the server action, so the rule holds whatever the
 * screen does.
 */
export async function requireApprovalIn(args: {
  db: PrismaClient;
  restaurantId: string;
  role: PosRole;
  needed: boolean;
  approval: Approval;
  meta: RequestMeta;
}): Promise<string | null> {
  if (!args.needed || args.role !== 'CASHIER') return null;
  const settings = await args.db.posSettings.findUnique({ where: { restaurantId: args.restaurantId }, select: { requireApproval: true } });
  if (settings && !settings.requireApproval) return null;
  if (!args.approval) throw refuse('FORBIDDEN', 'Manager approval is needed');
  try {
    const done = await verifyApproverPin(args.db, { restaurantId: args.restaurantId, staffId: args.approval.staffId, pin: args.approval.pin, meta: args.meta });
    return done.staffId;
  } catch (error) {
    if (error instanceof PinLockedError) throw refuse('FORBIDDEN', 'This manager is locked for a while');
    if (error instanceof PinRefusedError) throw refuse('FORBIDDEN', 'The approval PIN is wrong');
    throw error;
  }
}
