import { normalizeScan } from '@/server/domain/pharmacy/barcode';

/**
 * The fast entry form's pure rules (Task 13): the expiry typed as month/year digits, the required fields of a known and
 * of a new product, and the request `ph.stock.entry.addLine` takes. The clock is passed in. Quantities are packets;
 * money stays the text the person typed (the server reads it with `parseMoney`).
 */

/** Everything the entry form holds, as typed. A new product uses all of it; a known product the batch fields only. */
export interface EntryForm {
  /** New product: its trade name. */
  name: string;
  /** Per packet, in the sale currency. */
  sellPrice: string;
  /** Packets. */
  qty: string;
  /** 'MM/YY' as `formatExpiryInput` shapes it. */
  expiry: string;
  /** Per packet, in USD. Required for a known product, optional for a new one. */
  purchasePrice: string;
  lot: string;
  /** A supplier record's id; '' for none. */
  supplierId: string;
  stripsPerPacket: string;
  tabletsPerStrip: string;
  needsRx: boolean;
  activeIngredient: string;
  /** The low-stock level, in packets; '' for none. */
  lowStock: string;
  /** The selling price is read-only (no `price.change`): never required, never sent. */
  sellPriceLocked: boolean;
}

/** A blank form, with the prototype's defaults for the optional new-product fields. */
export function emptyEntryForm(sellPriceLocked = false): EntryForm {
  return {
    name: '',
    sellPrice: '',
    qty: '',
    expiry: '',
    purchasePrice: '',
    lot: '',
    supplierId: '',
    stripsPerPacket: '1',
    tabletsPerStrip: '10',
    needsRx: false,
    activeIngredient: '',
    lowStock: '5',
    sellPriceLocked,
  };
}

/** Latin digits only (Arabic-Indic and Persian digits read as Latin). */
const digitsOf = (raw: string) => normalizeScan(raw).replace(/\D/g, '');

/**
 * An expiry typed as `MMYY` or `MM/YY` (month and year 20YY). Refused: a month outside 1..12, a month before the current
 * (UTC) one, anything else. The current month is valid: month/year means the last day of that month.
 */
export function parseExpiry(text: string, now: Date): { ok: true; month: number; year: number } | { ok: false } {
  const m = /^(\d{2})\/?(\d{2})$/.exec(normalizeScan(text).trim());
  if (!m) return { ok: false };
  const month = Number(m[1]);
  const year = 2000 + Number(m[2]);
  if (month < 1 || month > 12) return { ok: false };
  const nowYear = now.getUTCFullYear();
  const nowMonth = now.getUTCMonth() + 1;
  if (year < nowYear || (year === nowYear && month < nowMonth)) return { ok: false };
  return { ok: true, month, year };
}

/** What the expiry field shows while typing: at most four digits, with a `/` after the first two. */
export function formatExpiryInput(raw: string): string {
  const digits = digitsOf(raw).slice(0, 4);
  return digits.length > 2 ? `${digits.slice(0, 2)}/${digits.slice(2)}` : digits;
}

const NEW_REQUIRED = ['name', 'sellPrice', 'qty', 'expiry'] as const;
const KNOWN_REQUIRED = ['qty', 'expiry', 'purchasePrice'] as const;

/**
 * The first required field left blank, in the form's order, or null. A new product needs name, selling price, quantity
 * and expiry (the selling price not when it is read-only); a known one quantity, expiry and purchase price.
 */
export function requiredMissing(form: EntryForm, known: boolean): keyof EntryForm | null {
  const fields = known ? KNOWN_REQUIRED : NEW_REQUIRED.filter((f) => !(f === 'sellPrice' && form.sellPriceLocked));
  return fields.find((f) => form[f].trim() === '') ?? null;
}

/** What the entry is for: a product the lookup knew, or a new one (with the scanned code, if it was scanned). */
export type EntryTarget = { kind: 'known'; productId: string } | { kind: 'new'; barcode: string | null };

/** The request of `ph.stock.entry.addLine` (the place is added by the server). */
export interface EntryLineRequest {
  requestKey: string;
  product:
    | { kind: 'known'; productId: string }
    | {
        kind: 'new';
        tradeName: string;
        barcode: string | null;
        activeIngredient: string;
        rxLevel: 'OTC' | 'RX';
        stripsPerPacket: number;
        tabletsPerStrip: number;
        lowStockPackets: number | null;
      };
  qty: number;
  expiry: { month: number; year: number };
  purchasePrice: string | null;
  purchaseCurrency: 'USD';
  sellPrice: string | null;
  lot: string;
  supplierId: string | null;
}

/** Why the form cannot be sent yet: a blank required field, a bad expiry, a quantity that is not 1 or more, or a count that is not a whole number. */
export type EntryProblem = 'missing' | 'expiry' | 'qty' | 'number';

/** A whole number from typed text (any digits), or null. */
function wholeOf(text: string): number | null {
  const t = normalizeScan(text).trim();
  return /^\d+$/.test(t) ? Number(t) : null;
}

/**
 * The request for the form, or the first field to fix: required fields first (`requiredMissing`), then the expiry, then
 * the quantity, then a new product's counts. `requestKey` is the save's own key: the same key for a retry of the same save.
 */
export function entryRequest(
  form: EntryForm,
  target: EntryTarget,
  requestKey: string,
  now: Date,
): { ok: true; request: EntryLineRequest } | { ok: false; field: keyof EntryForm; problem: EntryProblem } {
  const known = target.kind === 'known';
  const missing = requiredMissing(form, known);
  if (missing) return { ok: false, field: missing, problem: 'missing' };
  const expiry = parseExpiry(form.expiry, now);
  if (!expiry.ok) return { ok: false, field: 'expiry', problem: 'expiry' };
  const qty = wholeOf(form.qty);
  if (qty === null || qty < 1) return { ok: false, field: 'qty', problem: 'qty' };
  const text = (value: string) => (value.trim() === '' ? null : value.trim());

  let product: EntryLineRequest['product'];
  if (target.kind === 'known') {
    product = { kind: 'known', productId: target.productId };
  } else {
    const counts = { stripsPerPacket: wholeOf(form.stripsPerPacket || '1'), tabletsPerStrip: wholeOf(form.tabletsPerStrip || '1') };
    for (const field of ['stripsPerPacket', 'tabletsPerStrip'] as const) {
      const n = counts[field];
      if (n === null || n < 1) return { ok: false, field, problem: 'number' };
    }
    const low = form.lowStock.trim() === '' ? null : wholeOf(form.lowStock);
    if (form.lowStock.trim() !== '' && low === null) return { ok: false, field: 'lowStock', problem: 'number' };
    product = {
      kind: 'new',
      tradeName: form.name.trim(),
      barcode: target.barcode,
      activeIngredient: form.activeIngredient.trim(),
      rxLevel: form.needsRx ? 'RX' : 'OTC',
      stripsPerPacket: counts.stripsPerPacket!,
      tabletsPerStrip: counts.tabletsPerStrip!,
      lowStockPackets: low,
    };
  }
  return {
    ok: true,
    request: {
      requestKey,
      product,
      qty,
      expiry: { month: expiry.month, year: expiry.year },
      purchasePrice: text(form.purchasePrice),
      purchaseCurrency: 'USD',
      sellPrice: form.sellPriceLocked ? null : text(form.sellPrice),
      lot: form.lot.trim(),
      supplierId: text(form.supplierId),
    },
  };
}
