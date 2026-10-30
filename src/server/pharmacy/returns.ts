import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { ScopedTx } from '@/server/data/tenant-db';
import {
  isWithinReturnWindow,
  refundForReturn,
  returnLimits,
  SaleMathError,
  saleNumber,
  saleRefundTotal,
} from '@/server/domain/pharmacy/sale';
import { splitRefund } from '@/server/domain/pharmacy/credit';
import { StudioError } from '@/server/studio/framework/result';
import type { PhActor } from './actor';
import { balanceOf, lockCustomer, refundSale } from './customers';
import { recordControlledReturn } from './prescriptions';
import { applyMovement, lockOrder } from './stock';

/**
 * Returns and cancels (phase 3, R3-9 and R3-10). One return is one transaction on the caller's `tx`; the actor IS the
 * approver (`return.approve`, checked by the action), so `approvedById` is the actor.
 *
 * Lock order: (1) the return key (advisory, two-int form), (2) the approver's open shift `FOR SHARE` (a close takes it
 * `FOR UPDATE`, so no refund is ever posted into a closed shift; the database trigger is the backstop), (3) the sale row
 * `FOR UPDATE` (two returns of one sale queue up, so the second sees the first's quantities and refunds), (3b) when the sale was
 * paid partly on credit (phase 7): the customer row `FOR UPDATE` (customers.ts; the order is shift -> sale -> customer -> stock/number, the
 * same relative order a credit sale and a customer payment use), (4) the branch's
 * return numbering (advisory, held to the end of the transaction), (5) the return rows, then the allocation counters and
 * the stock balances through `applyMovement` in batch order. The number lock is deliberately taken BEFORE the balances,
 * not last as in a sale: the return row (which carries the number) is the parent of the line rows, and nothing else takes
 * that lock, so it cannot join a cycle; the cost is that returns of one branch queue behind one another while one waits
 * for a balance a sale holds. Moving it after the movements would change where each failure surfaces for a small gain.
 * The limit on each allocation is
 * also a guarded UPDATE (`returnedBaseQty + n <= baseQty`, count must be 1) as the backstop.
 *
 * What a return does: raises `returnedBaseQty` on each sold allocation, puts the units into QUARANTINE of the SAME batch
 * and branch (movement RETURN_QUARANTINE; they become sellable only through the quarantine release, even when the batch
 * has since been recalled or blocked), refunds in the sale's currency, posts a REFUND_CASH row on the approver's shift
 * for a cash refund, and moves the sale to RETURNED_PARTIAL or RETURNED_FULL. The sale's own totals never change.
 *
 * A return of a credit sale (phase 7, R7-5): the refund first lowers what the customer still owes (`splitRefund`: at most the credit
 * of that sale not yet refunded and at most the balance), written as a REFUND ledger row and stored in `PhReturn.creditMinor`; only the
 * rest is handed back, by one of the methods the sale was paid with other than credit, and only that rest is a cash movement.
 * `refundMinor` stays the whole value returned (reports, the line shares and the "refunds add up to the total" rule read it).
 *
 * Refund: per line `refundForReturn` on the cumulative quantity, shared over the line's allocations in order; for the
 * sale `saleRefundTotal`, so the return that completes the sale refunds everything still unrefunded (the invoice rounding
 * too) and the refunds over all returns equal what was paid net of change (`totalMinor`) exactly.
 */

export const RETURN_TIMEOUT_MS = 30_000;
const MAX_LINES = 200;
/** Advisory lock namespaces of this file (first int of the two-int form). */
const NS_KEY = 7111;
const NS_NUMBER = 7112;
const WHOLE = 'Enter a whole number';
const METHODS = ['CASH', 'CARD_MANUAL', 'TRANSFER_MANUAL'] as const;
export type RefundMethod = (typeof METHODS)[number];

// Input ---------------------------------------------------------------------------------------------------------------

const reasonText = z.string().trim().min(3, 'Enter a reason of at least 3 characters').max(300, 'Use at most 300 characters');
const clientKeyText = z.string().trim().min(8, 'Use at least 8 characters').max(100, 'Use at most 100 characters');
const idText = z.string().min(1).max(64);

/** One thing to return: units of one sold allocation, or units of a sale line (taken from its allocations in order). */
export const returnLineInput = z
  .object({
    allocationId: idText.optional(),
    saleLineId: idText.optional(),
    baseQty: z.number(WHOLE).int(WHOLE).min(1, 'Use 1 or more').max(2_147_483_647, 'Enter a smaller number'),
  })
  .refine((l) => (l.allocationId === undefined) !== (l.saleLineId === undefined), { message: 'Choose a line of this sale', path: ['saleLineId'] });
export type ReturnLineInput = z.infer<typeof returnLineInput>;

const refundMethodInput = z.enum(METHODS, 'Choose how to refund').optional();

export const returnInput = z.object({
  saleId: idText,
  lines: z.array(returnLineInput).min(1, 'Add at least one line').max(MAX_LINES, 'Use at most 200 lines'),
  reason: reasonText,
  refundMethod: refundMethodInput,
  clientKey: clientKeyText,
});
export type ReturnInput = z.infer<typeof returnInput>;

export const cancelInput = z.object({
  saleId: idText,
  reason: reasonText,
  refundMethod: refundMethodInput,
  clientKey: clientKeyText,
});
export type CancelInput = z.infer<typeof cancelInput>;

// Refusals ------------------------------------------------------------------------------------------------------------

const invalid = (field: string, message: string, phCode?: string) => new StudioError('INVALID', message, { [field]: message, ...(phCode ? { phCode } : {}) });
const conflict = (phCode: string, message: string, extra: Record<string, string> = {}) => new StudioError('CONFLICT', message, { phCode, ...extra });
const limitReached = (allocationId: string, remaining: number) =>
  conflict('RETURN_LIMIT', 'You can return only what was sold and not yet returned', { allocationId, remaining: String(remaining) });

// Replay --------------------------------------------------------------------------------------------------------------

type Request = { kind: 'return'; input: ReturnInput } | { kind: 'cancel'; input: CancelInput };

/** What identifies the request, apart from who and where: a repeat of a key must be this exactly. */
export function payloadHash(request: Request): string {
  const i = request.input;
  const lines = request.kind === 'return' ? request.input.lines.map((l) => [l.allocationId ?? null, l.saleLineId ?? null, l.baseQty]) : 'ALL';
  const canonical = [request.kind, i.clientKey, i.saleId, i.reason, i.refundMethod ?? null, lines];
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

export interface ReturnResult {
  id: string;
  number: string | null;
  saleId: string;
  branchId: string;
  currency: 'IQD' | 'USD';
  refundMinor: string;
  /** The part of the refund taken off the customer's balance (0 unless the sale was on credit). */
  creditMinor: string;
  refundMethod: RefundMethod;
  saleStatus: 'HELD' | 'COMPLETED' | 'RETURNED_PARTIAL' | 'RETURNED_FULL' | 'HOLD_EXPIRED';
  lineCount: number;
  createdAt: string;
  replayed: boolean;
}

/** What the audit entry says: ids, number, quantities, amounts and the capped reason. Never a customer field or a cost. */
export interface ReturnAudit {
  kind: 'return' | 'cancel';
  number: string;
  saleId: string;
  saleNumber: string | null;
  branchId: string;
  currency: 'IQD' | 'USD';
  refundMinor: string;
  creditMinor: string;
  refundMethod: RefundMethod;
  lineCount: number;
  baseQty: number;
  reason: string;
  statusBefore: string;
  statusAfter: string;
}

/** Which method a refund takes when none is named: the one the sale was mostly paid with (cash first on a tie). */
export function defaultRefundMethod(payments: readonly { method: RefundMethod; amountMinor: bigint }[]): RefundMethod {
  const totals = new Map<RefundMethod, bigint>();
  for (const p of payments) totals.set(p.method, (totals.get(p.method) ?? 0n) + p.amountMinor);
  let best: RefundMethod = 'CASH';
  let bestAmount = -1n;
  for (const method of METHODS) {
    const amount = totals.get(method);
    if (amount !== undefined && amount > bestAmount) {
      best = method;
      bestAmount = amount;
    }
  }
  return best;
}

export const MANAGER_ROLES = ['OWNER', 'BRANCH_MANAGER'] as const;
export const mayOverrideWindow = (role: PhActor['role']): boolean => role !== null && (MANAGER_ROLES as readonly string[]).includes(role);

// The return ----------------------------------------------------------------------------------------------------------

/**
 * Returns (or cancels) in the caller's transaction. `branchId` is the validated place's, one of the actor's branches.
 * Returns the answer and, for a new return, what to audit (null for a replay).
 */
export async function createReturn(
  tx: ScopedTx,
  args: { ph: PhActor; branchId: string; request: Request; now?: Date },
): Promise<{ result: ReturnResult; audit: ReturnAudit | null }> {
  const { ph, branchId, request } = args;
  const input = request.input;
  const now = args.now ?? new Date();
  if (ph.role === null || ph.support !== null) throw new StudioError('FORBIDDEN');
  const restaurantId = ph.restaurantId;
  const hash = payloadHash(request);

  // (1) One key at a time: a repeat waits for the first and then finds it.
  // eslint-disable-next-line no-restricted-properties -- an advisory lock touches no tenant rows: it only serialises one return key
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${NS_KEY}::int, hashtext(${`${restaurantId}:${input.clientKey}`}))`;
  const earlier = await tx.phReturn.findFirst({
    where: { clientKey: input.clientKey },
    select: {
      id: true,
      number: true,
      saleId: true,
      branchId: true,
      currency: true,
      refundMinor: true,
      refundMethod: true,
      creditMinor: true,
      approvedById: true,
      payloadHash: true,
      createdAt: true,
      sale: { select: { status: true } },
      _count: { select: { lines: true } },
    },
  });
  if (earlier) {
    // A return stored without a hash (none is written without one today) replays for the same sale, branch and person only.
    if (earlier.branchId !== branchId || earlier.saleId !== input.saleId || earlier.approvedById !== ph.userId || (earlier.payloadHash !== null && earlier.payloadHash !== hash)) {
      throw conflict('CLIENT_KEY_MISMATCH', 'This key was already used for a different return');
    }
    return {
      result: {
        id: earlier.id,
        number: earlier.number,
        saleId: earlier.saleId,
        branchId: earlier.branchId,
        currency: earlier.currency,
        refundMinor: String(earlier.refundMinor),
        creditMinor: String(earlier.creditMinor),
        refundMethod: earlier.refundMethod as RefundMethod, // input never names CREDIT, so a stored return never holds it
        saleStatus: earlier.sale.status,
        lineCount: earlier._count.lines,
        createdAt: earlier.createdAt.toISOString(),
        replayed: true,
      },
      audit: null,
    };
  }

  // (2) The sale must be in this branch (a sale of another branch or business is "not found").
  const found = await tx.phSale.findFirst({ where: { id: input.saleId, branchId }, select: { id: true, currency: true } });
  if (!found) throw new StudioError('NOT_FOUND', 'Sale not found');

  // The approver's own open shift here, in the sale's currency; held open until this return commits.
  const shift = await tx.phShift.findFirst({ where: { branchId, userId: ph.userId, status: 'OPEN' }, select: { id: true, currency: true } });
  if (!shift) throw conflict('NO_OPEN_SHIFT', 'Open a shift before refunding');
  if (shift.currency !== found.currency) throw conflict('SHIFT_CURRENCY', 'Your open shift is in another currency');
  // eslint-disable-next-line no-restricted-properties -- a row lock on the approver's own shift, found above through the scoped client
  const heldShift = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "PhShift" WHERE "id" = ${shift.id} AND "status" = 'OPEN' FOR SHARE`;
  if (heldShift.length !== 1) throw conflict('NO_OPEN_SHIFT', 'Open a shift before refunding');

  // (3) The sale row: from here the sale's quantities and refunds are read as they are, until this return commits.
  // eslint-disable-next-line no-restricted-properties -- a row lock on one sale, found above through the scoped client
  await tx.$queryRaw`SELECT "id" FROM "PhSale" WHERE "id" = ${found.id} AND "restaurantId" = ${restaurantId} FOR UPDATE`;
  const sale = await tx.phSale.findFirstOrThrow({
    where: { id: found.id },
    select: {
      id: true,
      number: true,
      status: true,
      currency: true,
      totalMinor: true,
      roundingMinor: true,
      customerId: true,
      createdAt: true,
      completedAt: true,
      payments: { select: { method: true, amountMinor: true } },
      lines: {
        orderBy: { lineNo: 'asc' },
        select: { id: true, lineNo: true, productId: true, rxLevel: true, baseQty: true, totalMinor: true, allocations: { orderBy: { id: 'asc' }, select: { id: true, batchId: true, baseQty: true, returnedBaseQty: true } } },
      },
    },
  });
  if (sale.status === 'RETURNED_FULL') throw conflict('NOTHING_TO_RETURN', 'Nothing is left to return');
  if (sale.status !== 'COMPLETED' && sale.status !== 'RETURNED_PARTIAL') throw conflict('SALE_NOT_RETURNABLE', 'This sale cannot be returned');

  // The window: after it only the owner and a branch manager may return.
  const settings = await tx.phSettings.findFirst({ select: { returnWindowDays: true } });
  const days = settings?.returnWindowDays ?? 30;
  if (!isWithinReturnWindow(sale.completedAt ?? sale.createdAt, now, days) && !mayOverrideWindow(ph.role)) {
    throw new StudioError('FORBIDDEN', 'This sale is too old to return without a manager', { phCode: 'RETURN_WINDOW_PASSED' });
  }

  // What is taken from which allocation.
  const allocations = sale.lines.flatMap((line) => line.allocations.map((a) => ({ ...a, line })));
  const byId = new Map(allocations.map((a) => [a.id, a]));
  const take = new Map<string, number>();
  const remainingOf = (a: (typeof allocations)[number]) => a.baseQty - a.returnedBaseQty - (take.get(a.id) ?? 0);
  if (request.kind === 'cancel') {
    for (const a of allocations) if (a.baseQty - a.returnedBaseQty > 0) take.set(a.id, a.baseQty - a.returnedBaseQty);
    if (take.size === 0) throw conflict('NOTHING_TO_RETURN', 'Nothing is left to return');
  } else {
    // Named allocations first, so a line taken "in order" cannot starve them.
    request.input.lines.forEach((l, index) => {
      if (l.allocationId === undefined) return;
      if (!byId.has(l.allocationId)) throw invalid(`lines.${index}.allocationId`, 'Choose a line of this sale');
      take.set(l.allocationId, (take.get(l.allocationId) ?? 0) + l.baseQty);
    });
    request.input.lines.forEach((l, index) => {
      if (l.saleLineId === undefined) return;
      const line = sale.lines.find((x) => x.id === l.saleLineId);
      if (!line) throw invalid(`lines.${index}.saleLineId`, 'Choose a line of this sale');
      let wanted = l.baseQty;
      for (const a of line.allocations) {
        if (wanted === 0) break;
        const n = Math.min(wanted, Math.max(0, remainingOf({ ...a, line })));
        if (n > 0) {
          take.set(a.id, (take.get(a.id) ?? 0) + n);
          wanted -= n;
        }
      }
      if (wanted > 0) {
        const left = line.allocations.reduce((s, a) => s + Math.max(0, a.baseQty - a.returnedBaseQty - (take.get(a.id) ?? 0)), 0);
        throw limitReached(line.allocations[0]?.id ?? line.id, left);
      }
    });
    for (const [id, qty] of take) {
      const a = byId.get(id)!;
      const verdict = returnLimits({ soldBaseQty: BigInt(a.baseQty), returnedBaseQty: BigInt(a.returnedBaseQty), requestedBaseQty: BigInt(qty) });
      if (!verdict.ok) throw limitReached(id, Number(verdict.remainingBaseQty));
    }
  }

  // The method: one the sale was paid with, credit aside (a sale with no payment, a free one, takes any).
  const paid = sale.payments.filter((p) => p.method !== 'CREDIT').map((p) => ({ method: p.method as RefundMethod, amountMinor: p.amountMinor }));
  const method = input.refundMethod ?? defaultRefundMethod(paid);
  if (paid.length > 0 && !paid.some((p) => p.method === method)) throw conflict('REFUND_METHOD_NOT_PAID', 'This sale was not paid this way');

  // The refund.
  const priorLines = await tx.phReturnLine.findMany({ where: { saleLineAllocationId: { in: allocations.map((a) => a.id) } }, select: { saleLineAllocationId: true, refundMinor: true } });
  const priorByAllocation = new Map<string, bigint>();
  for (const p of priorLines) priorByAllocation.set(p.saleLineAllocationId, (priorByAllocation.get(p.saleLineAllocationId) ?? 0n) + p.refundMinor);
  const priorReturns = await tx.phReturn.findMany({ where: { saleId: sale.id }, select: { refundMinor: true } });
  const alreadyRefundedMinor = priorReturns.reduce((s, r) => s + r.refundMinor, 0n);

  const lineRefund = new Map<string, bigint>();
  let lineRefundSumMinor = 0n;
  try {
    for (const line of sale.lines) {
      let returned = BigInt(line.allocations.reduce((s, a) => s + a.returnedBaseQty, 0));
      let refunded = line.allocations.reduce((s, a) => s + (priorByAllocation.get(a.id) ?? 0n), 0n);
      for (const a of line.allocations) {
        const n = take.get(a.id);
        if (!n) continue;
        const refund = refundForReturn({ lineTotalMinor: line.totalMinor, lineBaseQty: BigInt(line.baseQty), returnBaseQty: BigInt(n), alreadyReturnedBaseQty: returned, alreadyRefundedMinor: refunded });
        lineRefund.set(a.id, refund);
        lineRefundSumMinor += refund;
        returned += BigInt(n);
        refunded += refund;
      }
    }
  } catch (error) {
    if (error instanceof SaleMathError) throw conflict('REFUND_MATH', 'Check the amounts');
    throw error;
  }
  // The stored line refunds (PhReturnLine.refundMinor) are the pure pro rata shares of the lines, so they never include the
  // invoice's final rounding difference: that is added only to the return's own total below (saleRefundTotal), on the return
  // that completes the sale. A return's refundMinor can therefore exceed the sum of its line refunds by exactly the rounding.
  const isFinalReturn = allocations.every((a) => a.returnedBaseQty + (take.get(a.id) ?? 0) === a.baseQty);
  let refundMinor: bigint;
  try {
    refundMinor = saleRefundTotal({ totalMinor: sale.totalMinor, alreadyRefundedMinor, isFinalReturn, lineRefundSumMinor, roundingMinor: sale.roundingMinor });
  } catch (error) {
    if (error instanceof SaleMathError) throw conflict('REFUND_MATH', 'Check the amounts');
    throw error;
  }

  // A credit sale (3b): the customer is locked and the refund first lowers what they still owe of THIS sale.
  let creditMinor = 0n;
  if (sale.customerId !== null) {
    await lockCustomer(tx, restaurantId, sale.customerId);
    const rows = await tx.phCustomerLedger.findMany({ where: { saleId: sale.id, customerId: sale.customerId }, select: { amountMinor: true } });
    // The CHARGE is positive, every REFUND negative: what is left of the sale's credit is their sum.
    const creditLeft = rows.reduce((sum, r) => sum + r.amountMinor, 0n);
    creditMinor = splitRefund({ refundMinor, saleCreditLeftMinor: creditLeft > 0n ? creditLeft : 0n, balanceMinor: await balanceOf(tx, sale.customerId) }).creditMinor;
  }
  const handedBackMinor = refundMinor - creditMinor;

  // (5) The branch's numbering, then the rows.
  // eslint-disable-next-line no-restricted-properties -- an advisory lock touches no tenant rows: it only serialises one branch's return numbers
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${NS_NUMBER}::int, hashtext(${branchId}))`;
  const day = now.toISOString().slice(0, 10).replaceAll('-', '');
  const issued = await tx.phReturn.count({ where: { branchId, number: { startsWith: `R${day}-` } } });
  const number = `R${saleNumber(now.toISOString(), issued + 1)}`;
  const made = await tx.phReturn.create({
    data: {
      restaurantId,
      branchId,
      saleId: sale.id,
      shiftId: shift.id,
      number,
      reason: input.reason,
      approvedById: ph.userId,
      refundMethod: method,
      refundMinor,
      creditMinor,
      currency: sale.currency,
      clientKey: input.clientKey,
      payloadHash: hash,
      createdAt: now,
    },
    select: { id: true },
  });

  const taken = [...take.entries()].map(([allocationId, baseQty]) => ({ allocationId, baseQty, lineId: randomUUID(), allocation: byId.get(allocationId)! }));
  await tx.phReturnLine.createMany({
    data: taken.map((t) => ({ id: t.lineId, restaurantId, returnId: made.id, saleLineAllocationId: t.allocationId, baseQty: t.baseQty, refundMinor: lineRefund.get(t.allocationId) ?? 0n })),
  });

  // The limit again, in the statement itself: it either raises the count within what was sold or changes nothing.
  for (const t of [...taken].sort((a, b) => (a.allocationId < b.allocationId ? -1 : 1))) {
    // eslint-disable-next-line no-restricted-properties -- a guarded counter on one allocation of this business's sale, listed by id
    const updated = await tx.$executeRaw`UPDATE "PhSaleLineAllocation" SET "returnedBaseQty" = "returnedBaseQty" + ${t.baseQty} WHERE "id" = ${t.allocationId} AND "restaurantId" = ${restaurantId} AND "returnedBaseQty" + ${t.baseQty} <= "baseQty"`;
    if (updated !== 1) throw limitReached(t.allocationId, 0);
  }

  // The units go to quarantine of the same batch and branch, balances taken in batch order.
  for (const t of lockOrder(taken.map((x) => ({ ...x, batchId: x.allocation.batchId })))) {
    await applyMovement(tx, {
      restaurantId,
      branchId,
      batchId: t.batchId,
      type: 'RETURN_QUARANTINE',
      deltas: { quarantine: t.baseQty },
      reason: input.reason,
      userId: ph.userId,
      refType: 'return',
      refId: t.lineId,
    });
  }

  // A controlled medicine returned: the register gets reversing rows, one per returned batch (the units are in quarantine above).
  await recordControlledReturn(tx, {
    restaurantId,
    branchId,
    saleId: sale.id,
    userId: ph.userId,
    entries: taken
      .filter((t) => t.allocation.line.rxLevel === 'RESTRICTED')
      .map((t) => ({ saleLineId: t.allocation.line.id, productId: t.allocation.line.productId, batchId: t.allocation.batchId, baseQty: t.baseQty })),
    now,
  });

  if (creditMinor > 0n && sale.customerId !== null) {
    await refundSale(tx, { restaurantId, customerId: sale.customerId, saleId: sale.id, amountMinor: creditMinor, currency: sale.currency, now });
  }

  // Cash given back (not what went to a customer's balance) is a negative cash movement of the approver's shift.
  if (method === 'CASH' && handedBackMinor > 0n) {
    await tx.phCashMovement.create({
      data: { restaurantId, shiftId: shift.id, type: 'REFUND_CASH', amountMinor: -handedBackMinor, currency: sale.currency, refType: 'return', refId: made.id, userId: ph.userId, createdAt: now },
    });
  }

  const statusAfter = isFinalReturn ? 'RETURNED_FULL' : 'RETURNED_PARTIAL';
  const moved = await tx.phSale.updateMany({ where: { id: sale.id, status: { in: ['COMPLETED', 'RETURNED_PARTIAL'] } }, data: { status: statusAfter } });
  if (moved.count !== 1) throw conflict('SALE_NOT_RETURNABLE', 'This sale cannot be returned');

  return {
    result: {
      id: made.id,
      number,
      saleId: sale.id,
      branchId,
      currency: sale.currency,
      refundMinor: String(refundMinor),
      creditMinor: String(creditMinor),
      refundMethod: method,
      saleStatus: statusAfter,
      lineCount: taken.length,
      createdAt: now.toISOString(),
      replayed: false,
    },
    audit: {
      kind: request.kind,
      number,
      saleId: sale.id,
      saleNumber: sale.number,
      branchId,
      currency: sale.currency,
      refundMinor: String(refundMinor),
      creditMinor: String(creditMinor),
      refundMethod: method,
      lineCount: taken.length,
      baseQty: taken.reduce((s, t) => s + t.baseQty, 0),
      reason: input.reason.slice(0, 200),
      statusBefore: sale.status,
      statusAfter,
    },
  };
}
