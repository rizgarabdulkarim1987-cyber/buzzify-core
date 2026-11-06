import { z } from 'zod';
import type { ScopedClient, ScopedDb, ScopedTx } from '@/server/data/tenant-db';
import { normalizeScan } from '@/server/domain/pharmacy/barcode';
import { formatExpiry, utcToday } from '@/server/domain/pharmacy/expiry';
import { parseMoney, type Currency } from '@/server/domain/pharmacy/money';
import { canPh, type PhPermission } from '@/server/domain/pharmacy/permissions';
import { StudioError } from '@/server/studio/framework/result';
import type { PhActor } from './actor';
import { resolveBarcode } from './barcodes';
import { assertPriceBranch, priceRowsAt, setPrice, type PriceWrite } from './prices';
import { assertBranchSettings, createProduct, mayViewCost, productInput, type ProductWrite } from './products';
import { appendDraftLine, confirmReceipt, createDraft, MAX_MINOR, receiptLineInput, type ConfirmResult, type DraftLine } from './receipts';
import { searchProducts } from './search';

/**
 * Fast product entry (Task 13): the services behind `ph.stock.entry.*` and `ph.stock.history`. One entry session is one
 * DRAFT receipt of the existing receiving model per person and branch (its `clientKey` starts with `ENTRY_KEY_PREFIX`),
 * created by the first line and resumed by every later one, until `finishEntryDraft` confirms it through
 * `confirmReceipt`. Quantities are in packets: the product's largest unit. Each line goes through the receipt services'
 * own checks (`createDraft`, `appendDraftLine`); a new product through `createProduct`; a selling price through
 * `setPrice` (the normal price-history row), and only for a role with `price.change`: anyone else's is ignored.
 *
 * Defaults a new product gets beyond its four required fields (name, selling price, quantity, expiry), all accepted by the
 * catalog's own `checkProduct`: no category, no generic name, strength, form or manufacturer, OTC unless the person says it
 * needs a prescription, and a ladder of tablet (1), strip (tablets per strip) and packet (strips x tablets), every unit
 * sellable, with labels `ENTRY_UNIT_LABELS`; a level is dropped when it holds as much as the one below it (1 strip per
 * packet: tablet and packet only; 1 tablet per strip too: one packet unit). The scanned barcode goes on the packet. With no
 * lot typed, the line's lot is `EXP-YYYYMM` of its expiry, so lot-less entries of one product and month share one batch.
 */

export const ENTRY_KEY_PREFIX = 'entry:';
/** The reason on the price-history row a selling price set by entry writes (a record, not a message to translate). */
export const ENTRY_PRICE_REASON = 'fast product entry';
/** The unit names of a product made by entry (the prototype's wording; the catalog editor can rename them). */
export const ENTRY_UNIT_LABELS = { tablet: 'حبة', strip: 'شريط', packet: 'باكيت' } as const;
/** At most this many rows of each kind in a product's history. */
export const HISTORY_LIMIT = 50;

/** The largest whole quantity an `Int` column holds. */
const MAX_INT = 2_147_483_647;
const WHOLE = 'Enter a whole number';
const EXPIRY_FORMAT = 'Enter the expiry as MM/YY';
const id = z.string().min(1).max(64);
const amountText = z.string().trim().max(32, 'Enter a smaller number');
const perPack = z.number(WHOLE).int(WHOLE).min(1, 'Use 1 or more').max(1000, 'Enter a smaller number');

/** The product of an entry line: one already in the catalog, or a new one from the entry form. */
export const entryProductInput = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('known'), productId: id }),
  z.object({
    kind: z.literal('new'),
    tradeName: productInput.shape.tradeName,
    /** The scanned code, put on the packet; null when the product was typed by name. */
    barcode: z.string().max(48, 'Use at most 48 characters').nullish(),
    activeIngredient: productInput.shape.activeIngredient,
    rxLevel: z.enum(['OTC', 'RX']).default('OTC'),
    stripsPerPacket: perPack.default(1),
    tabletsPerStrip: perPack.default(1),
    /** The branch's low-stock level, in packets; none when absent. */
    lowStockPackets: z.number(WHOLE).int(WHOLE).min(0, 'Use 0 or more').max(1_000_000, 'Enter a smaller number').nullish(),
  }),
]);

/** One entry line as the screen sends it (the place comes from the framework). */
export const entryLineInput = z.object({
  /** One line per key: a repeat answers the line the key added. */
  requestKey: z.string().trim().min(8, 'Use at least 8 characters').max(100, 'Use at most 100 characters'),
  product: entryProductInput,
  /** Packets. */
  qty: receiptLineInput.shape.qty,
  expiry: z.object({
    month: z.number(WHOLE).int(WHOLE).min(1, EXPIRY_FORMAT).max(12, EXPIRY_FORMAT),
    year: z.number(WHOLE).int(WHOLE).min(2000, EXPIRY_FORMAT).max(2099, EXPIRY_FORMAT),
  }),
  /** Per packet, in `purchaseCurrency`; required for a known product, optional for a new one (no cost recorded then). */
  purchasePrice: amountText.nullish(),
  purchaseCurrency: z.enum(['IQD', 'USD'], 'Choose IQD or USD').default('USD'),
  /** Per packet, in the pharmacy's sale currency; applied only for a role with `price.change`. */
  sellPrice: amountText.nullish(),
  lot: z.string().trim().max(40, 'Use at most 40 characters').default(''),
  supplierId: id.nullish(),
});
export type EntryLineInput = z.infer<typeof entryLineInput>;

export const entryLookupInput = z.object({
  /** A scanned barcode or a typed name. */
  q: z.string().max(10_000).optional(),
  /** A product picked from a `choose` answer. */
  productId: id.optional(),
});

export const entryFinishInput = z.object({ receiptId: id.optional() });

export const productHistoryInput = z.object({ productId: id });

// Refusals ------------------------------------------------------------------------------------------------------------

const invalid = (field: string, message: string, extra: Record<string, string> = {}) => new StudioError('INVALID', message, { [field]: message, ...extra });
const entryEmpty = () => new StudioError('INVALID', 'Nothing has been entered yet', { phCode: 'ENTRY_EMPTY' });
const receiptNotFound = () => new StudioError('NOT_FOUND', 'Receipt not found');

/** A branch is the place's (checked by the framework); entry and history need one. */
export function entryBranchOf(input: { branchId?: string }): string {
  if (!input.branchId) throw new StudioError('INVALID', 'Choose the branch', { branchId: 'Choose the branch' });
  return input.branchId;
}

const holds = (ph: PhActor, permission: PhPermission) => ph.role !== null && ph.support === null && canPh(ph.role, permission);

/** One person's entry in one branch at a time: the line and finish steps of the same person and branch queue here. */
async function lockEntry(tx: ScopedTx, branchId: string, userId: string): Promise<void> {
  // eslint-disable-next-line no-restricted-properties -- an advisory lock touches no tenant rows: it only serialises one person's entry in one branch
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`ph-entry:${branchId}:${userId}`}))`;
}

/** The person's open entry draft in the branch (newest, should there ever be two). */
async function openDraft(scoped: ScopedDb, branchId: string, userId: string) {
  return scoped.phReceipt.findFirst({
    where: { branchId, createdById: userId, status: 'DRAFT', clientKey: { startsWith: ENTRY_KEY_PREFIX } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { id: true, version: true, supplierId: true, supplierName: true, createdAt: true },
  });
}

/** The sale currency: the pharmacy's default (IQD without a settings row). */
async function saleCurrency(scoped: ScopedDb): Promise<Currency> {
  return (await scoped.phSettings.findFirst({ select: { defaultCurrency: true } }))?.defaultCurrency ?? 'IQD';
}

/** The ladder of a new product: tablet, strip, packet, a level dropped when it holds as much as the one below it. */
export function entryLadder(stripsPerPacket: number, tabletsPerStrip: number) {
  const sizes: [number, string][] = [
    [1, ENTRY_UNIT_LABELS.tablet],
    [tabletsPerStrip, ENTRY_UNIT_LABELS.strip],
    [stripsPerPacket * tabletsPerStrip, ENTRY_UNIT_LABELS.packet],
  ];
  const bySize = new Map<number, string>();
  for (const [size, label] of sizes) bySize.set(size, label);
  return [...bySize.entries()].sort((a, b) => a[0] - b[0]).map(([baseQty, label], level) => ({ level, label, baseQty, sellable: true }));
}

/** An expiry month before the current (UTC) month has passed; the current month is still good, to its last day. */
function assertNotPast(expiry: { month: number; year: number }, now: Date): void {
  const nowYear = now.getUTCFullYear();
  const nowMonth = now.getUTCMonth() + 1;
  if (expiry.year < nowYear || (expiry.year === nowYear && expiry.month < nowMonth)) {
    throw invalid('expiry', 'This expiry date has passed', { phCode: 'EXPIRY_PAST' });
  }
}

/** The purchase price per packet in minor units, or null when none was typed (a new product only). */
function purchaseCostOf(input: EntryLineInput, known: boolean): bigint | null {
  const text = input.purchasePrice?.trim() ?? '';
  if (text === '') {
    if (known) throw invalid('purchasePrice', 'Enter the purchase price');
    return null;
  }
  const parsed = parseMoney(text, input.purchaseCurrency);
  if (!parsed) throw invalid('purchasePrice', 'Enter an amount of 0 or more, like 1,250');
  if (parsed.amount === 0n) throw invalid('purchasePrice', 'Enter a purchase price above 0');
  if (parsed.amount > MAX_MINOR) throw invalid('purchasePrice', 'Enter a smaller amount');
  return parsed.amount;
}

// Views ---------------------------------------------------------------------------------------------------------------

/** A line of the entry draft, for the "entered now" list. */
export interface EntryDraftLine {
  lineNo: number;
  productId: string;
  productName: string;
  /** The product was made after this entry started (the draft is dated from its first request): the list tags it as new. */
  isNew: boolean;
  /** In packets (the line's unit). */
  qty: number;
  unitLabel: string;
  /** 'MM/YYYY' (or 'DD/MM/YYYY' for a day-precise expiry). */
  expiry: string;
  lot: string;
  /** The packet's selling price in the branch now; null when it has none. */
  sellPriceMinor: string | null;
  currency: Currency;
}

async function draftLines(scoped: ScopedDb, args: { receiptId: string; branchId: string; since: Date; now: Date; lineNo?: number }): Promise<EntryDraftLine[]> {
  const rows = await scoped.phReceiptLine.findMany({
    where: { receiptId: args.receiptId, ...(args.lineNo !== undefined ? { lineNo: args.lineNo } : {}) },
    orderBy: { lineNo: 'desc' },
    select: {
      lineNo: true,
      productId: true,
      unitId: true,
      qty: true,
      lot: true,
      expiryDate: true,
      expiryPrecision: true,
      product: { select: { tradeName: true, createdAt: true } },
      unit: { select: { label: true } },
    },
  });
  const currency = await saleCurrency(scoped);
  const prices = await priceRowsAt(scoped, { units: rows.map((r) => ({ productId: r.productId, unitId: r.unitId })), branchId: args.branchId, currency, at: args.now });
  return rows.map((r) => ({
    lineNo: r.lineNo,
    productId: r.productId,
    productName: r.product.tradeName,
    isNew: r.product.createdAt.getTime() >= args.since.getTime(),
    qty: r.qty,
    unitLabel: r.unit.label,
    expiry: formatExpiry({ expiryDate: r.expiryDate.toISOString().slice(0, 10), expiryPrecision: r.expiryPrecision }),
    lot: r.lot,
    sellPriceMinor: prices.get(`${r.productId}:${r.unitId}`)?.amount.toString() ?? null,
    currency,
  }));
}

export interface EntryDraftView {
  draft: {
    receiptId: string;
    version: number;
    /** The entry's supplier: every later line must name the same one (null: none). */
    supplierId: string | null;
    supplierName: string;
    createdAt: string;
    lineCount: number;
    /** Newest first. */
    lines: EntryDraftLine[];
  } | null;
}

/** The person's open entry in the branch, with its lines: what the screen shows after a reload. */
export async function entryDraftView(scoped: ScopedClient, ph: PhActor, args: { branchId: string; now: Date }): Promise<EntryDraftView> {
  const draft = await openDraft(scoped, args.branchId, ph.userId);
  if (!draft) return { draft: null };
  const lines = await draftLines(scoped, { receiptId: draft.id, branchId: args.branchId, since: draft.createdAt, now: args.now });
  return {
    draft: {
      receiptId: draft.id,
      version: draft.version,
      supplierId: draft.supplierId,
      supplierName: draft.supplierName,
      createdAt: draft.createdAt.toISOString(),
      lineCount: lines.length,
      lines,
    },
  };
}

// Lookup --------------------------------------------------------------------------------------------------------------

export interface EntryKnownProduct {
  id: string;
  tradeName: string;
  activeIngredient: string;
  rxLevel: 'OTC' | 'RX' | 'RESTRICTED';
  /** The unit entry counts in: the product's largest. */
  packetUnitId: string;
  packetLabel: string;
  packetBaseQty: number;
  units: { id: string; level: number; label: string; baseQty: number; sellable: boolean }[];
}

export interface EntryLastPurchase {
  receivedOn: string;
  /** Null when that receipt named no supplier record, or the supplier is archived since (it cannot be chosen again). */
  supplierId: string | null;
  supplierName: string;
  /** Per packet; present only for a role with `cost.view`, null when that line had no cost. */
  purchasePriceMinor?: string | null;
  purchaseCurrency?: Currency | null;
}

export type EntryLookup = {
  /** The selling price field is editable (`price.change`); read-only otherwise. */
  canChangePrice: boolean;
  /** A new product may be added (`catalog.manage`). */
  canCreateProduct: boolean;
  /** The sale currency selling prices are in. */
  currency: Currency;
} & (
  | {
      kind: 'known';
      product: EntryKnownProduct;
      /** `available` in the branch, in base units. */
      stockBaseQty: number;
      sellPrice: { amountMinor: string; currency: Currency } | null;
      lastPurchase: EntryLastPurchase | null;
    }
  | { kind: 'choose'; candidates: { productId: string; tradeName: string; packLabel: string }[] }
  | { kind: 'new'; barcode: string | null }
);

/** Rounded half up: `cost` of one `from`-sized unit as the cost of one `to`-sized unit. */
const rescale = (cost: bigint, from: number, to: number) => (cost * BigInt(to) * 2n + BigInt(from)) / (BigInt(from) * 2n);

async function knownOf(scoped: ScopedClient, ph: PhActor, args: { productId: string; branchId: string; currency: Currency; now: Date }) {
  const product = await scoped.phProduct.findFirst({
    where: { id: args.productId, active: true },
    select: { id: true, tradeName: true, activeIngredient: true, rxLevel: true, units: { select: { id: true, level: true, label: true, baseQty: true, sellable: true }, orderBy: { level: 'asc' } } },
  });
  if (!product || product.units.length === 0) throw new StudioError('NOT_FOUND');
  const packet = product.units[product.units.length - 1]!;
  const [stock, prices, last] = await Promise.all([
    scoped.phStockBalance.aggregate({ where: { productId: product.id, branchId: args.branchId }, _sum: { available: true } }),
    priceRowsAt(scoped, { units: [{ productId: product.id, unitId: packet.id }], branchId: args.branchId, currency: args.currency, at: args.now }),
    scoped.phReceiptLine.findFirst({
      where: { productId: product.id, receipt: { branchId: args.branchId, status: 'CONFIRMED' } },
      orderBy: [{ receipt: { confirmedAt: { sort: 'desc', nulls: 'last' } } }, { lineNo: 'desc' }],
      select: {
        unitCostMinor: true,
        costCurrency: true,
        unit: { select: { baseQty: true } },
        receipt: { select: { receivedOn: true, supplierId: true, supplierName: true, supplier: { select: { active: true } } } },
      },
    }),
  ]);
  const price = prices.get(`${product.id}:${packet.id}`);
  const lastPurchase: EntryLastPurchase | null = last
    ? {
        receivedOn: last.receipt.receivedOn.toISOString().slice(0, 10),
        supplierId: last.receipt.supplier?.active ? last.receipt.supplierId : null,
        supplierName: last.receipt.supplierName,
        ...(mayViewCost(ph)
          ? {
              purchasePriceMinor: last.unitCostMinor === null ? null : rescale(last.unitCostMinor, last.unit.baseQty, packet.baseQty).toString(),
              purchaseCurrency: last.costCurrency,
            }
          : {}),
      }
    : null;
  return {
    kind: 'known' as const,
    product: {
      id: product.id,
      tradeName: product.tradeName,
      activeIngredient: product.activeIngredient,
      rxLevel: product.rxLevel,
      packetUnitId: packet.id,
      packetLabel: packet.label,
      packetBaseQty: packet.baseQty,
      units: product.units,
    },
    stockBaseQty: stock._sum.available ?? 0,
    sellPrice: price ? { amountMinor: price.amount.toString(), currency: args.currency } : null,
    lastPurchase,
  };
}

/**
 * What a scan or a typed name is: a known product (a barcode of one active product, a picked product, or a name with one
 * match), a choice (a shared barcode or several names), or new (an unknown barcode, kept for the new product; or a name
 * with no match). The answer never repeats a typed name.
 */
export async function entryLookup(scoped: ScopedClient, ph: PhActor, args: { branchId: string; q?: string; productId?: string; now: Date }): Promise<EntryLookup> {
  const currency = await saleCurrency(scoped);
  const base = { canChangePrice: holds(ph, 'price.change'), canCreateProduct: holds(ph, 'catalog.manage'), currency };
  const known = async (productId: string) => ({ ...base, ...(await knownOf(scoped, ph, { productId, branchId: args.branchId, currency, now: args.now })) });
  if (args.productId) return known(args.productId);

  const text = (args.q ?? '').trim();
  const code = normalizeScan(text);
  if (code === '') return { ...base, kind: 'new', barcode: null };
  const match = await resolveBarcode(scoped, code);
  if (match.kind === 'one') return known(match.productId);
  const toChoice = async (ids: string[]) => {
    const rows = await scoped.phProduct.findMany({
      where: { id: { in: ids }, active: true },
      select: { id: true, tradeName: true, units: { select: { label: true, baseQty: true, level: true }, orderBy: { level: 'desc' }, take: 1 } },
      orderBy: [{ tradeName: 'asc' }, { id: 'asc' }],
    });
    return { ...base, kind: 'choose' as const, candidates: rows.map((r) => ({ productId: r.id, tradeName: r.tradeName, packLabel: r.units[0]?.label ?? '' })) };
  };
  if (match.kind === 'many') return toChoice([...new Set(match.candidates.map((c) => c.productId))]);
  // A code of digits is a barcode: unknown, it is a new product's.
  if (/^\d{4,48}$/.test(code)) return { ...base, kind: 'new', barcode: code };
  const hits = await searchProducts(scoped, { q: text, branchId: args.branchId, limit: 8 });
  const ids = [...new Set(hits.map((h) => h.productId))];
  if (ids.length === 1) return known(ids[0]!);
  if (ids.length > 1) return toChoice(ids);
  return { ...base, kind: 'new', barcode: null };
}

// Writes --------------------------------------------------------------------------------------------------------------

export interface EntryLineResult {
  receiptId: string;
  version: number;
  lineNo: number;
  lineCount: number;
  productId: string;
  /** This request made the product. */
  productCreated: boolean;
  /** This request wrote a new selling price. */
  priceChanged: boolean;
  /** The request key was seen before: nothing was written, the earlier line is answered. */
  replayed: boolean;
  line: EntryDraftLine;
}

/** What an entry line wrote, for the action to audit. */
export interface EntryLineWrite {
  result: EntryLineResult;
  receiptCreated: boolean;
  product: ProductWrite | null;
  price: PriceWrite | null;
}

/** The selling price of the packet, set the way `ph.prices.set` sets it; null when it already is that price. */
async function applySellPrice(
  tx: ScopedTx,
  ph: PhActor,
  args: { branchId: string; productId: string; unitId: string; text: string; now: Date },
): Promise<PriceWrite | null> {
  const currency = await saleCurrency(tx);
  const parsed = parseMoney(args.text, currency);
  if (!parsed) throw invalid('sellPrice', 'Enter an amount of 0 or more, like 1,250');
  const now = await priceRowsAt(tx, { units: [{ productId: args.productId, unitId: args.unitId }], branchId: args.branchId, currency, at: args.now });
  if (now.get(`${args.productId}:${args.unitId}`)?.amount === parsed.amount) return null;
  // The row the cashier charges from stays the one that changes: the branch's own price when it has one; else the
  // business-wide price for an owner of every branch, and a price of this branch for anyone else.
  const own = await tx.phPrice.findFirst({ where: { productId: args.productId, unitId: args.unitId, currency, branchId: args.branchId, validTo: null }, select: { id: true } });
  const branchId = own || !ph.allBranches ? args.branchId : null;
  assertPriceBranch(ph, branchId);
  return setPrice(tx, ph, { productId: args.productId, unitId: args.unitId, currency, amount: args.text, validFrom: args.now, reason: ENTRY_PRICE_REASON, ...(branchId ? { branchId } : {}) });
}

/**
 * Adds one line to the person's entry draft in `branchId` (creating the draft on the first line), and for a new product
 * first makes the product. Everything is checked before anything is written; it all runs in the caller's transaction.
 */
export async function addEntryLine(tx: ScopedTx, ph: PhActor, args: { branchId: string; input: EntryLineInput; now: Date }): Promise<EntryLineWrite> {
  const { branchId, input, now } = args;
  await lockEntry(tx, branchId, ph.userId);

  // A repeated request: the line its key added (in a draft or since confirmed), never a second one.
  const prior = await tx.phReceiptLine.findFirst({
    where: { clientKey: input.requestKey },
    select: { lineNo: true, productId: true, qty: true, receipt: { select: { id: true, version: true, createdById: true, branchId: true, createdAt: true, status: true } } },
  });
  if (prior) {
    const sameLine = prior.qty === input.qty && (input.product.kind === 'new' || input.product.productId === prior.productId);
    if (prior.receipt.createdById !== ph.userId || prior.receipt.branchId !== branchId || !sameLine) {
      throw new StudioError('CONFLICT', 'This key was already used for a different receipt', { phCode: 'CLIENT_KEY_MISMATCH' });
    }
    // The line's receipt was voided since: the line is gone, not saved.
    if (prior.receipt.status === 'VOID') throw new StudioError('CONFLICT', 'Only a draft receipt can change', { phCode: 'NOT_DRAFT' });
    const [line] = await draftLines(tx, { receiptId: prior.receipt.id, branchId, since: prior.receipt.createdAt, now, lineNo: prior.lineNo });
    const lineCount = await tx.phReceiptLine.count({ where: { receiptId: prior.receipt.id } });
    return {
      result: { receiptId: prior.receipt.id, version: prior.receipt.version, lineNo: prior.lineNo, lineCount, productId: prior.productId, productCreated: false, priceChanged: false, replayed: true, line: line! },
      receiptCreated: false,
      product: null,
      price: null,
    };
  }

  // Checks first: nothing is written until the line is known to be acceptable.
  const isNew = input.product.kind === 'new';
  if (isNew && !holds(ph, 'catalog.manage')) throw new StudioError('FORBIDDEN');
  assertNotPast(input.expiry, now);
  const unitCostMinor = purchaseCostOf(input, !isNew);
  const mayPrice = holds(ph, 'price.change');
  const sellText = mayPrice ? (input.sellPrice?.trim() ?? '') : '';
  if (mayPrice && isNew && sellText === '') throw invalid('sellPrice', 'Enter the selling price');
  const draft = await openDraft(tx, branchId, ph.userId);
  const supplierId = input.supplierId ?? null;
  if (draft && draft.supplierId !== supplierId) {
    throw new StudioError('CONFLICT', 'This entry is for another supplier: finish it first', { phCode: 'SUPPLIER_DIFFERS', supplierId: 'This entry is for another supplier: finish it first' });
  }

  let product: ProductWrite | null = null;
  let packet: { id: string; baseQty: number };
  let productId: string;
  if (input.product.kind === 'known') {
    const found = await tx.phProduct.findFirst({
      where: { id: input.product.productId, active: true },
      select: { id: true, units: { select: { id: true, baseQty: true }, orderBy: { level: 'desc' }, take: 1 } },
    });
    if (!found || found.units.length === 0) throw invalid('product.productId', 'Choose one of this pharmacy’s active products');
    productId = found.id;
    packet = found.units[0]!;
  } else {
    const p = input.product;
    const levels = entryLadder(p.stripsPerPacket, p.tabletsPerStrip);
    const top = levels[levels.length - 1]!;
    const code = p.barcode ? normalizeScan(p.barcode) : '';
    const minQty = (p.lowStockPackets ?? 0) * top.baseQty;
    if (minQty > 1_000_000) throw invalid('product.lowStockPackets', 'Enter a smaller number');
    const settings = minQty > 0 ? [{ branchId, minQty, reorderQty: 0 }] : [];
    assertBranchSettings(ph, settings);
    const catalogInput = productInput.parse({
      tradeName: p.tradeName,
      activeIngredient: p.activeIngredient,
      rxLevel: p.rxLevel,
      levels,
      barcodes: code === '' ? [] : [{ code, level: top.level }],
      branchSettings: settings,
    });
    if (input.qty * top.baseQty > MAX_INT) throw invalid('qty', 'Enter a smaller number');
    product = await createProduct(tx, ph.restaurantId, catalogInput);
    productId = product.id;
    packet = await tx.phProductUnit.findFirstOrThrow({ where: { productId, level: top.level }, select: { id: true, baseQty: true } });
  }
  if (input.qty * packet.baseQty > MAX_INT) throw invalid('qty', 'Enter a smaller number');

  const month = String(input.expiry.month).padStart(2, '0');
  const line: DraftLine = {
    productId,
    unitId: packet.id,
    qty: input.qty,
    bonusQty: 0,
    // A line without a cost gets a lot of its own by default, so its costless batch never shares a batch with costed stock.
    lot: (input.lot === '' ? `EXP-${input.expiry.year}${month}${unitCostMinor === null ? '-NC' : ''}` : input.lot).toUpperCase(),
    expiry: `${month}/${input.expiry.year}`,
    unitCostMinor,
    currency: unitCostMinor === null ? null : input.purchaseCurrency,
    freeOfCharge: false,
    acceptExpired: false,
    clientKey: input.requestKey,
  };

  let written: { id: string; version: number; lineNo: number; lineCount: number; createdAt: Date };
  if (draft) {
    const added = await appendDraftLine(tx, { restaurantId: ph.restaurantId, receiptId: draft.id, line });
    written = { ...added, createdAt: draft.createdAt };
  } else {
    const made = await createDraft(tx, {
      restaurantId: ph.restaurantId,
      branchId,
      clientKey: `${ENTRY_KEY_PREFIX}${input.requestKey}`,
      userId: ph.userId,
      input: { supplierName: '', ...(supplierId ? { supplierId } : {}), reference: '', receivedOn: utcToday(now), note: '', lines: [line] },
      // The entry starts when this request did: a product it made just now counts as new in the "entered now" list.
      createdAt: now,
    });
    written = { id: made.id, version: made.version, lineNo: 1, lineCount: made.lineCount, createdAt: now };
  }

  const price = sellText === '' ? null : await applySellPrice(tx, ph, { branchId, productId, unitId: packet.id, text: sellText, now });
  const [view] = await draftLines(tx, { receiptId: written.id, branchId, since: written.createdAt, now, lineNo: written.lineNo });
  return {
    result: {
      receiptId: written.id,
      version: written.version,
      lineNo: written.lineNo,
      lineCount: written.lineCount,
      productId,
      productCreated: product !== null,
      priceChanged: price !== null,
      replayed: false,
      line: view!,
    },
    receiptCreated: !draft,
    product,
    price,
  };
}

/** How long after a Finish a repeat without a receipt id is answered with the entry it posted. */
const FINISH_REPEAT_MS = 60_000;

export type EntryFinishResult =
  | (ConfirmResult & { replayed: false })
  | { id: string; status: 'CONFIRMED'; number: string | null; lines: number; baseQty: number; warnings: []; replayed: true };

/**
 * Confirms the person's entry draft in `branchId` (or the one `receiptId` names, which must be their own entry there) into
 * stock, once: a repeat for a receipt already confirmed answers it again and changes nothing. Nothing entered is refused.
 */
export async function finishEntryDraft(tx: ScopedTx, ph: PhActor, args: { branchId: string; receiptId?: string; now: Date }): Promise<EntryFinishResult> {
  await lockEntry(tx, args.branchId, ph.userId);
  const select = { id: true, branchId: true, createdById: true, clientKey: true, status: true, number: true } as const;
  const mine = { branchId: args.branchId, createdById: ph.userId, clientKey: { startsWith: ENTRY_KEY_PREFIX } };
  const head = args.receiptId
    ? await tx.phReceipt.findFirst({ where: { id: args.receiptId }, select })
    : ((await tx.phReceipt.findFirst({ where: { ...mine, status: 'DRAFT' }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select })) ??
      // No open entry: a repeat of a Finish just done (a double click) answers the entry it posted, not "nothing entered".
      (await tx.phReceipt.findFirst({
        where: { ...mine, status: 'CONFIRMED', confirmedAt: { gte: new Date(args.now.getTime() - FINISH_REPEAT_MS) } },
        orderBy: [{ confirmedAt: 'desc' }, { id: 'desc' }],
        select,
      })));
  if (!head) {
    if (args.receiptId) throw receiptNotFound();
    throw entryEmpty();
  }
  if (head.createdById !== ph.userId || head.branchId !== args.branchId || !head.clientKey.startsWith(ENTRY_KEY_PREFIX)) throw receiptNotFound();
  if (head.status === 'CONFIRMED') {
    const sum = await tx.phReceiptLine.aggregate({ where: { receiptId: head.id }, _count: { _all: true }, _sum: { baseQty: true } });
    return { id: head.id, status: 'CONFIRMED', number: head.number, lines: sum._count._all, baseQty: sum._sum.baseQty ?? 0, warnings: [], replayed: true };
  }
  if (head.status !== 'DRAFT') throw new StudioError('CONFLICT', 'Only a draft receipt can change', { phCode: 'NOT_DRAFT' });
  if ((await tx.phReceiptLine.count({ where: { receiptId: head.id } })) === 0) throw entryEmpty();
  const done = await confirmReceipt(tx, { restaurantId: ph.restaurantId, receiptId: head.id, userId: ph.userId, now: args.now });
  return { ...done, replayed: false };
}

// History -------------------------------------------------------------------------------------------------------------

export interface HistoryPurchase {
  receiptNumber: string | null;
  receivedOn: string;
  supplierName: string;
  qty: number;
  bonusQty: number;
  unitLabel: string;
  lot: string;
  expiryDate: string;
  expiryPrecision: 'DAY' | 'MONTH';
  /** Present only for a role with `cost.view`: per `unitLabel`, null when the line had no cost. */
  unitCostMinor?: string | null;
  currency?: Currency | null;
}

export interface HistorySale {
  saleNumber: string | null;
  soldAt: string;
  unitLabel: string;
  qty: number;
  unitPriceMinor: string;
  totalMinor: string;
  currency: Currency;
}

export interface HistoryReturn {
  returnNumber: string | null;
  returnedAt: string;
  /** The unit the item was sold in, and the quantity in it when the returned base units make whole ones (else null). */
  unitLabel: string;
  qty: number | null;
  baseQty: number;
  refundMinor: string;
  currency: Currency;
  reason: string;
}

export interface ProductHistory {
  purchases: HistoryPurchase[];
  sales: HistorySale[];
  returns: HistoryReturn[];
}

/**
 * One product's purchases (confirmed receipt lines), sales (completed, also when returned since) and returns in one branch,
 * newest first, at most `HISTORY_LIMIT` of each. A purchase's cost is shown only to a role with `cost.view`.
 */
export async function readProductHistory(scoped: ScopedClient, ph: PhActor, args: { productId: string; branchId: string }): Promise<ProductHistory> {
  const product = await scoped.phProduct.findFirst({ where: { id: args.productId }, select: { id: true } });
  if (!product) throw new StudioError('NOT_FOUND');
  const withCost = mayViewCost(ph);
  const [purchases, sales, returns] = await Promise.all([
    scoped.phReceiptLine.findMany({
      where: { productId: product.id, receipt: { branchId: args.branchId, status: 'CONFIRMED' } },
      orderBy: [{ receipt: { confirmedAt: { sort: 'desc', nulls: 'last' } } }, { receiptId: 'desc' }, { lineNo: 'asc' }],
      take: HISTORY_LIMIT,
      select: {
        qty: true,
        bonusQty: true,
        lot: true,
        expiryDate: true,
        expiryPrecision: true,
        unitCostMinor: true,
        costCurrency: true,
        unit: { select: { label: true } },
        receipt: { select: { number: true, receivedOn: true, supplierName: true } },
      },
    }),
    scoped.phSaleLine.findMany({
      where: { productId: product.id, sale: { branchId: args.branchId, status: { in: ['COMPLETED', 'RETURNED_PARTIAL', 'RETURNED_FULL'] } } },
      orderBy: [{ sale: { completedAt: { sort: 'desc', nulls: 'last' } } }, { id: 'desc' }],
      take: HISTORY_LIMIT,
      select: { qty: true, unitPriceMinor: true, totalMinor: true, unit: { select: { label: true } }, sale: { select: { number: true, completedAt: true, createdAt: true, currency: true } } },
    }),
    scoped.phReturnLine.findMany({
      where: { return: { branchId: args.branchId }, allocation: { saleLine: { productId: product.id } } },
      orderBy: [{ return: { createdAt: 'desc' } }, { id: 'desc' }],
      take: HISTORY_LIMIT,
      select: {
        baseQty: true,
        refundMinor: true,
        return: { select: { number: true, createdAt: true, currency: true, reason: true } },
        allocation: { select: { saleLine: { select: { unit: { select: { label: true, baseQty: true } } } } } },
      },
    }),
  ]);
  return {
    purchases: purchases.map((p) => ({
      receiptNumber: p.receipt.number,
      receivedOn: p.receipt.receivedOn.toISOString().slice(0, 10),
      supplierName: p.receipt.supplierName,
      qty: p.qty,
      bonusQty: p.bonusQty,
      unitLabel: p.unit.label,
      lot: p.lot,
      expiryDate: p.expiryDate.toISOString().slice(0, 10),
      expiryPrecision: p.expiryPrecision,
      ...(withCost ? { unitCostMinor: p.unitCostMinor === null ? null : p.unitCostMinor.toString(), currency: p.costCurrency } : {}),
    })),
    sales: sales.map((s) => ({
      saleNumber: s.sale.number,
      soldAt: (s.sale.completedAt ?? s.sale.createdAt).toISOString(),
      unitLabel: s.unit.label,
      qty: s.qty,
      unitPriceMinor: s.unitPriceMinor.toString(),
      totalMinor: s.totalMinor.toString(),
      currency: s.sale.currency,
    })),
    returns: returns.map((r) => {
      const unit = r.allocation.saleLine.unit;
      return {
        returnNumber: r.return.number,
        returnedAt: r.return.createdAt.toISOString(),
        unitLabel: unit.label,
        qty: r.baseQty % unit.baseQty === 0 ? r.baseQty / unit.baseQty : null,
        baseQty: r.baseQty,
        refundMinor: r.refundMinor.toString(),
        currency: r.return.currency,
        reason: r.return.reason,
      };
    }),
  };
}
