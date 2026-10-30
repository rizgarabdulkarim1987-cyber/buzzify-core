import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { ScopedTx } from '@/server/data/tenant-db';
import { canPh } from '@/server/domain/pharmacy/permissions';
import { MAX_AMOUNT_MINOR } from '@/server/domain/pharmacy/sale';
import { updateWithVersion } from '@/server/studio/framework/concurrency';
import { StudioError } from '@/server/studio/framework/result';
import type { PhActor } from './actor';
import { cleanMultiline, cleanText } from './suppliers';

/**
 * Customers and their credit account (phase 7, R7-5). This file is the only writer of `PhCustomer`, `PhCustomerLedger` and
 * `PhCustomerPayment`; sales and returns append their charge and refund rows through `chargeSale` and `refundSale` below.
 * A customer belongs to the business (restaurantId only); a customer payment belongs to the branch it was taken at.
 *
 * The balance is NEVER stored: it is the sum of the customer's ledger rows (positive = the customer owes), read under the
 * customer's row lock wherever it decides something. The currency of a customer is fixed when they are made (the ledger, the
 * payments and the sales pin it with composite keys), so the update takes no currency.
 *
 * Lock order of this phase for money that touches a shift or a customer, always the same so nothing deadlocks:
 * (1) the client key (advisory), (2) the actor's open shift row FOR SHARE (a shift close takes it FOR UPDATE), (3) the sale row
 * FOR UPDATE (returns), (4) the customer row FOR UPDATE, (5) stock rows (sales), (6) number locks. A credit sale takes (1) (2)
 * (4) (5) (6); a return takes (1) (2) (3) (4) then (6) (5)-in-its-own-order; a customer payment takes (1) (2, cash only) (4).
 * The shift comes BEFORE the customer everywhere: a payment that held the customer and then waited for the shift behind a
 * close would deadlock with a sale that holds the shift and waits for the customer. The brief listed the customer first; this
 * order replaces it for that reason.
 *
 * A correction (decision of this task): a customer payment is corrected ONCE by a reversing row (the table's CHECK forbids a
 * negative amount, so it holds the same positive amount, method and customer, and names the payment in `reversesId`; a unique
 * key makes it once). The ledger gets a REVERSAL row of the opposite sign. Reversing a CASH payment gives the cash back out of
 * the drawer: a negative `REFUND_CASH` movement (refType `customer_payment`) on the reverser's own open shift in the same
 * branch, exactly like a cash refund of a sale (no drawer-sufficiency check, as in returns). The shift totals count it
 * separately from sale refunds.
 */

/** Advisory-lock namespace of customer payment keys (7141/7142 are the prescription locks). */
const NS_PAY_KEY = 7151;
export const CUSTOMER_PAGE = 50;

// Input ---------------------------------------------------------------------------------------------------------------

const limit = z.coerce.bigint('Enter an amount').min(0n, 'Use 0 or more').max(MAX_AMOUNT_MINOR, 'Enter a smaller amount');
const clientKeyText = z.string().trim().min(8, 'Use at least 8 characters').max(100, 'Use at most 100 characters');
const idText = z.string().min(1).max(64);

export const customerFields = z.object({
  name: z.string().transform(cleanText).pipe(z.string().min(1, 'Enter a name').max(120, 'Use at most 120 characters')),
  phone: z.string().transform(cleanText).pipe(z.string().max(40, 'Use at most 40 characters')).default(''),
  creditLimitMinor: limit,
  note: z.string().transform(cleanMultiline).pipe(z.string().max(500, 'Use at most 500 characters')).default(''),
});
export type CustomerFields = z.infer<typeof customerFields>;

export const customerCreateFields = customerFields.extend({ currency: z.enum(['IQD', 'USD'], 'Choose IQD or USD') });
export type CustomerCreateFields = z.infer<typeof customerCreateFields>;

export const customerListInput = z.object({
  search: z.string().trim().max(100, 'Use at most 100 characters').optional(),
  /** `true` (the default) lists live customers, `false` archived ones, `'all'` both. */
  active: z.union([z.boolean(), z.literal('all')]).default(true),
  /** Only customers who owe something. */
  owingOnly: z.boolean().optional(),
  cursor: z.string().min(1).max(64).nullish(),
});
export type CustomerListInput = z.infer<typeof customerListInput>;

export const paymentFields = z.object({
  clientKey: clientKeyText,
  customerId: idText,
  method: z.enum(['CASH', 'CARD', 'TRANSFER'], 'Choose how it was paid'),
  amountMinor: z.coerce.bigint('Enter an amount').min(1n, 'Enter an amount').max(MAX_AMOUNT_MINOR, 'Enter a smaller amount'),
});
export type PaymentFields = z.infer<typeof paymentFields>;

export const reverseFields = z.object({ clientKey: clientKeyText, paymentId: idText });
export type ReverseFields = z.infer<typeof reverseFields>;

// Refusals ------------------------------------------------------------------------------------------------------------

const notFound = () => new StudioError('NOT_FOUND', 'Customer not found');
const paymentNotFound = () => new StudioError('NOT_FOUND', 'Payment not found');
const conflict = (phCode: string, message: string, extra: Record<string, string> = {}) => new StudioError('CONFLICT', message, { phCode, ...extra });
const keyMismatch = () => conflict('CLIENT_KEY_MISMATCH', 'This key was already used for a different payment');

/** Who may see customers at all: a holder of `customer.manage` or `credit.sell`. A support actor sees none. */
export function assertCustomerAccess(ph: PhActor): void {
  if (ph.role === null || ph.support !== null) throw new StudioError('FORBIDDEN');
  if (!canPh(ph.role, 'customer.manage') && !canPh(ph.role, 'credit.sell')) throw new StudioError('FORBIDDEN');
}

/** Who may manage customers, take payments and read statements. */
export function assertCustomerManager(ph: PhActor): void {
  if (ph.role === null || ph.support !== null || !canPh(ph.role, 'customer.manage')) throw new StudioError('FORBIDDEN');
}

// Balance -------------------------------------------------------------------------------------------------------------

/** What the customer owes now: the sum of their ledger rows. */
export async function balanceOf(tx: Pick<ScopedTx, 'phCustomerLedger'>, customerId: string): Promise<bigint> {
  const sum = await tx.phCustomerLedger.aggregate({ where: { customerId }, _sum: { amountMinor: true } });
  return sum._sum.amountMinor ?? 0n;
}

export interface LockedCustomer {
  id: string;
  currency: 'IQD' | 'USD';
  active: boolean;
  creditLimitMinor: bigint;
}

/** Takes the customer's row `FOR UPDATE`: from here until commit nobody else charges, pays or reverses for them. */
export async function lockCustomer(tx: ScopedTx, restaurantId: string, customerId: string): Promise<LockedCustomer> {
  // eslint-disable-next-line no-restricted-properties -- a row lock on one customer of the actor's own business (restaurantId in the filter)
  const [row] = await tx.$queryRaw<LockedCustomer[]>`
    SELECT "id", "currency"::text AS "currency", "active", "creditLimitMinor" FROM "PhCustomer"
    WHERE "id" = ${customerId} AND "restaurantId" = ${restaurantId} FOR UPDATE`;
  if (!row) throw notFound();
  return row;
}

// Create, update, archive ---------------------------------------------------------------------------------------------

export interface CustomerWrite {
  id: string;
  version: number;
  active: boolean;
  currency: 'IQD' | 'USD';
  creditLimitMinor: string;
}

export async function createCustomer(tx: ScopedTx, args: { restaurantId: string; input: CustomerCreateFields }): Promise<CustomerWrite> {
  const { name, phone, creditLimitMinor, note, currency } = args.input;
  const made = await tx.phCustomer.create({
    data: { restaurantId: args.restaurantId, name, phone: phone === '' ? null : phone, creditLimitMinor, note, currency },
    select: { id: true, version: true, active: true, currency: true, creditLimitMinor: true },
  });
  return { ...made, creditLimitMinor: String(made.creditLimitMinor) };
}

export interface CustomerUpdate {
  id: string;
  version: number;
  before: { creditLimitMinor: string };
  after: { creditLimitMinor: string };
}

/** Saves the fields if the customer is still at `expectedVersion` (`CONFLICT` otherwise). The currency never changes. */
export async function updateCustomer(tx: ScopedTx, args: { customerId: string; expectedVersion: number; input: CustomerFields }): Promise<CustomerUpdate> {
  const current = await tx.phCustomer.findFirst({ where: { id: args.customerId }, select: { id: true, creditLimitMinor: true } });
  if (!current) throw notFound();
  const { name, phone, creditLimitMinor, note } = args.input;
  await updateWithVersion(tx.phCustomer, { id: current.id, version: args.expectedVersion, data: { name, phone: phone === '' ? null : phone, creditLimitMinor, note }, entityType: 'PhCustomer' }, tx);
  return { id: current.id, version: args.expectedVersion + 1, before: { creditLimitMinor: String(current.creditLimitMinor) }, after: { creditLimitMinor: String(creditLimitMinor) } };
}

export interface CustomerArchive {
  id: string;
  version: number;
  active: boolean;
  changed: boolean;
}

/** Hides a customer from new credit sales or brings them back. A balance does not stop it; they can still pay. */
export async function archiveCustomer(tx: ScopedTx, args: { customerId: string; archived: boolean }): Promise<CustomerArchive> {
  const current = await tx.phCustomer.findFirst({ where: { id: args.customerId }, select: { id: true, active: true, version: true } });
  if (!current) throw notFound();
  const active = !args.archived;
  if (current.active === active) return { id: current.id, version: current.version, active, changed: false };
  await updateWithVersion(tx.phCustomer, { id: current.id, version: current.version, data: { active }, entityType: 'PhCustomer' }, tx);
  return { id: current.id, version: current.version + 1, active, changed: true };
}

// Ledger rows of sales and returns ------------------------------------------------------------------------------------

/** The CHARGE of a credit sale. The caller holds the customer lock and has judged the limit. */
export async function chargeSale(tx: ScopedTx, args: { restaurantId: string; customerId: string; saleId: string; amountMinor: bigint; currency: 'IQD' | 'USD'; now: Date }): Promise<void> {
  await tx.phCustomerLedger.create({
    data: { restaurantId: args.restaurantId, customerId: args.customerId, kind: 'CHARGE', amountMinor: args.amountMinor, currency: args.currency, saleId: args.saleId, createdAt: args.now },
  });
}

/** The REFUND row of a return of a credit sale: the debt goes down by `amountMinor`. The caller holds the customer lock. */
export async function refundSale(tx: ScopedTx, args: { restaurantId: string; customerId: string; saleId: string; amountMinor: bigint; currency: 'IQD' | 'USD'; now: Date }): Promise<void> {
  await tx.phCustomerLedger.create({
    data: { restaurantId: args.restaurantId, customerId: args.customerId, kind: 'REFUND', amountMinor: -args.amountMinor, currency: args.currency, saleId: args.saleId, createdAt: args.now },
  });
}

// Payments ------------------------------------------------------------------------------------------------------------

const hashOf = (parts: unknown[]) => createHash('sha256').update(JSON.stringify(parts)).digest('hex');
export const paymentPayloadHash = (input: PaymentFields) => hashOf(['cpay', input.customerId, input.method, input.amountMinor.toString()]);
export const reversePayloadHash = (input: ReverseFields) => hashOf(['crev', input.paymentId]);

export interface PaymentResult {
  id: string;
  customerId: string;
  branchId: string;
  method: 'CASH' | 'CARD' | 'TRANSFER';
  amountMinor: string;
  currency: 'IQD' | 'USD';
  reversesId: string | null;
  /** What the customer owes after this payment (or, on a replay, now). */
  balanceMinor: string;
  replayed: boolean;
}

interface PaymentRow {
  id: string;
  customerId: string;
  branchId: string;
  method: 'CASH' | 'CARD' | 'TRANSFER';
  amountMinor: bigint;
  currency: 'IQD' | 'USD';
  reversesId: string | null;
}

const resultOf = (row: PaymentRow, balance: bigint, replayed: boolean): PaymentResult => ({
  id: row.id,
  customerId: row.customerId,
  branchId: row.branchId,
  method: row.method,
  amountMinor: String(row.amountMinor),
  currency: row.currency,
  reversesId: row.reversesId,
  balanceMinor: String(balance),
  replayed,
});

const PAYMENT_SELECT = { id: true, customerId: true, branchId: true, method: true, amountMinor: true, currency: true, reversesId: true, createdById: true, payloadHash: true } as const;

/** The actor's own open shift here in `currency`, held open (FOR SHARE) until we commit. */
async function holdShift(tx: ScopedTx, ph: PhActor, branchId: string, currency: string): Promise<string> {
  const shift = await tx.phShift.findFirst({ where: { branchId, userId: ph.userId, status: 'OPEN' }, select: { id: true, currency: true } });
  if (!shift) throw conflict('NO_OPEN_SHIFT', 'You have no open shift here');
  if (shift.currency !== currency) throw conflict('SHIFT_CURRENCY', 'Your open shift is in another currency');
  // eslint-disable-next-line no-restricted-properties -- a row lock on the actor's own shift, found above through the scoped client
  const held = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "PhShift" WHERE "id" = ${shift.id} AND "status" = 'OPEN' FOR SHARE`;
  if (held.length !== 1) throw conflict('NO_OPEN_SHIFT', 'You have no open shift here');
  return shift.id;
}

/**
 * Takes a payment from a customer: cash, card or transfer (manual, no gateway). Idempotent by `clientKey` + payload. A CASH
 * payment needs the actor's open shift here in the customer's currency and goes into its drawer as a CUSTOMER_PAYMENT
 * movement. The amount may not be more than the customer owes (judged under their row lock).
 */
export async function recordPayment(
  tx: ScopedTx,
  args: { ph: PhActor; branchId: string; input: PaymentFields; now?: Date },
): Promise<{ result: PaymentResult; audit: PaymentResult | null }> {
  const { ph, branchId, input } = args;
  const now = args.now ?? new Date();
  assertCustomerManager(ph);
  const restaurantId = ph.restaurantId;
  const hash = paymentPayloadHash(input);

  // (1) One key at a time.
  // eslint-disable-next-line no-restricted-properties -- an advisory lock touches no tenant rows: it only serialises one payment key
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${NS_PAY_KEY}::int, hashtext(${`${restaurantId}:${input.clientKey}`}))`;
  const earlier = await tx.phCustomerPayment.findFirst({ where: { clientKey: input.clientKey }, select: PAYMENT_SELECT });
  if (earlier) {
    if (earlier.branchId !== branchId || earlier.createdById !== ph.userId || earlier.payloadHash !== hash) throw keyMismatch();
    return { result: resultOf(earlier, await balanceOf(tx, earlier.customerId), true), audit: null };
  }

  const customer = await tx.phCustomer.findFirst({ where: { id: input.customerId }, select: { id: true, currency: true } });
  if (!customer) throw notFound();
  // (2) Cash goes into the actor's open shift.
  const shiftId = input.method === 'CASH' ? await holdShift(tx, ph, branchId, customer.currency) : null;
  // (4) The customer.
  await lockCustomer(tx, restaurantId, customer.id);
  const balance = await balanceOf(tx, customer.id);
  if (input.amountMinor > balance) {
    throw conflict('PAYMENT_EXCEEDS_BALANCE', 'The payment is more than the customer owes', { owed: String(balance > 0n ? balance : 0n) });
  }
  const made = await tx.phCustomerPayment.create({
    data: { restaurantId, branchId, customerId: customer.id, method: input.method, amountMinor: input.amountMinor, currency: customer.currency, clientKey: input.clientKey, payloadHash: hash, shiftId, createdById: ph.userId, createdAt: now },
    select: PAYMENT_SELECT,
  });
  await tx.phCustomerLedger.create({
    data: { restaurantId, customerId: customer.id, kind: 'PAYMENT', amountMinor: -input.amountMinor, currency: customer.currency, paymentId: made.id, createdAt: now },
  });
  if (shiftId !== null) {
    await tx.phCashMovement.create({
      data: { restaurantId, shiftId, type: 'CUSTOMER_PAYMENT', amountMinor: input.amountMinor, currency: customer.currency, refType: 'customer_payment', refId: made.id, userId: ph.userId, createdAt: now },
    });
  }
  const result = resultOf(made, balance - input.amountMinor, false);
  return { result, audit: result };
}

/**
 * Corrects a payment, once: a reversing row of the same amount, method and customer, a REVERSAL ledger row that puts the debt
 * back, and for cash the money out of the actor's drawer. Only in the branch the payment was taken at; a correction cannot be
 * corrected (take the payment again instead).
 */
export async function reversePayment(
  tx: ScopedTx,
  args: { ph: PhActor; branchId: string; input: ReverseFields; now?: Date },
): Promise<{ result: PaymentResult; audit: PaymentResult | null }> {
  const { ph, branchId, input } = args;
  const now = args.now ?? new Date();
  assertCustomerManager(ph);
  const restaurantId = ph.restaurantId;
  const hash = reversePayloadHash(input);

  // eslint-disable-next-line no-restricted-properties -- an advisory lock touches no tenant rows: it only serialises one payment key
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${NS_PAY_KEY}::int, hashtext(${`${restaurantId}:${input.clientKey}`}))`;
  const earlier = await tx.phCustomerPayment.findFirst({ where: { clientKey: input.clientKey }, select: PAYMENT_SELECT });
  if (earlier) {
    if (earlier.branchId !== branchId || earlier.createdById !== ph.userId || earlier.payloadHash !== hash) throw keyMismatch();
    return { result: resultOf(earlier, await balanceOf(tx, earlier.customerId), true), audit: null };
  }

  const original = await tx.phCustomerPayment.findFirst({ where: { id: input.paymentId, branchId }, select: { id: true, customerId: true, branchId: true, method: true, amountMinor: true, currency: true, reversesId: true } });
  if (!original) throw paymentNotFound();
  if (original.reversesId !== null) throw conflict('ALREADY_REVERSAL', 'A correction cannot be corrected');
  const shiftId = original.method === 'CASH' ? await holdShift(tx, ph, branchId, original.currency) : null;
  await lockCustomer(tx, restaurantId, original.customerId);
  // Under the customer lock: a second correction of the same payment finds the first.
  if (await tx.phCustomerPayment.findFirst({ where: { reversesId: original.id }, select: { id: true } })) {
    throw conflict('ALREADY_REVERSED', 'This payment was already corrected');
  }
  const made = await tx.phCustomerPayment.create({
    data: {
      restaurantId,
      branchId,
      customerId: original.customerId,
      method: original.method,
      amountMinor: original.amountMinor,
      currency: original.currency,
      clientKey: input.clientKey,
      payloadHash: hash,
      shiftId,
      reversesId: original.id,
      createdById: ph.userId,
      createdAt: now,
    },
    select: PAYMENT_SELECT,
  });
  await tx.phCustomerLedger.create({
    data: { restaurantId, customerId: original.customerId, kind: 'REVERSAL', amountMinor: original.amountMinor, currency: original.currency, paymentId: made.id, createdAt: now },
  });
  if (shiftId !== null) {
    await tx.phCashMovement.create({
      data: { restaurantId, shiftId, type: 'REFUND_CASH', amountMinor: -original.amountMinor, currency: original.currency, refType: 'customer_payment', refId: made.id, userId: ph.userId, createdAt: now },
    });
  }
  const result = resultOf(made, await balanceOf(tx, original.customerId), false);
  return { result, audit: result };
}
