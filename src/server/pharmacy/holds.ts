import { z } from 'zod';
import type { ScopedClient, ScopedTx } from '@/server/data/tenant-db';
import { effectiveDiscount, invoiceDiscountAllocation, lineGross } from '@/server/domain/pharmacy/sale';
import { toBase } from '@/server/domain/pharmacy/stock';
import { StudioError } from '@/server/studio/framework/result';
import type { PhActor } from './actor';
import { priceRowsAt } from './prices';
import { conflict, discountOf, invalid, math, NS_KEY, payloadHash, saleInput } from './sales';

/**
 * Held carts (phase 3, task 3b). A hold is a `PhSale` with status HELD: its lines and prices as they were when it was
 * held, `heldUntil` = 24 hours on, and nothing else. It moves NO stock (no allocation, no movement, no reservation),
 * takes no payment, has no number and posts no cash. Prices are shown at hold time and RE-resolved when the cart is
 * completed (R3-2: the price of a sale is the price at sale time), and every permission rule (rx.dispense, discounts,
 * overrides) is judged then, by the person who completes it, through `createSale`.
 *
 * Holds belong to the branch (R3-8): any seller of the branch may resume, discard or complete one. Completing is
 * `ph.sales.create` with `fromHoldId`: the hold is deleted in that transaction by a guarded delete (see sales.ts), and the
 * cash goes into the completer's own shift. Discarding deletes the hold (a hold has no financial meaning, so nothing is
 * kept). There is no worker: an expired hold is filtered on read, and flipped to HOLD_EXPIRED lazily (a new hold in the
 * branch, or a resume).
 *
 * `holdPayload` keeps the cart as entered (money as decimal text) so a resume returns it unchanged; the lines are the
 * priced view used for the list and the totals. A key replay that arrives after the hold was completed or discarded finds
 * nothing and makes a new hold (the key is free again): the hold is not the sale, and a hold is cheap and expires.
 */

export const HOLD_HOURS = 24;
const HOUR_MS = 3_600_000;
const MAX_INT = 2_147_483_647;
/** The held-cart list shows this many, newest first, and says when there are more. */
export const HOLD_LIST_MAX = 100;

export const holdInput = saleInput.omit({ payments: true, fromHoldId: true });
export type HoldInput = z.infer<typeof holdInput>;
export const holdIdInput = z.object({ saleId: z.string().min(1).max(64) });

/**
 * The cart as stored: what the person entered, without the key and without the place (the business and branch are columns of
 * the row; the action's input carries them, and a later read must not trust a copy).
 */
function cartOf(input: HoldInput): HoldInput {
  const cart: Record<string, unknown> = { ...input };
  for (const field of ['clientKey', 'restaurantId', 'branchId']) delete cart[field];
  return cart as HoldInput;
}

/**
 * What a stored payload must look like to be handed back to the screen: a list of lines that each name a product and a unit,
 * and an invoice discount that is an object when there is one. Anything else is a damaged row. The rest of each line (price,
 * discount, reasons) is the cart as entered and goes back as it was: the sale judges it again when it is completed.
 */
const storedLine = z.looseObject({ productId: z.string().min(1), unitId: z.string().min(1), qty: z.number().int() });
const storedPayload = z.looseObject({ lines: z.array(storedLine).min(1), invoiceDiscount: z.looseObject({}).optional() });

const holdHash = (input: HoldInput) => payloadHash({ ...input, payments: [] });
type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
/** Plain JSON for the column: money (bigint) as decimal text, undefined keys dropped. */
const wire = (value: unknown) => JSON.parse(JSON.stringify(value, (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v))) as { [key: string]: Json };

export interface HoldResult {
  id: string;
  status: 'HELD' | 'HOLD_EXPIRED';
  number: null;
  branchId: string;
  currency: 'IQD' | 'USD';
  subtotalMinor: string;
  discountMinor: string;
  totalMinor: string;
  lineCount: number;
  heldUntil: string;
  replayed: boolean;
}

/** Holds a cart in the caller's transaction. Returns the answer and, for a new hold, what to audit (null for a replay). */
export async function createHold(
  tx: ScopedTx,
  args: { ph: PhActor; branchId: string; input: HoldInput; now?: Date },
): Promise<{ result: HoldResult; audit: { branchId: string; currency: 'IQD' | 'USD'; totalMinor: string; lineCount: number } | null }> {
  const { ph, branchId, input } = args;
  const now = args.now ?? new Date();
  if (ph.role === null || ph.support !== null) throw new StudioError('FORBIDDEN');
  const restaurantId = ph.restaurantId;
  const hash = holdHash(input);

  // The same key lock as a sale: a hold, a sale and a repeat of either share one key space.
  // eslint-disable-next-line no-restricted-properties -- an advisory lock touches no tenant rows: it only serialises one key
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${NS_KEY}::int, hashtext(${`${restaurantId}:${input.clientKey}`}))`;
  const earlier = await tx.phSale.findFirst({
    where: { clientKey: input.clientKey },
    select: { id: true, status: true, branchId: true, currency: true, soldById: true, payloadHash: true, subtotalMinor: true, discountMinor: true, totalMinor: true, heldUntil: true, _count: { select: { lines: true } } },
  });
  if (earlier) {
    if (earlier.branchId !== branchId || earlier.soldById !== ph.userId || earlier.payloadHash !== hash || (earlier.status !== 'HELD' && earlier.status !== 'HOLD_EXPIRED') || !earlier.heldUntil) {
      throw conflict('CLIENT_KEY_MISMATCH', 'This key was already used for a different sale');
    }
    return {
      result: {
        id: earlier.id,
        status: earlier.status,
        number: null,
        branchId,
        currency: earlier.currency,
        subtotalMinor: String(earlier.subtotalMinor),
        discountMinor: String(earlier.discountMinor),
        totalMinor: String(earlier.totalMinor),
        lineCount: earlier._count.lines,
        heldUntil: earlier.heldUntil.toISOString(),
        replayed: true,
      },
      audit: null,
    };
  }

  // Lazy clean-up of this branch's holds that ran out.
  await tx.phSale.updateMany({ where: { branchId, status: 'HELD', heldUntil: { lte: now } }, data: { status: 'HOLD_EXPIRED' } });

  // The holder's open shift anchors the row (the sale table needs one); its currency must be the cart's.
  const shift = await tx.phShift.findFirst({ where: { branchId, userId: ph.userId, status: 'OPEN' }, select: { id: true, currency: true } });
  if (!shift) throw conflict('NO_OPEN_SHIFT', 'Open a shift before selling');
  if (shift.currency !== input.currency) throw conflict('SHIFT_CURRENCY', 'Your open shift is in another currency');

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
    let baseQty: number;
    try {
      baseQty = toBase(line.qty, unit.baseQty);
    } catch {
      throw invalid(`lines.${index}.qty`, 'Enter a smaller number');
    }
    if (baseQty > MAX_INT) throw invalid(`lines.${index}.qty`, 'Enter a smaller number');
    return { index, line, product, baseQty };
  });

  const listed = await priceRowsAt(tx, { units: draft.map((d) => ({ productId: d.line.productId, unitId: d.line.unitId })), branchId, currency: input.currency, at: now });
  const prepared = draft.map(({ index, line, baseQty }) => {
    const row = listed.get(`${line.productId}:${line.unitId}`);
    if (!row) {
      throw invalid(`lines.${index}.unitId`, 'This product has no price in this currency', 'NO_PRICE', { productId: line.productId });
    }
    // A typed price is kept for the preview; whether the completer may use it is judged at completion.
    const unitPriceMinor = line.unitPriceMinor !== undefined ? line.unitPriceMinor : row.amount;
    const priceId = line.unitPriceMinor !== undefined && line.unitPriceMinor !== row.amount ? null : row.id;
    const grossMinor = math(`lines.${index}.unitPriceMinor`, () => lineGross(BigInt(line.qty), unitPriceMinor));
    const lineDiscountMinor = discountOf(grossMinor, line.discount, `lines.${index}.discount`);
    return { index, line, baseQty, unitPriceMinor, priceId, grossMinor, lineDiscountMinor, invoiceShareMinor: 0n };
  });

  const afterLines = prepared.map((l) => ({ totalMinor: l.grossMinor - l.lineDiscountMinor }));
  const invoiceDiscountMinor = discountOf(
    afterLines.reduce((sum, l) => sum + l.totalMinor, 0n),
    input.invoiceDiscount,
    'invoiceDiscount',
  );
  const shares = math('invoiceDiscount.value', () => invoiceDiscountAllocation(afterLines, invoiceDiscountMinor));
  prepared.forEach((l, i) => {
    l.invoiceShareMinor = shares[i]!;
  });
  const effective = math('invoiceDiscount.value', () =>
    effectiveDiscount({ lines: prepared.map((l) => ({ grossMinor: l.grossMinor, lineDiscountMinor: l.lineDiscountMinor })), invoiceDiscountMinor }),
  );
  // No rounding on a hold: the invoice rounding is applied when the sale is made.
  const subtotalMinor = effective.grossMinor;
  const discountMinor = prepared.reduce((sum, l) => sum + l.lineDiscountMinor + l.invoiceShareMinor, 0n);
  const totalMinor = subtotalMinor - discountMinor;
  const heldUntil = new Date(now.getTime() + HOLD_HOURS * HOUR_MS);

  const created = await tx.phSale.create({
    data: {
      restaurantId,
      branchId,
      shiftId: shift.id,
      number: null,
      status: 'HELD',
      currency: input.currency,
      subtotalMinor,
      discountMinor,
      roundingMinor: 0n,
      totalMinor,
      paidMinor: 0n,
      changeMinor: 0n,
      clientKey: input.clientKey,
      payloadHash: hash,
      soldById: ph.userId,
      heldUntil,
      note: input.note,
      createdAt: now,
      holdPayload: wire(cartOf(input)),
    },
    select: { id: true },
  });
  await tx.phSaleLine.createMany({
    data: prepared.map((l, i) => {
      const lineDiscountTotal = l.lineDiscountMinor + l.invoiceShareMinor;
      return {
        restaurantId,
        saleId: created.id,
        lineNo: i + 1,
        productId: l.line.productId,
        unitId: l.line.unitId,
        priceId: l.priceId,
        qty: l.line.qty,
        baseQty: l.baseQty,
        unitPriceMinor: l.unitPriceMinor,
        discountMinor: lineDiscountTotal,
        totalMinor: l.grossMinor - lineDiscountTotal,
        rxLevel: productById.get(l.line.productId)!.rxLevel,
      };
    }),
  });

  return {
    result: {
      id: created.id,
      status: 'HELD',
      number: null,
      branchId,
      currency: input.currency,
      subtotalMinor: String(subtotalMinor),
      discountMinor: String(discountMinor),
      totalMinor: String(totalMinor),
      lineCount: prepared.length,
      heldUntil: heldUntil.toISOString(),
      replayed: false,
    },
    audit: { branchId, currency: input.currency, totalMinor: String(totalMinor), lineCount: prepared.length },
  };
}

// Resume ----------------------------------------------------------------------------------------------------------------

export interface ResumedCart {
  saleId: string;
  branchId: string;
  currency: 'IQD' | 'USD';
  note: string;
  heldUntil: string;
  heldById: string;
  invoiceDiscount?: unknown;
  lines: Record<string, unknown>[];
}

const notFound = () => new StudioError('NOT_FOUND', 'Held cart not found');
const notAvailable = () => conflict('HOLD_NOT_AVAILABLE', 'This held cart was already used or discarded');

/**
 * The hold as a cart for the screen to edit; the hold itself stays until it is completed or discarded. `{ expired: true }`
 * after flipping an ended hold to HOLD_EXPIRED: the caller commits that and then answers HOLD_EXPIRED (a throw here would
 * roll the flip back).
 */
export async function resumeHold(tx: ScopedTx, args: { branchId: string; saleId: string; now?: Date }): Promise<{ expired: true } | { expired: false; cart: ResumedCart }> {
  const now = args.now ?? new Date();
  const hold = await tx.phSale.findFirst({
    where: { id: args.saleId, branchId: args.branchId },
    select: {
      id: true,
      status: true,
      currency: true,
      note: true,
      heldUntil: true,
      soldById: true,
      holdPayload: true,
      lines: { orderBy: { lineNo: 'asc' }, select: { productId: true, unitId: true, qty: true, product: { select: { tradeName: true } } } },
    },
  });
  if (!hold) throw notFound();
  if (hold.status === 'HOLD_EXPIRED') return { expired: true };
  if (hold.status !== 'HELD' || !hold.heldUntil) throw notAvailable();
  if (hold.heldUntil.getTime() <= now.getTime()) {
    await tx.phSale.updateMany({ where: { id: hold.id, status: 'HELD' }, data: { status: 'HOLD_EXPIRED' } });
    return { expired: true };
  }
  const names = hold.lines.map((l) => l.product.tradeName);
  // No payload: a hold made before it was kept, resumed from its lines. A payload that does not read as a cart is damaged.
  let stored: z.infer<typeof storedPayload> | null = null;
  if (hold.holdPayload !== null) {
    const read = storedPayload.safeParse(hold.holdPayload);
    if (!read.success) throw notAvailable();
    stored = read.data;
  }
  const lines =
    stored && stored.lines.length === hold.lines.length
      ? stored.lines.map((l, i) => ({ ...(l as Record<string, unknown>), tradeName: names[i]! }))
      : hold.lines.map((l) => ({ productId: l.productId, unitId: l.unitId, qty: l.qty, tradeName: l.product.tradeName }));
  return {
    expired: false,
    cart: {
      saleId: hold.id,
      branchId: args.branchId,
      currency: hold.currency,
      note: hold.note,
      heldUntil: hold.heldUntil.toISOString(),
      heldById: hold.soldById,
      ...(stored?.invoiceDiscount ? { invoiceDiscount: stored.invoiceDiscount } : {}),
      lines,
    },
  };
}

// Discard ---------------------------------------------------------------------------------------------------------------

/** Deletes a hold (and its lines) by a guarded delete; a hold already completed, discarded or never there is refused. */
export async function discardHold(tx: ScopedTx, args: { branchId: string; saleId: string }): Promise<{ lineCount: number; totalMinor: string }> {
  const hold = await tx.phSale.findFirst({
    where: { id: args.saleId, branchId: args.branchId },
    select: { id: true, status: true, totalMinor: true, _count: { select: { lines: true } } },
  });
  if (!hold) throw notFound();
  const removed = await tx.phSale.deleteMany({ where: { id: hold.id, branchId: args.branchId, status: { in: ['HELD', 'HOLD_EXPIRED'] } } });
  if (removed.count !== 1) throw notAvailable();
  return { lineCount: hold._count.lines, totalMinor: String(hold.totalMinor) };
}

// List ------------------------------------------------------------------------------------------------------------------

export const holdListInput = z.object({});

export interface HoldSummary {
  id: string;
  branchId: string;
  currency: 'IQD' | 'USD';
  lineCount: number;
  totalPreviewMinor: string;
  heldById: string;
  mine: boolean;
  createdAt: string;
  heldUntil: string;
}

/** The branch's live holds (not expired), newest first, at most HOLD_LIST_MAX with `hasMore` when there are more. Expired ones are only filtered here, not changed. */
export async function listHolds(scoped: ScopedClient, ph: PhActor, input: { branchId: string; now?: Date }): Promise<{ items: HoldSummary[]; hasMore: boolean }> {
  if (ph.role === null || ph.support !== null) throw new StudioError('FORBIDDEN');
  const now = input.now ?? new Date();
  const rows = await scoped.phSale.findMany({
    where: { branchId: input.branchId, status: 'HELD', heldUntil: { gt: now } },
    select: { id: true, branchId: true, currency: true, totalMinor: true, soldById: true, createdAt: true, heldUntil: true, _count: { select: { lines: true } } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: HOLD_LIST_MAX + 1,
  });
  return {
    hasMore: rows.length > HOLD_LIST_MAX,
    items: rows.slice(0, HOLD_LIST_MAX).map((r) => ({
      id: r.id,
      branchId: r.branchId,
      currency: r.currency,
      lineCount: r._count.lines,
      totalPreviewMinor: String(r.totalMinor),
      heldById: r.soldById,
      mine: r.soldById === ph.userId,
      createdAt: r.createdAt.toISOString(),
      heldUntil: r.heldUntil!.toISOString(),
    })),
  };
}
