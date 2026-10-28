import { z } from 'zod';
import type { ScopedTx } from '@/server/data/tenant-db';
import { canPh } from '@/server/domain/pharmacy/permissions';
import { MAX_AMOUNT_MINOR, shiftVariance } from '@/server/domain/pharmacy/sale';
import { StudioError } from '@/server/studio/framework/result';
import type { PhActor } from './actor';
import { cashTotals } from './shifts-reads';

/**
 * Shifts and cash (phase 3, R3-8). One OPEN shift per user and branch (a partial unique index backs the check). The
 * shift's currency is fixed when it opens. Cash is recorded as signed movements; the expected cash at close is the
 * opening float plus the movements (`cashTotals`).
 *
 * Locks, in the one order every writer uses: the key (a repeat of one key waits for the first), then the shift row. A
 * close takes the shift row `FOR UPDATE` BEFORE it reads the movements, so a sale either committed before (and is
 * counted) or finds the shift closed (NO_OPEN_SHIFT). The migration's trigger on PhSale, PhCashMovement and PhReturn is
 * the backstop: nothing can be posted into a shift that is not OPEN, whatever code tries.
 *
 * Approval (a ruling, task 4): a variance above `PhSettings.shiftVarianceLimitMinor` (when it is above 0) can only be
 * closed by a person who holds `report.view` (the owner, a manager, the pharmacist in charge, an accountant). That
 * person is the signed-in actor, so `approvedById` is authenticated; nobody is named by id. `closedById` is the actor of every close (the owner of the shift or somebody closing it for them); `approvedById` stays for the over-limit approval only. A cashier meets
 * NEEDS_APPROVAL and asks a manager to close the shift.
 */

const REASON_MIN = 3;
const REASON_MAX = 200;
const TOO_LONG = 'Use at most 200 characters';
const SHORT_REASON = 'Enter a reason of at least 3 characters';

// Input ---------------------------------------------------------------------------------------------------------------

const money = z.coerce.bigint('Enter an amount').min(0n, 'Use 0 or more').max(MAX_AMOUNT_MINOR, 'Enter a smaller amount');
const clientKeyText = z.string().trim().min(8, 'Use at least 8 characters').max(100, 'Use at most 100 characters');
const reasonText = z.string().trim().max(REASON_MAX, TOO_LONG);

export const openInput = z.object({
  currency: z.enum(['IQD', 'USD'], 'Choose IQD or USD'),
  openingFloatMinor: money.default(0n),
  clientKey: clientKeyText,
});
export type OpenInput = z.infer<typeof openInput>;

export const cashMoveInput = z.object({
  amountMinor: money.min(1n, 'Enter an amount'),
  reason: reasonText.min(REASON_MIN, SHORT_REASON),
  clientKey: clientKeyText,
});
export type CashMoveInput = z.infer<typeof cashMoveInput>;

export const closeInput = z.object({
  shiftId: z.string().min(1).max(64),
  countedMinor: money,
  reason: reasonText.optional(),
});
export type CloseInput = z.infer<typeof closeInput>;

// Refusals ------------------------------------------------------------------------------------------------------------

const conflict = (phCode: string, message: string, extra: Record<string, string> = {}) => new StudioError('CONFLICT', message, { phCode, ...extra });
const invalid = (field: string, message: string, phCode?: string) => new StudioError('INVALID', message, { [field]: message, ...(phCode ? { phCode } : {}) });

function who(ph: PhActor): string {
  if (ph.role === null || ph.support !== null) throw new StudioError('FORBIDDEN');
  return ph.userId;
}

/** Waits for any other transaction working on the same key, so a repeat finds the first one's result. */
async function lockKey(tx: ScopedTx, restaurantId: string, clientKey: string): Promise<void> {
  // eslint-disable-next-line no-restricted-properties -- an advisory lock touches no tenant rows: it only serialises one cash key
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`ph-cash-key:${restaurantId}:${clientKey}`}))`;
}

interface LockedShift {
  status: 'OPEN' | 'CLOSED';
  openingFloatMinor: bigint;
  currency: 'IQD' | 'USD';
}

/** Takes the shift row `FOR UPDATE`; waits for sales that already posted into it and keeps new ones out until we commit. */
async function lockShift(tx: ScopedTx, restaurantId: string, branchId: string, shiftId: string): Promise<LockedShift> {
  // eslint-disable-next-line no-restricted-properties -- a row lock on one shift; the filter names the actor's business and branch
  const [row] = await tx.$queryRaw<LockedShift[]>`
    SELECT "status", "openingFloatMinor", "currency" FROM "PhShift"
    WHERE "id" = ${shiftId} AND "restaurantId" = ${restaurantId} AND "branchId" = ${branchId} FOR UPDATE`;
  if (!row) throw new StudioError('NOT_FOUND', 'Shift not found');
  return row;
}

// Open ----------------------------------------------------------------------------------------------------------------

export interface OpenResult {
  id: string;
  branchId: string;
  currency: 'IQD' | 'USD';
  openingFloatMinor: string;
  status: 'OPEN' | 'CLOSED';
  openedAt: string;
  replayed: boolean;
}

export interface OpenAudit {
  branchId: string;
  currency: 'IQD' | 'USD';
  openingFloatMinor: string;
}

/**
 * Opens the person's shift in `branchId`. A repeat is recognised by the FLOAT_OPEN movement that carries the key (so
 * only a shift opened with a float can be replayed: with a zero float a repeat meets SHIFT_ALREADY_OPEN, which names the
 * open shift, and the screen continues with it).
 */
export async function openShift(
  tx: ScopedTx,
  args: { ph: PhActor; branchId: string; input: OpenInput; now?: Date },
): Promise<{ result: OpenResult; audit: OpenAudit | null }> {
  const { ph, branchId, input } = args;
  const now = args.now ?? new Date();
  const userId = who(ph);
  const restaurantId = ph.restaurantId;

  await lockKey(tx, restaurantId, input.clientKey);
  // eslint-disable-next-line no-restricted-properties -- an advisory lock touches no tenant rows: it only serialises one person's opens in one branch
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`ph-shift-open:${restaurantId}:${branchId}:${userId}`}))`;

  const earlier = await tx.phCashMovement.findFirst({ where: { clientKey: input.clientKey }, select: { type: true, userId: true, shiftId: true } });
  if (earlier) {
    const shift = await tx.phShift.findFirst({ where: { id: earlier.shiftId }, select: { id: true, branchId: true, currency: true, openingFloatMinor: true, status: true, openedAt: true } });
    const same =
      shift && earlier.type === 'FLOAT_OPEN' && earlier.userId === userId && shift.branchId === branchId && shift.currency === input.currency && shift.openingFloatMinor === input.openingFloatMinor;
    if (!same) throw conflict('CLIENT_KEY_MISMATCH', 'This key was already used for a different change');
    return {
      result: { id: shift.id, branchId, currency: shift.currency, openingFloatMinor: String(shift.openingFloatMinor), status: shift.status, openedAt: shift.openedAt.toISOString(), replayed: true },
      audit: null,
    };
  }

  const open = await tx.phShift.findFirst({ where: { branchId, userId, status: 'OPEN' }, select: { id: true } });
  if (open) throw conflict('SHIFT_ALREADY_OPEN', 'You already have an open shift here', { shiftId: open.id });

  const shift = await tx.phShift.create({
    data: { restaurantId, branchId, userId, currency: input.currency, openingFloatMinor: input.openingFloatMinor, openedAt: now },
    select: { id: true },
  });
  if (input.openingFloatMinor > 0n) {
    await tx.phCashMovement.create({
      data: { restaurantId, shiftId: shift.id, type: 'FLOAT_OPEN', amountMinor: input.openingFloatMinor, currency: input.currency, clientKey: input.clientKey, userId, createdAt: now },
    });
  }
  return {
    result: { id: shift.id, branchId, currency: input.currency, openingFloatMinor: String(input.openingFloatMinor), status: 'OPEN', openedAt: now.toISOString(), replayed: false },
    audit: { branchId, currency: input.currency, openingFloatMinor: String(input.openingFloatMinor) },
  };
}

// Paid in and paid out ------------------------------------------------------------------------------------------------

export interface CashMoveResult {
  id: string;
  shiftId: string;
  type: 'PAID_IN' | 'PAID_OUT';
  amountMinor: string;
  currency: 'IQD' | 'USD';
  reason: string;
  /** The drawer's expected cash after this movement. */
  expectedMinor: string;
  replayed: boolean;
}

export interface CashMoveAudit {
  shiftId: string;
  branchId: string;
  amountMinor: string;
  currency: 'IQD' | 'USD';
  reason: string;
}

/**
 * Money put into (PAID_IN) or taken out of (PAID_OUT) the person's own open shift. Idempotent by key: the same request
 * returns the stored movement (even after the shift closed), another is CLIENT_KEY_MISMATCH. A paid out may not take more
 * than the cash expected in the drawer (INSUFFICIENT_CASH), judged under the shift's row lock.
 */
export async function moveCash(
  tx: ScopedTx,
  args: { ph: PhActor; branchId: string; type: 'PAID_IN' | 'PAID_OUT'; input: CashMoveInput; now?: Date },
): Promise<{ result: CashMoveResult; audit: CashMoveAudit | null }> {
  const { ph, branchId, type, input } = args;
  const now = args.now ?? new Date();
  const userId = who(ph);
  const restaurantId = ph.restaurantId;
  const signed = type === 'PAID_IN' ? input.amountMinor : -input.amountMinor;

  await lockKey(tx, restaurantId, input.clientKey);
  const earlier = await tx.phCashMovement.findFirst({
    where: { clientKey: input.clientKey },
    select: { id: true, type: true, amountMinor: true, currency: true, reason: true, userId: true, shiftId: true },
  });
  if (earlier) {
    const shift = await tx.phShift.findFirst({ where: { id: earlier.shiftId }, select: { branchId: true, openingFloatMinor: true } });
    if (!shift || shift.branchId !== branchId || earlier.type !== type || earlier.amountMinor !== signed || earlier.reason !== input.reason || earlier.userId !== userId) {
      throw conflict('CLIENT_KEY_MISMATCH', 'This key was already used for a different change');
    }
    const totals = await cashTotals(tx, earlier.shiftId, shift.openingFloatMinor);
    return {
      result: { id: earlier.id, shiftId: earlier.shiftId, type, amountMinor: String(input.amountMinor), currency: earlier.currency, reason: earlier.reason, expectedMinor: String(totals.expected), replayed: true },
      audit: null,
    };
  }

  const mine = await tx.phShift.findFirst({ where: { branchId, userId, status: 'OPEN' }, select: { id: true } });
  if (!mine) throw conflict('NO_OPEN_SHIFT', 'You have no open shift here');
  const locked = await lockShift(tx, restaurantId, branchId, mine.id);
  if (locked.status !== 'OPEN') throw conflict('NO_OPEN_SHIFT', 'You have no open shift here');

  if (type === 'PAID_OUT') {
    const before = await cashTotals(tx, mine.id, locked.openingFloatMinor);
    if (input.amountMinor > before.expected) {
      throw conflict('INSUFFICIENT_CASH', 'There is not enough cash in the drawer', { available: String(before.expected), requested: String(input.amountMinor) });
    }
  }
  const made = await tx.phCashMovement.create({
    data: { restaurantId, shiftId: mine.id, type, amountMinor: signed, currency: locked.currency, reason: input.reason, clientKey: input.clientKey, userId, createdAt: now },
    select: { id: true },
  });
  const after = await cashTotals(tx, mine.id, locked.openingFloatMinor);
  return {
    result: { id: made.id, shiftId: mine.id, type, amountMinor: String(input.amountMinor), currency: locked.currency, reason: input.reason, expectedMinor: String(after.expected), replayed: false },
    audit: { shiftId: mine.id, branchId, amountMinor: String(input.amountMinor), currency: locked.currency, reason: input.reason },
  };
}

// Close ---------------------------------------------------------------------------------------------------------------

export interface CloseResult {
  id: string;
  status: 'CLOSED';
  expectedMinor: string;
  countedMinor: string;
  varianceMinor: string;
  approvedById: string | null;
  closedById: string;
  closedAt: string;
}

export interface CloseAudit {
  branchId: string;
  currency: 'IQD' | 'USD';
  ownerUserId: string;
  closedForOther: boolean;
  expectedMinor: string;
  countedMinor: string;
  varianceMinor: string;
  reason: string;
  approvedById: string | null;
  closedById: string;
}

/**
 * Closes a shift: expected cash from the movements (under the shift's row lock), variance = counted - expected. A
 * difference needs a reason; one above the limit (when set) can only be closed by a `report.view` holder, who is recorded. The owner of the shift closes it; someone
 * else needs `report.view` and a reason. Closing a closed shift is CONFLICT ALREADY_CLOSED.
 */
export async function closeShift(
  tx: ScopedTx,
  args: { ph: PhActor; input: CloseInput; branchId?: string; now?: Date },
): Promise<{ result: CloseResult; audit: CloseAudit }> {
  const { ph, input } = args;
  const now = args.now ?? new Date();
  const userId = who(ph);
  const role = ph.role!;

  // Visibility first (the client confines it to the actor's branches), then the permission for this shift.
  const shift = await tx.phShift.findFirst({
    where: { id: input.shiftId, ...(args.branchId ? { branchId: args.branchId } : {}) },
    select: { id: true, branchId: true, userId: true },
  });
  if (!shift) throw new StudioError('NOT_FOUND', 'Shift not found');
  const own = shift.userId === userId;
  if (own ? !canPh(role, 'shift.use') : !canPh(role, 'report.view')) throw new StudioError('FORBIDDEN');

  const locked = await lockShift(tx, ph.restaurantId, shift.branchId, shift.id);
  if (locked.status !== 'OPEN') throw conflict('ALREADY_CLOSED', 'This shift is already closed');

  const totals = await cashTotals(tx, shift.id, locked.openingFloatMinor);
  const variance = shiftVariance(input.countedMinor, totals.expected);

  const reason = (input.reason ?? '').trim();
  if ((reason !== '' || !own || variance !== 0n) && reason.length < REASON_MIN) throw invalid('reason', SHORT_REASON);

  const settings = await tx.phSettings.findFirst({ select: { shiftVarianceLimitMinor: true } });
  const limit = settings?.shiftVarianceLimitMinor ?? 0n;
  const magnitude = variance < 0n ? -variance : variance;
  const overLimit = limit > 0n && magnitude > limit;
  if (overLimit && !canPh(role, 'report.view')) throw conflict('NEEDS_APPROVAL', 'Ask a manager to close this shift', { limit: String(limit) });
  const approverId = overLimit ? userId : null;

  const done = await tx.phShift.updateMany({
    where: { id: shift.id, status: 'OPEN' },
    data: { status: 'CLOSED', closedAt: now, expectedMinor: totals.expected, countedMinor: input.countedMinor, varianceMinor: variance, closeReason: reason, approvedById: approverId, closedById: userId },
  });
  if (done.count !== 1) throw conflict('ALREADY_CLOSED', 'This shift is already closed');
  return {
    result: {
      id: shift.id,
      status: 'CLOSED',
      expectedMinor: String(totals.expected),
      countedMinor: String(input.countedMinor),
      varianceMinor: String(variance),
      approvedById: approverId,
      closedById: userId,
      closedAt: now.toISOString(),
    },
    audit: {
      branchId: shift.branchId,
      currency: locked.currency,
      ownerUserId: shift.userId,
      closedForOther: !own,
      expectedMinor: String(totals.expected),
      countedMinor: String(input.countedMinor),
      varianceMinor: String(variance),
      reason,
      approvedById: approverId,
      closedById: userId,
    },
  };
}
