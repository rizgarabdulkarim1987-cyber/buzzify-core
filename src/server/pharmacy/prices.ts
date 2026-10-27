import { z } from 'zod';
import type { ScopedDb, ScopedTx } from '@/server/data/tenant-db';
import { BulkPriceError, previewBulk, type BulkChange, type BulkRowPreview } from '@/server/domain/pharmacy/bulk-price';
import { assertEnabledCurrency, CurrencyNotEnabledError, parseMoney, type Currency, type PhMoney } from '@/server/domain/pharmacy/money';
import { StudioError } from '@/server/studio/framework/result';
import type { PhActor } from './actor';

/**
 * A pharmacy's sale prices: the services behind `ph.prices.*`. A price is a row per product unit, branch (or the whole
 * business, a null branch) and currency, valid from `validFrom` until `validTo` (exclusive; null while it is the open
 * row). A new price closes the open row at its own `validFrom` in the same transaction; a row is never changed
 * otherwise, so the history is what was charged. The database keeps one open row per key (`PhPrice_one_open_price`).
 * Every row's `restaurantId` is the actor's business, and `changedById` the actor, never the input. These are sale
 * prices: the product's cost is not touched here.
 */

const ID = z.string().min(1).max(64);
const CURRENCY = z.enum(['IQD', 'USD']);

export const REASON_SHORT = 'Enter a reason of at least 3 characters';
const reason = z.string(REASON_SHORT).trim().min(3, REASON_SHORT).max(200, 'Use at most 200 characters');
const validFrom = z.coerce.date({ error: 'Enter a valid date' });

/** One price as the person enters it. `branchId` (absent: every branch) is the definition's branch too. */
export const priceSetInput = z.object({
  productId: ID,
  unitId: ID,
  currency: CURRENCY,
  amount: z.string().max(32, 'Enter a smaller number'),
  validFrom,
  reason,
});
export type PriceSetInput = z.infer<typeof priceSetInput> & { branchId?: string };

/** Most rows one bulk change may cover. */
export const BULK_MAX_ROWS = 2000;

/** A bulk change as the person enters it: which prices (branch, currency, products), the change and the rounding. */
export const bulkPreviewInput = z.object({
  currency: CURRENCY,
  productIds: z.array(ID).min(1, 'Choose at least one product').max(BULK_MAX_ROWS, 'Choose fewer products').optional(),
  change: z.discriminatedUnion('kind', [
    z.object({
      kind: z.literal('percent'),
      basisPoints: z
        .number('Enter a whole number')
        .int('Enter a whole number')
        .min(-10_000, 'A price can go down by at most 100%')
        .max(100_000, 'A price can go up by at most 1000%'),
    }),
    z.object({ kind: z.literal('fixed'), amount: z.string().max(32, 'Enter a smaller number') }),
  ]),
  rounding: z.object({ step: z.string().max(32, 'Enter a smaller number'), mode: z.enum(['nearest', 'up', 'down']) }),
  validFrom,
  reason,
});
export type BulkPreviewInput = z.infer<typeof bulkPreviewInput> & { branchId?: string };

export const bulkApplyInput = z.object({ batchId: ID, previewHash: z.string().min(1).max(128) });

/** The paging of a price history: one product, optionally one unit or currency, newest first. */
export const priceHistoryInput = z.object({
  productId: ID,
  unitId: ID.optional(),
  currency: CURRENCY.optional(),
  cursor: ID.nullish(),
  pageSize: z.number('Enter a whole number').int('Enter a whole number').min(1, 'Use 1 or more').max(100, 'Enter a smaller number').default(50),
});

// Refusals ------------------------------------------------------------------------------------------------------------

export const PRICE_CONFLICT_MESSAGE = 'Someone changed this price at the same time. Reload and try again.';
export const PREVIEW_STALE_MESSAGE = 'Prices changed since this preview. Preview the change again.';

const priceConflict = () => new StudioError('CONFLICT', PRICE_CONFLICT_MESSAGE, { phCode: 'PRICE_CONFLICT' });
const previewStale = () => new StudioError('CONFLICT', PREVIEW_STALE_MESSAGE, { phCode: 'PREVIEW_STALE' });
const backdated = (key: { productId: string; unitId: string }, inBulk: boolean) =>
  new StudioError('INVALID', undefined, {
    validFrom: 'Choose a start after the current price’s start',
    phCode: 'PRICE_BACKDATED',
    ...(inBulk ? { productId: key.productId, unitId: key.unitId } : {}),
  });

/**
 * For a price write that lost a race: the database's one-open-row index (`P2002`) refused a second open row, so another
 * save of the same price committed first. Answered `PRICE_CONFLICT` (safe to retry after reloading); anything else is
 * returned as it is.
 */
export function asPriceRace(error: unknown): unknown {
  return (error as { code?: unknown } | null)?.code === 'P2002' ? priceConflict() : error;
}

// Rules ---------------------------------------------------------------------------------------------------------------

/**
 * A person sets prices only where they work: a branch's price needs that branch among theirs (an owner has every branch
 * of the business), and a business-wide price (`branchId` null) needs every branch, which only the owner has. A support
 * actor holds no role and never sets a price.
 */
export function assertPriceBranch(ph: PhActor, branchId: string | null): void {
  if (ph.role === null || ph.support !== null) throw new StudioError('FORBIDDEN');
  if (branchId === null ? !ph.allBranches : !ph.branchIds.includes(branchId)) throw new StudioError('FORBIDDEN');
}

/** The currencies the business prices in (`PhSettings`); a business without its settings row has the default, IQD. */
async function assertCurrency(scoped: ScopedDb, currency: Currency): Promise<void> {
  const settings = await scoped.phSettings.findFirst({ select: { enabledCurrencies: true } });
  try {
    assertEnabledCurrency(currency, settings?.enabledCurrencies ?? ['IQD']);
  } catch (error) {
    if (!(error instanceof CurrencyNotEnabledError)) throw error;
    throw new StudioError('INVALID', undefined, { currency: 'This pharmacy does not price in this currency', phCode: 'CURRENCY_NOT_ENABLED' });
  }
}

/** An amount typed by a person, in minor units; null for anything `parseMoney` refuses (a sign, a bad grouping, ...). */
function amountOf(text: string, currency: Currency, field: string): bigint {
  const parsed = parseMoney(text, currency);
  if (!parsed) throw new StudioError('INVALID', undefined, { [field]: 'Enter an amount of 0 or more, like 1,250', phCode: 'INVALID_AMOUNT' });
  return parsed.amount;
}

/** A change by a fixed amount: an amount with an optional leading minus (`-1,500` lowers every price by 1,500). */
function signedAmountOf(text: string, currency: Currency): bigint {
  const negative = /^\s*[-−]/.test(text);
  const amount = amountOf(negative ? text.replace(/^\s*[-−]/, '') : text, currency, 'change.amount');
  return negative ? -amount : amount;
}

interface PriceKey {
  productId: string;
  unitId: string;
  branchId: string | null;
  currency: Currency;
}

/** What one price write did, for the audit. */
export interface PriceWrite {
  id: string;
  key: PriceKey;
  amountMinor: bigint;
  validFrom: Date;
  previous: { id: string; amountMinor: bigint; validFrom: Date } | null;
}

/**
 * Appends the price of `key` from `from`: the open row (if any) must have started before `from`, and is closed at `from`;
 * then the new row is written. `expectedOpenId` (a bulk change) is the open row the preview was worked out from: another
 * one now is a lost race. Closing a row someone else closed first, like a second open row, is `PRICE_CONFLICT`.
 */
async function appendPrice(
  tx: ScopedTx,
  ph: PhActor,
  key: PriceKey,
  amountMinor: bigint,
  from: Date,
  why: string,
  bulk?: { expectedOpenId: string | null },
): Promise<PriceWrite> {
  const open = await tx.phPrice.findFirst({
    where: { productId: key.productId, unitId: key.unitId, branchId: key.branchId, currency: key.currency, validTo: null },
    select: { id: true, amountMinor: true, validFrom: true },
  });
  if (bulk && (open?.id ?? null) !== bulk.expectedOpenId) throw priceConflict();
  if (open && from.getTime() <= open.validFrom.getTime()) throw backdated(key, bulk !== undefined);
  if (open) {
    // The only update a price row ever gets: its validTo, once, from null.
    const closed = await tx.phPrice.updateMany({ where: { id: open.id, validTo: null }, data: { validTo: from } });
    if (closed.count !== 1) throw priceConflict();
  }
  const row = await tx.phPrice.create({
    data: { restaurantId: ph.restaurantId, ...key, amountMinor, validFrom: from, validTo: null, reason: why, changedById: ph.userId },
    select: { id: true },
  });
  return { id: row.id, key, amountMinor, validFrom: from, previous: open };
}

// Writes --------------------------------------------------------------------------------------------------------------

/** Sets one price (the branch must be checked first with `assertPriceBranch`). */
export async function setPrice(tx: ScopedTx, ph: PhActor, input: PriceSetInput): Promise<PriceWrite> {
  await assertCurrency(tx, input.currency);
  const amountMinor = amountOf(input.amount, input.currency, 'amount');
  const unit = await tx.phProductUnit.findFirst({ where: { id: input.unitId, productId: input.productId }, select: { id: true } });
  if (!unit) throw new StudioError('NOT_FOUND');
  const key: PriceKey = { productId: input.productId, unitId: input.unitId, branchId: input.branchId ?? null, currency: input.currency };
  return appendPrice(tx, ph, key, amountMinor, input.validFrom, input.reason);
}

/** What a stored batch asks for: the bulk input but its date (a column of its own), with the amounts as typed. */
const bulkParams = z.object({
  branchId: ID.nullable(),
  currency: CURRENCY,
  productIds: z.array(ID).nullable(),
  change: bulkPreviewInput.shape.change,
  rounding: bulkPreviewInput.shape.rounding,
  reason: z.string(),
});
type BulkParams = z.infer<typeof bulkParams>;

export interface BulkPreview {
  previewHash: string;
  rows: (BulkRowPreview & { openId: string; openFrom: Date })[];
}

/**
 * The preview of `params` from the prices open now: the open rows of that branch (or the business-wide rows) and
 * currency, of the chosen products or all; with `checkDates` each must have started before `from`. Refused when there are none or too
 * many, or when the change takes one below zero.
 */
async function workOut(scoped: ScopedDb, params: BulkParams, from: Date, checkDates: boolean): Promise<BulkPreview> {
  const open = await scoped.phPrice.findMany({
    where: {
      branchId: params.branchId,
      currency: params.currency,
      validTo: null,
      ...(params.productIds ? { productId: { in: params.productIds } } : {}),
    },
    select: { id: true, productId: true, unitId: true, amountMinor: true, validFrom: true },
    orderBy: [{ productId: 'asc' }, { unitId: 'asc' }],
    take: BULK_MAX_ROWS + 1,
  });
  if (open.length === 0) throw new StudioError('INVALID', 'There are no prices to change', { phCode: 'NO_PRICES' });
  if (open.length > BULK_MAX_ROWS) throw new StudioError('INVALID', 'This change covers too many prices. Choose fewer products.', { phCode: 'BULK_TOO_LARGE' });

  const change: BulkChange =
    params.change.kind === 'percent'
      ? { kind: 'percent', basisPoints: params.change.basisPoints }
      : { kind: 'fixed', amount: signedAmountOf(params.change.amount, params.currency) };
  const step = amountOf(params.rounding.step, params.currency, 'rounding.step');
  if (step < 1n) throw new StudioError('INVALID', undefined, { 'rounding.step': 'Round to a step above zero', phCode: 'INVALID_AMOUNT' });

  let preview: ReturnType<typeof previewBulk>;
  try {
    preview = previewBulk({
      rows: open.map((r) => ({ productId: r.productId, unitId: r.unitId, currency: params.currency, current: r.amountMinor })),
      change,
      rounding: { step, mode: params.rounding.mode },
      validFrom: from,
    });
  } catch (error) {
    if (!(error instanceof BulkPriceError)) throw error;
    throw new StudioError('INVALID', undefined, {
      change: 'This change takes a price below zero',
      phCode: 'NEGATIVE_PRICE',
      productId: error.productId,
      unitId: error.unitId,
    });
  }
  const openOf = new Map(open.map((r) => [`${r.productId} ${r.unitId}`, r]));
  const rows = preview.rows.map((row) => {
    const source = openOf.get(`${row.productId} ${row.unitId}`)!;
    if (checkDates && from.getTime() <= source.validFrom.getTime()) throw backdated(row, true);
    return { ...row, openId: source.id, openFrom: source.validFrom };
  });
  return { previewHash: preview.previewHash, rows };
}

/** Previews a bulk change and stores it as a `PREVIEW` batch (the branch must be checked first). */
export async function previewBulkPrices(
  tx: ScopedTx,
  ph: PhActor,
  input: BulkPreviewInput,
): Promise<{ batchId: string; preview: BulkPreview; params: BulkParams }> {
  await assertCurrency(tx, input.currency);
  const params: BulkParams = {
    branchId: input.branchId ?? null,
    currency: input.currency,
    productIds: input.productIds ? [...new Set(input.productIds)].sort() : null,
    change: input.change,
    rounding: input.rounding,
    reason: input.reason,
  };
  const preview = await workOut(tx, params, input.validFrom, true);
  const batch = await tx.phPriceChangeBatch.create({
    data: { restaurantId: ph.restaurantId, status: 'PREVIEW', previewHash: preview.previewHash, validFrom: input.validFrom, change: params, createdById: ph.userId },
    select: { id: true },
  });
  return { batchId: batch.id, preview, params };
}

export type BulkApply =
  | { alreadyApplied: true }
  | { alreadyApplied: false; written: PriceWrite[]; params: BulkParams; validFrom: Date; rows: BulkRowPreview[] };

/**
 * Applies a previewed batch, all or nothing, on `tx`. The batch is claimed first (`PREVIEW` to `APPLIED`, atomically),
 * so a second apply, even one running at the same moment, finds it applied and changes nothing. The preview is then
 * worked out again from the prices open now: a hash other than the one the person saw (theirs, or the batch's) is
 * `PREVIEW_STALE`, and any failing row fails the whole transaction. A row whose price does not change is not written.
 */
export async function applyBulkPrices(tx: ScopedTx, ph: PhActor, input: z.infer<typeof bulkApplyInput>): Promise<BulkApply> {
  const batch = await tx.phPriceChangeBatch.findFirst({
    where: { id: input.batchId },
    select: { id: true, status: true, previewHash: true, validFrom: true, change: true },
  });
  if (!batch) throw new StudioError('NOT_FOUND');
  const params = bulkParams.parse(batch.change);
  assertPriceBranch(ph, params.branchId);
  if (batch.previewHash !== input.previewHash) throw previewStale();
  if (batch.status === 'APPLIED') return { alreadyApplied: true };
  if (batch.status !== 'PREVIEW') throw previewStale();

  const claimed = await tx.phPriceChangeBatch.updateMany({ where: { id: batch.id, status: 'PREVIEW' }, data: { status: 'APPLIED' } });
  if (claimed.count !== 1) {
    // Another apply committed while this one waited for the row.
    const now = await tx.phPriceChangeBatch.findFirst({ where: { id: batch.id }, select: { status: true } });
    if (now?.status === 'APPLIED') return { alreadyApplied: true };
    throw previewStale();
  }

  await assertCurrency(tx, params.currency);
  // The dates are checked row by row as each is written, so one late row undoes the rows written before it.
  const preview = await workOut(tx, params, batch.validFrom, false);
  if (preview.previewHash !== batch.previewHash) throw previewStale();

  const written: PriceWrite[] = [];
  for (const row of preview.rows) {
    if (row.after === row.before) continue;
    const key: PriceKey = { productId: row.productId, unitId: row.unitId, branchId: params.branchId, currency: params.currency };
    written.push(await appendPrice(tx, ph, key, row.after, batch.validFrom, params.reason, { expectedOpenId: row.openId }));
  }
  return { alreadyApplied: false, written, params, validFrom: batch.validFrom, rows: preview.rows };
}

// Reads ---------------------------------------------------------------------------------------------------------------

/**
 * The price of a product unit in a branch at an instant: the row with `validFrom <= at < validTo` (an open row has no
 * end). The branch's own row wins over the business-wide row, in that branch only; `branchId` null asks for the
 * business-wide price. Null when none was valid then. One indexed read (restaurant, product, unit, currency, validFrom).
 */
export async function priceAt(
  scoped: ScopedDb,
  query: { productId: string; unitId: string; branchId: string | null; currency: Currency; at: Date },
): Promise<PhMoney | null> {
  const rows = await scoped.phPrice.findMany({
    where: {
      productId: query.productId,
      unitId: query.unitId,
      currency: query.currency,
      validFrom: { lte: query.at },
      AND: [
        { OR: [{ validTo: null }, { validTo: { gt: query.at } }] },
        { OR: query.branchId === null ? [{ branchId: null }] : [{ branchId: query.branchId }, { branchId: null }] },
      ],
    },
    select: { branchId: true, amountMinor: true },
    orderBy: { validFrom: 'desc' },
    take: 4,
  });
  const chosen = rows.find((r) => r.branchId !== null) ?? rows[0];
  return chosen ? { amount: chosen.amountMinor, currency: query.currency } : null;
}

export interface PriceHistoryRow {
  id: string;
  productId: string;
  unitId: string;
  branchId: string | null;
  currency: Currency;
  /** Minor units, as a decimal string. */
  amountMinor: string;
  validFrom: string;
  validTo: string | null;
  reason: string;
  changedById: string;
}

/**
 * A page of a product's price history, newest start first. A person sees the rows of the branches they work in and the
 * business-wide rows; `branchId` (one of theirs, checked by the framework) narrows it to that branch and the
 * business-wide rows.
 */
export async function priceHistory(
  scoped: ScopedDb,
  ph: PhActor,
  input: z.infer<typeof priceHistoryInput> & { branchId?: string },
): Promise<{ items: PriceHistoryRow[]; nextCursor: string | null }> {
  const branches = input.branchId !== undefined ? [input.branchId] : ph.allBranches ? null : ph.branchIds;
  const rows = await scoped.phPrice.findMany({
    where: {
      productId: input.productId,
      ...(input.unitId ? { unitId: input.unitId } : {}),
      ...(input.currency ? { currency: input.currency } : {}),
      ...(branches ? { OR: [{ branchId: null }, { branchId: { in: branches } }] } : {}),
    },
    select: { id: true, productId: true, unitId: true, branchId: true, currency: true, amountMinor: true, validFrom: true, validTo: true, reason: true, changedById: true },
    orderBy: [{ validFrom: 'desc' }, { id: 'desc' }],
    take: input.pageSize + 1,
    ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
  });
  const more = rows.length > input.pageSize;
  const page = more ? rows.slice(0, input.pageSize) : rows;
  return {
    items: page.map((r) => ({
      ...r,
      amountMinor: r.amountMinor.toString(),
      validFrom: r.validFrom.toISOString(),
      validTo: r.validTo ? r.validTo.toISOString() : null,
    })),
    nextCursor: more ? page[page.length - 1]!.id : null,
  };
}
