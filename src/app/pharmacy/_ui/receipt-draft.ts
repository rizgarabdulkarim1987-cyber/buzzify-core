import { normalizeScan } from '@/server/domain/pharmacy/barcode';
import { formatExpiry, parseExpiry, utcToday, type ExpiryPrecision } from '@/server/domain/pharmacy/expiry';
import { parseMoney, type Currency } from '@/server/domain/pharmacy/money';
import type { ReceiptDetail } from '@/server/pharmacy/receipts';
import { wholeOf } from './product-draft';

/**
 * The receipt form's value, kept as typed (numbers and dates as text) so a draft restores exactly. It is what `useDraft`
 * stores on the device; the server keeps its own copy of the draft when the person saves.
 */
export interface UnitChoice {
  id: string;
  label: string;
  baseQty: number;
}

export interface LineDraft {
  /** Stable within the form, so a row keeps its fields when another is removed. */
  key: string;
  productId: string;
  productName: string;
  /** Strength, form and pack, to tell 500 mg from 1000 mg. */
  productMeta: string;
  units: UnitChoice[];
  unitId: string;
  qty: string;
  bonusQty: string;
  lot: string;
  expiry: string;
  cost: string;
  currency: Currency;
  freeOfCharge: boolean;
  acceptExpired: boolean;
  /** Phase 4: the order line this line answers (receipts against an order only). */
  purchaseOrderLineId?: string;
}

export interface ReceiptDraft {
  /** The saved receipt's version the draft was made on (0 before the first save). */
  version: number;
  /** Idempotency key of the first save: a retry after a dropped connection makes one receipt. */
  clientKey: string;
  supplierName: string;
  reference: string;
  receivedOn: string;
  note: string;
  lines: LineDraft[];
  /** Phase 4: receiving against this order; the supplier then is the order's and cannot change. */
  purchaseOrderId?: string;
  purchaseOrderNumber?: string;
  supplierId?: string;
}

const newKey = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `k-${Date.now()}-${Math.random().toString(36).slice(2)}`;
export { newKey };

export function emptyDraft(clientKey: string, today: string): ReceiptDraft {
  return { version: 0, clientKey, supplierName: '', reference: '', receivedOn: today, note: '', lines: [] };
}

/** A saved draft receipt as the form's value. The unit ladders come from `unitsOf` (the catalog), by product. */
export function draftOfReceipt(receipt: ReceiptDetail, unitsOf: Record<string, { meta: string; units: UnitChoice[] }>, currency: Currency): ReceiptDraft {
  return {
    version: receipt.version,
    clientKey: newKey(),
    supplierName: receipt.supplierName,
    reference: receipt.reference,
    receivedOn: receipt.receivedOn,
    note: receipt.note,
    ...(receipt.purchaseOrderId ? { purchaseOrderId: receipt.purchaseOrderId, purchaseOrderNumber: receipt.purchaseOrderNumber ?? '' } : {}),
    ...(receipt.supplierId ? { supplierId: receipt.supplierId } : {}),
    lines: receipt.lines.map((l) => ({
      key: `l${l.lineNo}`,
      productId: l.productId,
      productName: l.productName,
      productMeta: unitsOf[l.productId]?.meta ?? '',
      units: unitsOf[l.productId]?.units ?? [{ id: l.unitId, label: l.unitLabel, baseQty: 1 }],
      unitId: l.unitId,
      qty: String(l.qty),
      bonusQty: String(l.bonusQty),
      lot: l.lot,
      expiry: formatExpiry({ expiryDate: l.expiryDate, expiryPrecision: l.expiryPrecision }),
      cost: l.unitCostMinor == null ? '' : minorToText(BigInt(l.unitCostMinor), l.currency ?? currency),
      currency: l.currency ?? currency,
      freeOfCharge: l.freeOfCharge,
      acceptExpired: l.acceptExpired,
      ...(l.purchaseOrderLineId ? { purchaseOrderLineId: l.purchaseOrderLineId } : {}),
    })),
  };
}

/** Minor units as the text a person would type back: IQD whole, USD with two decimals. */
export function minorToText(amount: bigint, currency: Currency): string {
  if (currency === 'IQD') return amount.toString();
  const whole = amount / 100n;
  const cents = (amount % 100n).toString().padStart(2, '0');
  return `${whole}.${cents}`;
}

export type ExpiryReading =
  | { ok: true; iso: string; precision: ExpiryPrecision; shown: string; expired: boolean }
  | { ok: false };

/**
 * How an expiry as typed is understood: MM/YYYY (the month, to its last day), DD/MM/YYYY, YYYY-MM-DD or YYYY-MM, digits
 * in Latin or Arabic-Indic. `iso` is what the server receives (it knows MM/YYYY, YYYY-MM and YYYY-MM-DD).
 */
export function readExpiry(text: string, today: string = utcToday()): ExpiryReading {
  const clean = normalizeScan(text).replace(/\s+/g, '');
  let toParse = clean;
  const dmy = /^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/.exec(clean);
  if (dmy) toParse = `${dmy[3]}-${dmy[2]!.padStart(2, '0')}-${dmy[1]!.padStart(2, '0')}`;
  const found = parseExpiry(toParse);
  if (!found) return { ok: false };
  return {
    ok: true,
    iso: found.date,
    precision: found.precision,
    shown: formatExpiry({ expiryDate: found.date, expiryPrecision: found.precision }),
    expired: found.date < today,
  };
}

/** Client-side problem codes by field name; the screen turns each into a sentence. */
export type LineProblem = 'qty' | 'bonus' | 'lot' | 'expiry' | 'cost' | 'unit';

export interface Built {
  input?: Record<string, unknown>;
  /** `lines.<i>.<field>` to a problem code, and `header.receivedOn`. */
  problems: Record<string, LineProblem | 'date' | 'lines'>;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The action input for a draft, and the problems that need no server (not a whole number, a lot missing, an expiry not
 * understood, a cost that is not a money amount). The pharmacy and branch are put in by the Server Action.
 */
export function inputOf(draft: ReceiptDraft): Built {
  const problems: Built['problems'] = {};
  if (draft.lines.length === 0) problems.lines = 'lines';
  if (!DATE.test(draft.receivedOn)) problems['header.receivedOn'] = 'date';
  const lines = draft.lines.map((l, i) => {
    const qty = wholeOf(l.qty);
    if (qty === null || qty < 1) problems[`lines.${i}.qty`] = 'qty';
    const bonus = l.bonusQty.trim() === '' ? 0 : wholeOf(l.bonusQty);
    if (bonus === null) problems[`lines.${i}.bonusQty`] = 'bonus';
    if (l.lot.trim() === '') problems[`lines.${i}.lot`] = 'lot';
    const expiry = readExpiry(l.expiry);
    if (!expiry.ok) problems[`lines.${i}.expiry`] = 'expiry';
    if (!l.unitId) problems[`lines.${i}.unitId`] = 'unit';
    let unitCostMinor = '0';
    if (!l.freeOfCharge) {
      const money = parseMoney(l.cost, l.currency);
      if (!money) problems[`lines.${i}.unitCostMinor`] = 'cost';
      else unitCostMinor = money.amount.toString();
    }
    return {
      productId: l.productId,
      unitId: l.unitId,
      qty: qty ?? 0,
      bonusQty: bonus ?? 0,
      lot: l.lot,
      expiry: expiry.ok ? expiry.iso : l.expiry,
      unitCostMinor,
      currency: l.currency,
      freeOfCharge: l.freeOfCharge,
      acceptExpired: l.acceptExpired,
      ...(l.purchaseOrderLineId ? { purchaseOrderLineId: l.purchaseOrderLineId } : {}),
    };
  });
  if (Object.keys(problems).length > 0) return { problems };
  return {
    problems,
    input: {
      supplierName: draft.supplierName,
      reference: draft.reference,
      receivedOn: draft.receivedOn,
      note: draft.note,
      ...(draft.supplierId ? { supplierId: draft.supplierId } : {}),
      ...(draft.purchaseOrderId ? { purchaseOrderId: draft.purchaseOrderId } : {}),
      lines,
    },
  };
}

export interface Totals {
  lines: number;
  /** Everything received, bonus included, in the products' base units. */
  baseUnits: number;
  /** Lines whose date is past: they go to quarantine. */
  expiredLines: number;
}

export function totalsOf(draft: ReceiptDraft, today: string = utcToday()): Totals {
  let baseUnits = 0;
  let expiredLines = 0;
  for (const l of draft.lines) {
    const base = l.units.find((u) => u.id === l.unitId)?.baseQty ?? 1;
    baseUnits += ((wholeOf(l.qty) ?? 0) + (wholeOf(l.bonusQty) ?? 0)) * base;
    const e = readExpiry(l.expiry, today);
    if (e.ok && e.expired) expiredLines += 1;
  }
  return { lines: draft.lines.length, baseUnits, expiredLines };
}
