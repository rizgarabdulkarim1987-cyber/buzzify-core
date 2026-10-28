import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { ScopedTx } from '@/server/data/tenant-db';
import { canPh } from '@/server/domain/pharmacy/permissions';
import {
  discountPolicy,
  effectiveDiscount,
  invoiceDiscountAllocation,
  invoiceRounding,
  lineDiscount,
  lineGross,
  MAX_AMOUNT_MINOR,
  paymentCheck,
  PG_BIGINT_MAX,
  SaleMathError,
  saleNumber,
  type LineDiscountInput,
} from '@/server/domain/pharmacy/sale';
import { utcToday } from '@/server/domain/pharmacy/expiry';
import { allocateFefo, costOfBaseQty, sellableStock, toBase, type FefoBatch } from '@/server/domain/pharmacy/stock';
import { StudioError } from '@/server/studio/framework/result';
import type { PhActor } from './actor';
import { priceRowsAt } from './prices';
import { applyMovement, lockOrder } from './stock';

/**
 * Selling (phase 3, R3-1 to R3-7). One sale is one transaction on the caller's `tx`: replay by key, the seller's open
 * shift, each line checked against the catalog, the price at this moment, discounts judged together, invoice rounding
 * (IQD only), the payments, FEFO allocation under row locks, then the sale, lines, allocations, SALE movements,
 * payments and cash movements. Anything that fails throws and the transaction leaves nothing behind.
 *
 * Lock order, always the same, so sales never deadlock: (1) the sale key (a repeat of one key waits for the first and
 * then replays it), (2) the seller's shift row `FOR SHARE` (a shift close takes it `FOR UPDATE`, so a sale either
 * finishes before the close or finds the shift closed: no cash is ever posted into a closed shift), (3) the branch's
 * stock balances of the products sold, `FOR UPDATE` in batch order (`COLLATE "C"`, a fixed byte order), (4) the sold
 * batches' rows `FOR SHARE` (a recall or block racing a sale waits for it, or the sale sees it), (5) the branch's sale
 * numbering. Allocation reads the balances only after (3), so two sales of the last unit queue up and the second sees
 * the first's result. The advisory locks use the two-int form (namespace, hash of the key): NS_KEY and NS_NUMBER.
 * (receipts.ts and other files still use the one-int form `pg_advisory_xact_lock(hashtext(...))`; not changed here.)
 *
 * Cost snapshot (decided here): a batch's `unitCostMinor` is per `costUnit` (the unit it was bought in). The cost of an
 * allocation is `unitCostMinor x allocatedBaseQty / costUnit.baseQty` with the division FLOORED, stored with the batch's
 * cost currency, and only when the batch has a cost (else null). Flooring is per allocation, so the cost of a sale can be
 * understated by less than one minor unit per allocation (margin overstated by the same). The snapshot is stored and
 * never returned without `cost.view`.
 */

export const MAX_SALE_LINES = 200;
export const MAX_PAYMENTS = 10;
export const SALE_TIMEOUT_MS = 60_000;
const MAX_INT = 2_147_483_647;
/** Advisory lock namespaces of this file (first int of the two-int form). */
export const NS_KEY = 7101;
const NS_NUMBER = 7102;
const WHOLE = 'Enter a whole number';

// Input ---------------------------------------------------------------------------------------------------------------

const money = z.coerce.bigint('Enter an amount').min(0n, 'Use 0 or more').max(MAX_AMOUNT_MINOR, 'Enter a smaller amount');
const reasonText = z.string().trim().max(300, 'Use at most 300 characters');
const clientKeyText = z.string().trim().min(8, 'Use at least 8 characters').max(100, 'Use at most 100 characters');

/** A discount: an amount in minor units, or a percent (0 to 100, at most two decimals). */
export const discountInput = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('amount'), value: money, reason: reasonText.optional() }),
  z.object({ kind: z.literal('percent'), value: z.number('Enter a number').min(0, 'Use 0 or more').max(100, 'Enter a smaller number'), reason: reasonText.optional() }),
]);
export type DiscountInput = z.infer<typeof discountInput>;

export const saleLineInput = z.object({
  productId: z.string().min(1).max(64),
  unitId: z.string().min(1).max(64),
  qty: z.number(WHOLE).int(WHOLE).min(1, 'Use 1 or more').max(1_000_000, 'Enter a smaller number'),
  /** A batch chosen instead of FEFO: needs `batch.override` and `batchReason`. */
  batchId: z.string().min(1).max(64).optional(),
  batchReason: reasonText.optional(),
  /** A price other than the list price: needs `price.change` and `priceOverrideReason`. */
  unitPriceMinor: money.optional(),
  priceOverrideReason: reasonText.optional(),
  discount: discountInput.optional(),
});

export const salePaymentInput = z.object({
  method: z.enum(['CASH', 'CARD_MANUAL', 'TRANSFER_MANUAL'], 'Choose how it was paid'),
  amountMinor: money.min(1n, 'Enter an amount'),
  reference: z.string().trim().max(200, 'Use at most 200 characters').default(''),
  clientKey: clientKeyText,
});

export const saleInput = z.object({
  clientKey: clientKeyText,
  currency: z.enum(['IQD', 'USD'], 'Choose IQD or USD'),
  lines: z.array(saleLineInput).min(1, 'Add at least one line').max(MAX_SALE_LINES, 'Use at most 200 lines'),
  invoiceDiscount: discountInput.optional(),
  payments: z.array(salePaymentInput).max(MAX_PAYMENTS, 'Use at most 10 payments'),
  note: z.string().trim().max(1000, 'Use at most 1000 characters').default(''),
  /** A held cart this sale completes: the hold is consumed in the same transaction (exactly one completion wins). */
  fromHoldId: z.string().min(1).max(64).optional(),
});
export type SaleInput = z.infer<typeof saleInput>;

// Refusals ------------------------------------------------------------------------------------------------------------

export const invalid = (field: string, message: string, phCode?: string, extra: Record<string, string> = {}) =>
  new StudioError('INVALID', message, { [field]: message, ...(phCode ? { phCode } : {}), ...extra });
export const conflict = (phCode: string, message: string, extra: Record<string, string> = {}) => new StudioError('CONFLICT', message, { phCode, ...extra });

const insufficient = (product: { id: string; tradeName: string }, available: number, requested: number) =>
  conflict('INSUFFICIENT_STOCK', 'Not enough sellable stock for this product', {
    productId: product.id,
    productName: product.tradeName,
    available: String(available),
    requested: String(requested),
  });

/** The amount arithmetic refuses an input: say which field, in the person's terms. */
export function math<T>(field: string, run: () => T): T {
  try {
    return run();
  } catch (error) {
    if (error instanceof SaleMathError) {
      if (error.code === 'OVERFLOW') throw invalid(field, 'Enter a smaller amount');
      if (error.code === 'DISCOUNT_EXCEEDS_TOTAL') throw invalid(field, 'The discount is more than the sale', 'DISCOUNT_TOO_LARGE');
      throw invalid(field, 'Check this amount');
    }
    throw error;
  }
}

function percentToBp(value: number, field: string): number {
  const bp = Math.round(value * 100);
  if (Math.abs(value * 100 - bp) > 1e-6) throw invalid(field, 'Use at most 2 decimal places');
  return bp;
}

export function discountOf(gross: bigint, d: DiscountInput | undefined, field: string): bigint {
  if (!d) return 0n;
  if (d.kind === 'amount' && d.value > gross) throw invalid(`${field}.value`, 'The discount is more than the sale', 'DISCOUNT_TOO_LARGE');
  const asked: LineDiscountInput = d.kind === 'amount' ? { kind: 'amount', value: d.value } : { kind: 'percent', value: percentToBp(d.value, `${field}.value`) };
  return math(`${field}.value`, () => lineDiscount(gross, asked));
}

// Replay --------------------------------------------------------------------------------------------------------------

/** What identifies the request, apart from who and where: a repeat of a key must be this exactly. */
export function payloadHash(input: SaleInput): string {
  const d = (x: DiscountInput | undefined) => (x ? [x.kind, String(x.value), x.reason ?? ''] : null);
  const canonical = [
    input.clientKey,
    input.currency,
    input.note,
    d(input.invoiceDiscount),
    input.lines.map((l) => [l.productId, l.unitId, l.qty, l.batchId ?? null, l.batchReason ?? '', l.unitPriceMinor === undefined ? null : String(l.unitPriceMinor), l.priceOverrideReason ?? '', d(l.discount)]),
    input.payments.map((p) => [p.method, String(p.amountMinor), p.reference, p.clientKey]),
    // Only when present, so the hash of a sale that completes no hold is what it always was.
    ...(input.fromHoldId === undefined ? [] : [input.fromHoldId]),
  ];
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

export interface SaleResult {
  id: string;
  number: string | null;
  status: 'HELD' | 'COMPLETED' | 'RETURNED_PARTIAL' | 'RETURNED_FULL' | 'HOLD_EXPIRED';
  branchId: string;
  currency: 'IQD' | 'USD';
  subtotalMinor: string;
  discountMinor: string;
  roundingMinor: string;
  totalMinor: string;
  paidMinor: string;
  changeMinor: string;
  lineCount: number;
  completedAt: string | null;
  replayed: boolean;
}

/** What the audit entry says: ids, number, totals, counts. Never a customer field, never a cost. */
export interface SaleAudit {
  number: string;
  branchId: string;
  currency: 'IQD' | 'USD';
  totalMinor: string;
  lineCount: number;
  paymentCount: number;
  priceOverrides: number;
  batchOverrides: number;
  discountMinor: string;
  /** The hold this sale consumed, when it completed one. */
  fromHoldId: string | null;
}

interface SaleRow {
  id: string;
  number: string | null;
  status: SaleResult['status'];
  branchId: string;
  currency: 'IQD' | 'USD';
  subtotalMinor: bigint;
  discountMinor: bigint;
  roundingMinor: bigint;
  totalMinor: bigint;
  paidMinor: bigint;
  changeMinor: bigint;
  completedAt: Date | null;
}

const resultOf = (row: SaleRow, lineCount: number, replayed: boolean): SaleResult => ({
  id: row.id,
  number: row.number,
  status: row.status,
  branchId: row.branchId,
  currency: row.currency,
  subtotalMinor: String(row.subtotalMinor),
  discountMinor: String(row.discountMinor),
  roundingMinor: String(row.roundingMinor),
  totalMinor: String(row.totalMinor),
  paidMinor: String(row.paidMinor),
  changeMinor: String(row.changeMinor),
  lineCount,
  completedAt: row.completedAt ? row.completedAt.toISOString() : null,
  replayed,
});

// The sale ------------------------------------------------------------------------------------------------------------

interface Prepared {
  index: number;
  input: SaleInput['lines'][number];
  product: { id: string; tradeName: string; rxLevel: 'OTC' | 'RX' | 'RESTRICTED' };
  unitBaseQty: number;
  baseQty: number;
  unitPriceMinor: bigint;
  priceId: string | null;
  priceOverrideReason: string;
  grossMinor: bigint;
  lineDiscountMinor: bigint;
  invoiceShareMinor: bigint;
  pharmacistId: string | null;
}

interface Taken {
  line: Prepared;
  batchId: string;
  baseQty: number;
}

const expiryOf = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Sells in the caller's transaction. `branchId` is the validated place's, one of the actor's branches. Returns the
 * answer and, for a new sale, what to audit (null for a replay).
 */
export async function createSale(
  tx: ScopedTx,
  args: { ph: PhActor; branchId: string; input: SaleInput; now?: Date },
): Promise<{ result: SaleResult; audit: SaleAudit | null }> {
  const { ph, branchId, input } = args;
  const now = args.now ?? new Date();
  const role = ph.role;
  if (role === null || ph.support !== null) throw new StudioError('FORBIDDEN');
  const restaurantId = ph.restaurantId;
  const hash = payloadHash(input);

  // (1) One key at a time: a repeat waits for the first and then finds it.
  // eslint-disable-next-line no-restricted-properties -- an advisory lock touches no tenant rows: it only serialises one sale key
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${NS_KEY}::int, hashtext(${`${restaurantId}:${input.clientKey}`}))`;
  const earlier = await tx.phSale.findFirst({
    where: { clientKey: input.clientKey },
    select: {
      id: true,
      number: true,
      status: true,
      branchId: true,
      currency: true,
      subtotalMinor: true,
      discountMinor: true,
      roundingMinor: true,
      totalMinor: true,
      paidMinor: true,
      changeMinor: true,
      completedAt: true,
      soldById: true,
      payloadHash: true,
      _count: { select: { lines: true } },
    },
  });
  if (earlier) {
    // The key belongs to a hold (live or expired), not to a sale: a completing sale cannot reuse it.
    if (earlier.status === 'HELD' || earlier.status === 'HOLD_EXPIRED') throw conflict('CLIENT_KEY_USED', 'This key was already used');
    // A sale stored without a hash (none are written without one today) replays for the same branch and user only.
    if (earlier.branchId !== branchId || earlier.soldById !== ph.userId || (earlier.payloadHash !== null && earlier.payloadHash !== hash)) {
      throw conflict('CLIENT_KEY_MISMATCH', 'This key was already used for a different sale');
    }
    return { result: resultOf(earlier, earlier._count.lines, true), audit: null };
  }

  // (2) The seller's open shift here, in the sale's currency.
  const shift = await tx.phShift.findFirst({ where: { branchId, userId: ph.userId, status: 'OPEN' }, select: { id: true, currency: true } });
  if (!shift) throw conflict('NO_OPEN_SHIFT', 'Open a shift before selling');
  if (shift.currency !== input.currency) throw conflict('SHIFT_CURRENCY', 'Your open shift is in another currency');
  // Hold the shift open until this sale commits (a close waits for it); if it closed meanwhile there is no row.
  // eslint-disable-next-line no-restricted-properties -- a row lock on the seller's own shift, found above through the scoped client
  const heldShift = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "PhShift" WHERE "id" = ${shift.id} AND "status" = 'OPEN' FOR SHARE`;
  if (heldShift.length !== 1) throw conflict('NO_OPEN_SHIFT', 'Open a shift before selling');

  // Completing a hold: it is consumed here, in this transaction, by a guarded delete (its lines go with it). Two
  // completions of one hold: the second waits on the row, then finds it gone. A later failure rolls the delete back.
  // Any seller of the branch may complete it (holds are branch-level); the cash goes into THIS seller's shift, above.
  if (input.fromHoldId !== undefined) {
    const consumed = await tx.phSale.deleteMany({ where: { id: input.fromHoldId, branchId, status: 'HELD', heldUntil: { gt: now } } });
    if (consumed.count !== 1) {
      const stale = await tx.phSale.findFirst({ where: { id: input.fromHoldId, branchId, status: { in: ['HELD', 'HOLD_EXPIRED'] } }, select: { id: true } });
      if (stale) throw conflict('HOLD_EXPIRED', 'This held cart has expired');
      throw conflict('HOLD_NOT_AVAILABLE', 'This held cart was already used or discarded');
    }
  }

  const settings = await tx.phSettings.findFirst({ select: { roundingStepMinor: true, maxDiscountPercent: true } });
  // The column is CHECKed 0..100; clamp anyway so a bad row is never a 500.
  const maxDiscountPercent = Math.min(100, Math.max(0, settings?.maxDiscountPercent ?? 5));
  const roundingStep = input.currency === 'IQD' ? Number(settings?.roundingStepMinor ?? 0n) : 0;

  // (3) Each line against the business's own catalog.
  const productIds = [...new Set(input.lines.map((l) => l.productId))];
  const [products, units] = await Promise.all([
    tx.phProduct.findMany({ where: { id: { in: productIds } }, select: { id: true, tradeName: true, active: true, rxLevel: true } }),
    tx.phProductUnit.findMany({ where: { productId: { in: productIds } }, select: { id: true, productId: true, baseQty: true, sellable: true } }),
  ]);
  const productById = new Map(products.map((p) => [p.id, p]));
  const unitById = new Map(units.map((u) => [u.id, u]));
  const draft = input.lines.map((line, index) => {
    const product = productById.get(line.productId);
    if (!product || !product.active) throw invalid(`lines.${index}.productId`, 'Choose one of this pharmacy’s active products');
    const unit = unitById.get(line.unitId);
    if (!unit || unit.productId !== line.productId || !unit.sellable) throw invalid(`lines.${index}.unitId`, 'Choose one of this product’s units');
    if (product.rxLevel === 'RESTRICTED') {
      throw conflict('RESTRICTED_NOT_AVAILABLE', 'Controlled medicines cannot be sold yet', { productId: product.id, productName: product.tradeName });
    }
    if (product.rxLevel === 'RX' && !canPh(role, 'rx.dispense')) {
      throw invalid(`lines.${index}.productId`, 'A pharmacist must sell this medicine', 'RX_NEEDS_PHARMACIST', { productName: product.tradeName });
    }
    let baseQty: number;
    try {
      baseQty = toBase(line.qty, unit.baseQty);
    } catch {
      throw invalid(`lines.${index}.qty`, 'Enter a smaller number');
    }
    if (baseQty > MAX_INT) throw invalid(`lines.${index}.qty`, 'Enter a smaller number');
    return { index, line, product, unitBaseQty: unit.baseQty, baseQty };
  });

  // Prices at this moment: the branch's own row, else the business-wide one.
  const listPrices = await priceRowsAt(tx, { units: draft.map((d) => ({ productId: d.line.productId, unitId: d.line.unitId })), branchId, currency: input.currency, at: now });
  const canApply = canPh(role, 'discount.apply');
  const canOverLimit = canPh(role, 'discount.over_limit');
  let priceOverrides = 0;
  let batchOverrides = 0;
  const prepared: Prepared[] = draft.map(({ index, line, product, unitBaseQty, baseQty }) => {
    const listed = listPrices.get(`${line.productId}:${line.unitId}`);
    let unitPriceMinor: bigint;
    let priceId: string | null = null;
    let priceOverrideReason = '';
    // An override only replaces an existing price (R3-2): a unit with no list price here is not for sale.
    if (listed && line.unitPriceMinor !== undefined && line.unitPriceMinor !== listed.amount) {
      if (!canPh(role, 'price.change')) {
        throw new StudioError('FORBIDDEN', 'Changing the price needs permission', { phCode: 'PRICE_OVERRIDE_NOT_ALLOWED', [`lines.${index}.unitPriceMinor`]: 'Changing the price needs permission' });
      }
      priceOverrideReason = line.priceOverrideReason ?? '';
      if (priceOverrideReason.length < 3) throw invalid(`lines.${index}.priceOverrideReason`, 'Enter a reason of at least 3 characters');
      unitPriceMinor = line.unitPriceMinor;
      priceOverrides += 1;
    } else if (listed) {
      unitPriceMinor = listed.amount;
      priceId = listed.id;
    } else {
      throw invalid(`lines.${index}.unitId`, 'This product has no price in this currency', 'NO_PRICE', { productId: product.id, productName: product.tradeName });
    }
    if (line.batchId !== undefined) {
      if (!canPh(role, 'batch.override')) {
        throw new StudioError('FORBIDDEN', 'Choosing the batch needs permission', { phCode: 'BATCH_OVERRIDE_NOT_ALLOWED', [`lines.${index}.batchId`]: 'Choosing the batch needs permission' });
      }
      if ((line.batchReason ?? '').length < 3) throw invalid(`lines.${index}.batchReason`, 'Enter a reason of at least 3 characters');
      batchOverrides += 1;
    }
    const grossMinor = math(`lines.${index}.unitPriceMinor`, () => lineGross(BigInt(line.qty), unitPriceMinor));
    const lineDiscountMinor = discountOf(grossMinor, line.discount, `lines.${index}.discount`);
    return {
      index,
      input: line,
      product,
      unitBaseQty,
      baseQty,
      unitPriceMinor,
      priceId,
      priceOverrideReason,
      grossMinor,
      lineDiscountMinor,
      invoiceShareMinor: 0n,
      pharmacistId: product.rxLevel === 'RX' ? ph.userId : null,
    };
  });

  // (4) Discounts, judged together: what the lines and the invoice give away, against the gross.
  const afterLines = prepared.map((l) => ({ totalMinor: l.grossMinor - l.lineDiscountMinor }));
  const remaining = afterLines.reduce((sum, l) => sum + l.totalMinor, 0n);
  const invoiceDiscountMinor = discountOf(remaining, input.invoiceDiscount, 'invoiceDiscount');
  const shares = math('invoiceDiscount.value', () => invoiceDiscountAllocation(afterLines, invoiceDiscountMinor));
  prepared.forEach((l, i) => {
    l.invoiceShareMinor = shares[i]!;
  });
  const effective = math('invoiceDiscount.value', () =>
    effectiveDiscount({ lines: prepared.map((l) => ({ grossMinor: l.grossMinor, lineDiscountMinor: l.lineDiscountMinor })), invoiceDiscountMinor }),
  );
  const verdict = discountPolicy({ discountMinor: effective.totalDiscountMinor, grossMinor: effective.grossMinor, maxPercentBp: maxDiscountPercent * 100, canApply, canOverLimit });
  if (verdict === 'forbidden') {
    const code = canApply ? 'DISCOUNT_OVER_LIMIT' : 'DISCOUNT_NOT_ALLOWED';
    const text = canApply ? 'This discount is above your limit' : 'You may not give discounts';
    throw new StudioError('FORBIDDEN', text, { phCode: code, discount: text });
  }
  if (verdict === 'needs_over_limit') {
    for (const l of prepared) {
      if (l.lineDiscountMinor > 0n && (l.input.discount?.reason ?? '').length < 3) {
        throw invalid(`lines.${l.index}.discount.reason`, 'Enter a reason for this discount', 'DISCOUNT_REASON_REQUIRED');
      }
    }
    if (invoiceDiscountMinor > 0n && (input.invoiceDiscount?.reason ?? '').length < 3) {
      throw invalid('invoiceDiscount.reason', 'Enter a reason for this discount', 'DISCOUNT_REASON_REQUIRED');
    }
  }

  // (5) Totals and the invoice rounding (IQD only).
  const subtotalMinor = effective.grossMinor;
  const discountMinor = prepared.reduce((sum, l) => sum + l.lineDiscountMinor + l.invoiceShareMinor, 0n);
  let totalMinor: bigint;
  let roundingMinor: bigint;
  try {
    const rounded = invoiceRounding(subtotalMinor - discountMinor, roundingStep, input.currency);
    totalMinor = rounded.roundedMinor;
    roundingMinor = rounded.roundingMinor;
    // Rounding never turns a sale into a free one: a positive total that would round to 0 goes up to one step.
    if (roundingStep > 0 && subtotalMinor - discountMinor > 0n && totalMinor === 0n) {
      totalMinor = BigInt(roundingStep);
      roundingMinor = totalMinor - (subtotalMinor - discountMinor);
    }
  } catch (error) {
    if (error instanceof SaleMathError) throw conflict('ROUNDING_SETTING_INVALID', 'The rounding setting is not valid');
    throw error;
  }

  // (6) Payments.
  const paymentKeys = input.payments.map((p) => p.clientKey);
  if (new Set(paymentKeys).size !== paymentKeys.length) {
    throw invalid('payments', 'A payment key appears twice', 'PAYMENT_KEY_DUPLICATE');
  }
  const checked = paymentCheck({ totalMinor, payments: input.payments.map((p) => ({ method: p.method, amountMinor: p.amountMinor })) });
  if (!checked.ok) {
    const reasons = {
      SHORT: ['PAYMENT_SHORT', 'The payments do not cover the total'],
      NON_CASH_OVERPAY: ['PAYMENT_NON_CASH_OVERPAY', 'Card and transfer payments cannot be more than the total'],
      CASH_NOT_NEEDED: ['PAYMENT_CASH_NOT_NEEDED', 'Card and transfer payments already cover the total: remove the cash'],
      INVALID_PAYMENT: ['PAYMENT_INVALID', 'Check the payments'],
    } as const;
    const [code, text] = reasons[checked.reason];
    // The total the server computed rides along, so the screen can show it next to its own estimate.
    throw invalid('payments', text, code, { totalMinor: String(totalMinor) });
  }
  if (paymentKeys.length > 0) {
    const used = await tx.phPayment.findFirst({ where: { clientKey: { in: paymentKeys } }, select: { id: true } });
    if (used) throw conflict('PAYMENT_KEY_USED', 'This payment key was already used');
  }

  // (7) FEFO from the branch's sellable stock, under row locks taken in batch order.
  const soldProducts = [...new Set(prepared.map((l) => l.product.id))];
  // eslint-disable-next-line no-restricted-properties -- row locks on this branch's balances; every filter below names the actor's business and branch
  const locked = await tx.$queryRaw<{ batchId: string; productId: string; available: number }[]>`
    SELECT "batchId", "productId", "available" FROM "PhStockBalance"
    WHERE "restaurantId" = ${restaurantId} AND "branchId" = ${branchId} AND "productId" = ANY(${soldProducts}) AND "available" > 0
    ORDER BY "batchId" COLLATE "C" FOR UPDATE`;
  const overrideIds = prepared.flatMap((l) => (l.input.batchId ? [l.input.batchId] : []));
  const batchIds = [...new Set([...locked.map((r) => r.batchId), ...overrideIds])];
  // The sold batches stay as they are (not recalled or blocked meanwhile) until this sale commits.
  if (batchIds.length > 0) {
    // eslint-disable-next-line no-restricted-properties -- row locks on this business's batches, listed by id; the rows are read below through the scoped client
    await tx.$queryRaw`SELECT "id" FROM "PhBatch" WHERE "restaurantId" = ${restaurantId} AND "id" = ANY(${batchIds}) ORDER BY "id" COLLATE "C" FOR SHARE`;
  }
  const batches = await tx.phBatch.findMany({
    where: { id: { in: batchIds } },
    select: { id: true, productId: true, lot: true, status: true, expiryDate: true, expiryPrecision: true, unitCostMinor: true, costCurrency: true, costUnitId: true },
  });
  const batchById = new Map(batches.map((b) => [b.id, b]));
  const costUnitIds = [...new Set(batches.flatMap((b) => (b.costUnitId ? [b.costUnitId] : [])))];
  const costUnits = costUnitIds.length > 0 ? await tx.phProductUnit.findMany({ where: { id: { in: costUnitIds } }, select: { id: true, baseQty: true } }) : [];
  const costUnitBase = new Map(costUnits.map((u) => [u.id, u.baseQty]));

  const today = utcToday(now);
  const left = new Map<string, number>();
  for (const row of locked) {
    const batch = batchById.get(row.batchId);
    if (!batch) continue;
    left.set(row.batchId, sellableStock({ available: row.available, reserved: 0, quarantine: 0, damaged: 0 }, { status: batch.status, expiryDate: expiryOf(batch.expiryDate) }, today));
  }
  const sellableOf = (productId: string) =>
    locked.filter((r) => r.productId === productId).reduce((sum, r) => sum + (left.get(r.batchId) ?? 0), 0);

  const taken: Taken[] = [];
  // Overrides take their chosen batch first, so a FEFO line earlier in the list cannot starve them.
  const ordered = [...prepared.filter((l) => l.input.batchId !== undefined), ...prepared.filter((l) => l.input.batchId === undefined)];
  for (const line of ordered) {
    const wanted = line.input.batchId;
    if (wanted !== undefined) {
      const batch = batchById.get(wanted);
      if (!batch || batch.productId !== line.product.id) {
        throw invalid(`lines.${line.index}.batchId`, 'Choose a batch of this product', 'BATCH_NOT_FOR_PRODUCT');
      }
      if (expiryOf(batch.expiryDate) < today) throw conflict('BATCH_EXPIRED', 'This batch is expired and cannot be sold', { batchId: batch.id });
      if (batch.status !== 'ACTIVE') throw conflict('BATCH_NOT_ACTIVE', 'This batch is not active and cannot be sold', { batchId: batch.id });
      const have = left.get(batch.id) ?? 0;
      if (have < line.baseQty) throw insufficient(line.product, have, line.baseQty);
      left.set(batch.id, have - line.baseQty);
      taken.push({ line, batchId: batch.id, baseQty: line.baseQty });
      continue;
    }
    const candidates: (FefoBatch & { sellable: number })[] = [];
    for (const row of locked) {
      const batch = batchById.get(row.batchId);
      if (row.productId !== line.product.id || !batch) continue;
      candidates.push({ id: batch.id, lot: batch.lot, expiryDate: expiryOf(batch.expiryDate), expiryPrecision: batch.expiryPrecision, sellable: left.get(batch.id) ?? 0 });
    }
    const fefo = allocateFefo(candidates, line.baseQty);
    if (!fefo.ok) throw insufficient(line.product, sellableOf(line.product.id), line.baseQty);
    for (const a of fefo.allocations) {
      left.set(a.batchId, (left.get(a.batchId) ?? 0) - a.qty);
      taken.push({ line, batchId: a.batchId, baseQty: a.qty });
    }
  }

  // (8) Write. (3) The branch's numbering, last, so it is held for the shortest time.
  // eslint-disable-next-line no-restricted-properties -- an advisory lock touches no tenant rows: it only serialises one branch's sale numbers
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${NS_NUMBER}::int, hashtext(${branchId}))`;
  const issued = await tx.phSale.count({ where: { branchId, number: { startsWith: `${today.replaceAll('-', '')}-` } } });
  const number = saleNumber(now.toISOString(), issued + 1);
  const pharmacistId = prepared.some((l) => l.pharmacistId !== null) ? ph.userId : null;
  const sale = await tx.phSale.create({
    data: {
      restaurantId,
      branchId,
      shiftId: shift.id,
      number,
      status: 'COMPLETED',
      currency: input.currency,
      subtotalMinor,
      discountMinor,
      roundingMinor,
      totalMinor,
      paidMinor: checked.paidMinor,
      changeMinor: checked.changeMinor,
      clientKey: input.clientKey,
      payloadHash: hash,
      soldById: ph.userId,
      pharmacistId,
      note: input.note,
      createdAt: now,
      completedAt: now,
    },
    select: { id: true },
  });

  const lineIds = prepared.map(() => randomUUID());
  await tx.phSaleLine.createMany({
    data: prepared.map((l, i) => {
      const reasons = [l.lineDiscountMinor > 0n ? l.input.discount?.reason : undefined, l.invoiceShareMinor > 0n ? input.invoiceDiscount?.reason : undefined].filter(
        (r): r is string => r !== undefined && r !== '',
      );
      const lineDiscountTotal = l.lineDiscountMinor + l.invoiceShareMinor;
      return {
        id: lineIds[i]!,
        restaurantId,
        saleId: sale.id,
        lineNo: i + 1,
        productId: l.product.id,
        unitId: l.input.unitId,
        priceId: l.priceId,
        qty: l.input.qty,
        baseQty: l.baseQty,
        unitPriceMinor: l.unitPriceMinor,
        discountMinor: lineDiscountTotal,
        totalMinor: l.grossMinor - lineDiscountTotal,
        rxLevel: l.product.rxLevel,
        pharmacistId: l.pharmacistId,
        priceOverrideReason: l.priceOverrideReason,
        discountReason: reasons.join(' | '),
      };
    }),
  });

  const allocationRows = taken.map((t) => {
    const batch = batchById.get(t.batchId)!;
    let costSnapshotMinor: bigint | null = null;
    let costCurrency: 'IQD' | 'USD' | null = null;
    const per = batch.costUnitId ? costUnitBase.get(batch.costUnitId) : undefined;
    if (batch.unitCostMinor !== null && (per === undefined || batch.costCurrency === null)) {
      throw invalid('lines', 'This batch has a cost but no cost unit', 'COST_UNIT_MISSING', { batchId: batch.id });
    }
    if (batch.unitCostMinor !== null && batch.costCurrency !== null && per !== undefined) {
      costSnapshotMinor = costOfBaseQty(batch.unitCostMinor, t.baseQty, per);
      if (costSnapshotMinor > PG_BIGINT_MAX) throw conflict('COST_OVERFLOW', 'The cost of this batch is too large to record');
      costCurrency = batch.costCurrency;
    }
    return {
      id: randomUUID(),
      restaurantId,
      saleLineId: lineIds[t.line.index]!,
      batchId: t.batchId,
      baseQty: t.baseQty,
      costSnapshotMinor,
      costCurrency,
      expirySnapshot: batch.expiryDate,
      product: t.line.product,
      reason: t.line.input.batchId ? (t.line.input.batchReason ?? '') : '',
    };
  });
  await tx.phSaleLineAllocation.createMany({
    data: allocationRows.map((a) => ({
      id: a.id,
      restaurantId: a.restaurantId,
      saleLineId: a.saleLineId,
      batchId: a.batchId,
      baseQty: a.baseQty,
      costSnapshotMinor: a.costSnapshotMinor,
      costCurrency: a.costCurrency,
      expirySnapshot: a.expirySnapshot,
    })),
  });

  // One SALE movement per allocation, balances taken in batch order.
  for (const a of lockOrder(allocationRows)) {
    try {
      await applyMovement(tx, {
        restaurantId,
        branchId,
        batchId: a.batchId,
        type: 'SALE',
        deltas: { available: -a.baseQty },
        reason: a.reason,
        userId: ph.userId,
        refType: 'sale',
        refId: a.id,
      });
    } catch (error) {
      if (error instanceof StudioError && error.fields?.phCode === 'INSUFFICIENT_STOCK') {
        throw insufficient(a.product, Number(error.fields.have ?? 0), a.baseQty);
      }
      throw error;
    }
  }

  if (input.payments.length > 0) {
    await tx.phPayment.createMany({
      data: input.payments.map((p) => ({
        restaurantId,
        saleId: sale.id,
        method: p.method,
        amountMinor: p.amountMinor,
        currency: input.currency,
        clientKey: p.clientKey,
        reference: p.reference,
        createdAt: now,
      })),
    });
  }
  const cashTendered = input.payments.filter((p) => p.method === 'CASH').reduce((sum, p) => sum + p.amountMinor, 0n);
  // CHANGE_OUT rows are stored NEGATIVE. expectedCash takes the change as a positive figure to subtract: whoever sums a
  // shift's cash rows must take the magnitude of CHANGE_OUT, not subtract the stored (negative) amount a second time.
  const cashRows = [
    ...(cashTendered > 0n ? [{ type: 'SALE_CASH' as const, amountMinor: cashTendered }] : []),
    ...(checked.changeMinor > 0n ? [{ type: 'CHANGE_OUT' as const, amountMinor: -checked.changeMinor }] : []),
  ];
  if (cashRows.length > 0) {
    await tx.phCashMovement.createMany({
      data: cashRows.map((c) => ({ restaurantId, shiftId: shift.id, type: c.type, amountMinor: c.amountMinor, currency: input.currency, refType: 'sale', refId: sale.id, userId: ph.userId, createdAt: now })),
    });
  }

  const row: SaleRow = {
    id: sale.id,
    number,
    status: 'COMPLETED',
    branchId,
    currency: input.currency,
    subtotalMinor,
    discountMinor,
    roundingMinor,
    totalMinor,
    paidMinor: checked.paidMinor,
    changeMinor: checked.changeMinor,
    completedAt: now,
  };
  return {
    result: resultOf(row, prepared.length, false),
    audit: {
      number,
      branchId,
      currency: input.currency,
      totalMinor: String(totalMinor),
      lineCount: prepared.length,
      paymentCount: input.payments.length,
      priceOverrides,
      batchOverrides,
      discountMinor: String(discountMinor),
      fromHoldId: input.fromHoldId ?? null,
    },
  };
}
