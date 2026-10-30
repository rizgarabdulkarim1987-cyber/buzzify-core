import { z } from 'zod';
import type { ScopedDb, ScopedTx } from '@/server/data/tenant-db';
import { BulkPriceError, previewBulk, type BulkChange, type BulkRowPreview } from '@/server/domain/pharmacy/bulk-price';
import { assertEnabledCurrency, CurrencyNotEnabledError, parseMoney, type Currency, type PhMoney } from '@/server/domain/pharmacy/money';
import { StudioError } from '@/server/studio/framework/result';
import type { PhActor } from './actor';
import { ListEntryError } from './products';

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
const DAY_MS = 86_400_000;

/**
 * How far ahead a price may be set: at most 90 days from now. A start further out is almost always a typing slip (2062
 * for 2026), and a scheduled price blocks every price that would start before it. Checked on the input and again by the
 * services (a bulk batch's stored start is checked again when it is applied).
 */
export const PRICE_MAX_FUTURE_DAYS = 90;
export const PRICE_TOO_FAR_MESSAGE = 'Choose a start at most 90 days ahead';

/** The largest amount a price may hold, in minor units: below Postgres's BIGINT maximum (9,223,372,036,854,775,807). */
export const PH_MAX_AMOUNT_MINOR = 9_000_000_000_000_000_000n;

const withinHorizon = (date: Date) => date.getTime() <= Date.now() + PRICE_MAX_FUTURE_DAYS * DAY_MS;
const validFrom = z.coerce.date({ error: 'Enter a valid date' }).refine(withinHorizon, PRICE_TOO_FAR_MESSAGE);

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
  /** Archived (inactive) products are left out of the change unless this is true. */
  includeArchived: z.boolean().optional(),
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
/** A start at or before the open price's start; `currentFrom` (ISO) names that start so the form can show it. */
const backdated = (key: { productId: string; unitId: string }, currentFrom: Date, inBulk: boolean) =>
  new StudioError('INVALID', undefined, {
    validFrom: 'Choose a start after the current price’s start',
    phCode: 'PRICE_BACKDATED',
    currentFrom: currentFrom.toISOString(),
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

/** A start the services accept: at most `PRICE_MAX_FUTURE_DAYS` ahead of now. */
function assertHorizon(from: Date): void {
  if (!withinHorizon(from)) throw new StudioError('INVALID', undefined, { validFrom: PRICE_TOO_FAR_MESSAGE, phCode: 'PRICE_TOO_FAR' });
}

/**
 * An amount typed by a person, in minor units: refused for anything `parseMoney` refuses (a sign, a bad grouping, ...)
 * and above `PH_MAX_AMOUNT_MINOR` (the database column would overflow).
 */
function amountOf(text: string, currency: Currency, field: string): bigint {
  const parsed = parseMoney(text, currency);
  if (!parsed) throw new StudioError('INVALID', undefined, { [field]: 'Enter an amount of 0 or more, like 1,250', phCode: 'INVALID_AMOUNT' });
  if (parsed.amount > PH_MAX_AMOUNT_MINOR) throw new StudioError('INVALID', undefined, { [field]: 'Enter a smaller amount', phCode: 'AMOUNT_TOO_LARGE' });
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

/** A new open price row, as `setPrice` and `setFirstPrices` both write it. */
function priceRow(ph: PhActor, key: PriceKey, amountMinor: bigint, from: Date, why: string) {
  return { restaurantId: ph.restaurantId, ...key, amountMinor, validFrom: from, validTo: null, reason: why, changedById: ph.userId };
}

/**
 * Appends the price of `key` from `from`: the open row (if any) must have started before `from`, and is closed at `from`;
 * then the new row is written. `expectedOpenId` (a bulk change) is the open row the preview read earlier in this same
 * transaction; a different one here means another save committed in between, refused `PRICE_CONFLICT`. That check only
 * narrows the window: what makes the write safe is the close itself (`updateMany` on `validTo: null`, count must be 1)
 * and the one-open-row index, each also `PRICE_CONFLICT` when another save got there first.
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
  if (open && from.getTime() <= open.validFrom.getTime()) throw backdated(key, open.validFrom, bulk !== undefined);
  if (open) {
    // The only update a price row ever gets: its validTo, once, from null.
    const closed = await tx.phPrice.updateMany({ where: { id: open.id, validTo: null }, data: { validTo: from } });
    if (closed.count !== 1) throw priceConflict();
  }
  const row = await tx.phPrice.create({ data: priceRow(ph, key, amountMinor, from, why), select: { id: true } });
  return { id: row.id, key, amountMinor, validFrom: from, previous: open };
}

// Writes --------------------------------------------------------------------------------------------------------------

/** Sets one price (the branch must be checked first with `assertPriceBranch`). */
export async function setPrice(tx: ScopedTx, ph: PhActor, input: PriceSetInput): Promise<PriceWrite> {
  assertHorizon(input.validFrom);
  await assertCurrency(tx, input.currency);
  const amountMinor = amountOf(input.amount, input.currency, 'amount');
  const unit = await tx.phProductUnit.findFirst({ where: { id: input.unitId, productId: input.productId }, select: { id: true } });
  if (!unit) throw new StudioError('NOT_FOUND');
  const key: PriceKey = { productId: input.productId, unitId: input.unitId, branchId: input.branchId ?? null, currency: input.currency };
  return appendPrice(tx, ph, key, amountMinor, input.validFrom, input.reason);
}

/**
 * The first price of each of many products (a catalog import writes the products, then their prices): `setPrice`'s
 * checks on every entry (start horizon, enabled currency, the amount as `parseMoney` reads it, a unit of that product)
 * and its row, written together. A key that already has an open price, or that an earlier entry of the list sets, is refused `PRICE_CONFLICT`: closing one is
 * `setPrice`'s. The first refusal by position is thrown as a `ListEntryError`, before any row is written. Branches must
 * be checked first with `assertPriceBranch`.
 */
export async function setFirstPrices(tx: ScopedTx, ph: PhActor, inputs: readonly PriceSetInput[]): Promise<number> {
  if (inputs.length === 0) return 0;
  const enabled = new Map<Currency, unknown>();
  for (const currency of new Set(inputs.map((input) => input.currency))) {
    try {
      await assertCurrency(tx, currency);
    } catch (error) {
      enabled.set(currency, error);
    }
  }
  const unitIds = [...new Set(inputs.map((input) => input.unitId))];
  const units = new Map<string, string>();
  const open = new Set<string>();
  for (let at = 0; at < unitIds.length; at += 5_000) {
    const chunk = unitIds.slice(at, at + 5_000);
    for (const unit of await tx.phProductUnit.findMany({ where: { id: { in: chunk } }, select: { id: true, productId: true } })) units.set(unit.id, unit.productId);
    const rows = await tx.phPrice.findMany({ where: { unitId: { in: chunk }, validTo: null }, select: { productId: true, unitId: true, branchId: true, currency: true } });
    for (const row of rows) open.add([row.productId, row.unitId, row.branchId ?? '', row.currency].join('\n'));
  }
  const data = inputs.map((input, index) => {
    try {
      assertHorizon(input.validFrom);
      if (enabled.has(input.currency)) throw enabled.get(input.currency);
      const amountMinor = amountOf(input.amount, input.currency, 'amount');
      if (units.get(input.unitId) !== input.productId) throw new StudioError('NOT_FOUND');
      const key: PriceKey = { productId: input.productId, unitId: input.unitId, branchId: input.branchId ?? null, currency: input.currency };
      const keyText = [key.productId, key.unitId, key.branchId ?? '', key.currency].join('\n');
      // An open price already stored, or one an earlier entry of this list sets: either way the key is taken.
      if (open.has(keyText)) throw priceConflict();
      open.add(keyText);
      return priceRow(ph, key, amountMinor, input.validFrom, input.reason);
    } catch (error) {
      throw new ListEntryError(index, error);
    }
  });
  for (let at = 0; at < data.length; at += 1_000) await tx.phPrice.createMany({ data: data.slice(at, at + 1_000) });
  return data.length;
}

/** What a stored batch asks for: the bulk input but its date (a column of its own), with the amounts as typed. */
const bulkParams = z.object({
  branchId: ID.nullable(),
  currency: CURRENCY,
  productIds: z.array(ID).nullable(),
  change: bulkPreviewInput.shape.change,
  rounding: bulkPreviewInput.shape.rounding,
  /** Batches stored before this existed read as false. */
  includeArchived: z.boolean().default(false),
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
      ...(params.includeArchived ? {} : { product: { active: true } }),
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
    if (row.after > PH_MAX_AMOUNT_MINOR) {
      throw new StudioError('INVALID', undefined, {
        change: 'This change takes a price above the largest allowed',
        phCode: 'AMOUNT_TOO_LARGE',
        productId: row.productId,
        unitId: row.unitId,
      });
    }
    if (checkDates && from.getTime() <= source.validFrom.getTime()) throw backdated(row, source.validFrom, true);
    return { ...row, openId: source.id, openFrom: source.validFrom };
  });
  return { previewHash: preview.previewHash, rows };
}

/** How long a stored preview may wait to be applied before it is cancelled. */
export const PREVIEW_MAX_AGE_DAYS = 7;

/**
 * Cancels this business's previews (bulk price and catalog import) older than 7 days. Run where a new preview is
 * stored: the list reads of this framework are queries and may not write. Applied, committed and cancelled batches are
 * untouched.
 */
export async function cancelStaleBatches(tx: ScopedTx, now: Date): Promise<{ prices: number; imports: number }> {
  const before = new Date(now.getTime() - PREVIEW_MAX_AGE_DAYS * 86_400_000);
  const prices = await tx.phPriceChangeBatch.updateMany({ where: { status: 'PREVIEW', createdAt: { lt: before } }, data: { status: 'CANCELLED' } });
  const imports = await tx.phImportBatch.updateMany({ where: { status: 'PREVIEWED', createdAt: { lt: before } }, data: { status: 'CANCELLED' } });
  return { prices: prices.count, imports: imports.count };
}

/** Previews a bulk change and stores it as a `PREVIEW` batch (the branch must be checked first). */
export async function previewBulkPrices(
  tx: ScopedTx,
  ph: PhActor,
  input: BulkPreviewInput,
): Promise<{ batchId: string; preview: BulkPreview; params: BulkParams }> {
  assertHorizon(input.validFrom);
  await assertCurrency(tx, input.currency);
  const params: BulkParams = {
    branchId: input.branchId ?? null,
    currency: input.currency,
    productIds: input.productIds ? [...new Set(input.productIds)].sort() : null,
    change: input.change,
    rounding: input.rounding,
    includeArchived: input.includeArchived ?? false,
    reason: input.reason,
  };
  await cancelStaleBatches(tx, new Date());
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
  const parsed = bulkParams.safeParse(batch.change);
  // A batch whose stored change cannot be read (an older version wrote it, or a hand edit) is never guessed at.
  if (!parsed.success) throw new StudioError('INVALID', PREVIEW_STALE_MESSAGE, { phCode: 'BATCH_UNREADABLE' });
  const params = parsed.data;
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

  // A preview may be old: its stored start is checked again against today's horizon.
  assertHorizon(batch.validFrom);
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
    where: { productId: query.productId, unitId: query.unitId, ...validAt(query) },
    select: { branchId: true, amountMinor: true },
    orderBy: { validFrom: 'desc' },
    take: 4,
  });
  const chosen = rows.find((r) => r.branchId !== null) ?? rows[0];
  return chosen ? { amount: chosen.amountMinor, currency: query.currency } : null;
}

/** The rows valid at `at` in `currency`, for the branch and the business, or the business alone when `branchId` is null. */
function validAt(query: { branchId: string | null; currency: Currency; at: Date }) {
  return {
    currency: query.currency,
    validFrom: { lte: query.at },
    AND: [
      { OR: [{ validTo: null }, { validTo: { gt: query.at } }] },
      { OR: query.branchId === null ? [{ branchId: null }] : [{ branchId: query.branchId }, { branchId: null }] },
    ],
  };
}

/**
 * `priceAt` for many product units in one read (a search result page): the same rule, the branch's own row winning.
 * Keyed by `productId:unitId`; a unit with no valid price is absent.
 */
export async function pricesAt(
  scoped: ScopedDb,
  query: { units: readonly { productId: string; unitId: string }[]; branchId: string | null; currency: Currency; at: Date },
): Promise<Map<string, PhMoney>> {
  const found = new Map<string, PhMoney>();
  for (const [key, row] of await priceRowsAt(scoped, query)) found.set(key, { amount: row.amount, currency: query.currency });
  return found;
}

/**
 * `pricesAt` with the id of the price row that applies, so a sale line can record which row it was charged from. Same
 * rule: the branch's own row wins over the business-wide one; keyed by `productId:unitId`.
 */
export async function priceRowsAt(
  scoped: ScopedDb,
  query: { units: readonly { productId: string; unitId: string }[]; branchId: string | null; currency: Currency; at: Date },
): Promise<Map<string, { id: string; amount: bigint }>> {
  const found = new Map<string, { id: string; amount: bigint }>();
  if (query.units.length === 0) return found;
  const wanted = new Set(query.units.map((u) => `${u.productId}:${u.unitId}`));
  const rows = await scoped.phPrice.findMany({
    where: {
      productId: { in: [...new Set(query.units.map((u) => u.productId))] },
      unitId: { in: [...new Set(query.units.map((u) => u.unitId))] },
      ...validAt(query),
    },
    select: { id: true, productId: true, unitId: true, branchId: true, amountMinor: true, validFrom: true },
    orderBy: { validFrom: 'desc' },
  });
  const isBranch = new Set<string>();
  for (const row of rows) {
    const key = `${row.productId}:${row.unitId}`;
    if (!wanted.has(key)) continue;
    // Newest first: the first row of a kind stands, and a branch row replaces a business-wide one.
    if (!found.has(key) || (row.branchId !== null && !isBranch.has(key))) {
      found.set(key, { id: row.id, amount: row.amountMinor });
      if (row.branchId !== null) isBranch.add(key);
    }
  }
  return found;
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
