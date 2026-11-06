import type { EntryDraftView, EntryLookup } from '@/server/pharmacy/fast-entry';
import { plainMinor } from '../sell-logic';
import { emptyEntryForm, type EntryForm } from './entry-logic';

/**
 * The entry screen's fields, pure: which fields each form shows and in which order Enter walks them, their labels, what a
 * known product pre-fills (the last purchase, the current price, the entry's supplier) and which form field a server refusal
 * names. The toggle (needs a prescription) is a pair of buttons, so Enter does not stop on it.
 */

export type KnownLookup = Extract<EntryLookup, { kind: 'known' }>;
export type EntryDraft = EntryDraftView['draft'];

/** A form field drawn as a text input or a select (everything but the prescription toggle and the lock flag). */
export type EntryFieldName = Exclude<keyof EntryForm, 'needsRx' | 'sellPriceLocked'>;

/** The known product's six fields, in the prototype's order. */
export const KNOWN_FIELDS: readonly EntryFieldName[] = ['qty', 'expiry', 'purchasePrice', 'sellPrice', 'lot', 'supplierId'];
/** The new product's four required fields, then the optional ones, in the prototype's order. */
export const NEW_REQUIRED: readonly EntryFieldName[] = ['name', 'sellPrice', 'qty', 'expiry'];
export const NEW_OPTIONAL: readonly EntryFieldName[] = ['purchasePrice', 'stripsPerPacket', 'tabletsPerStrip', 'activeIngredient', 'supplierId', 'lowStock', 'lot'];

/** The fields Enter walks, in order: a read-only selling price is skipped. The last one saves. */
export function enterOrder(kind: 'known' | 'new', locked: boolean): EntryFieldName[] {
  const all = kind === 'known' ? KNOWN_FIELDS : [...NEW_REQUIRED, ...NEW_OPTIONAL];
  return all.filter((f) => !(locked && f === 'sellPrice'));
}

/** Where Enter goes from `field`: the next field, or `'save'` from the last one (or from a field not in the order). */
export function nextField(order: readonly EntryFieldName[], field: EntryFieldName): EntryFieldName | 'save' {
  const at = order.indexOf(field);
  return at === -1 || at === order.length - 1 ? 'save' : order[at + 1]!;
}

/** Is this field required on this form? (A read-only selling price never is.) */
export function isRequired(kind: 'known' | 'new', field: EntryFieldName, locked: boolean): boolean {
  if (field === 'sellPrice' && locked) return false;
  return kind === 'known' ? field === 'qty' || field === 'expiry' || field === 'purchasePrice' : NEW_REQUIRED.includes(field);
}

/** The message key of each field's label. The known form's lot says "(optional)"; the new form lists it under Optional. */
export function labelKey(field: EntryFieldName | 'needsRx', kind: 'known' | 'new' = 'new'): string {
  if (field === 'lot') return kind === 'known' ? 'pharmacy.entry.field.lotOptional' : 'pharmacy.entry.field.lot';
  if (field === 'supplierId') return 'pharmacy.entry.field.supplier';
  return `pharmacy.entry.field.${field}`;
}

/**
 * The supplier a new line should name: the open entry's own (every line of one entry has one supplier, the server refuses
 * another), else the last purchase's.
 */
function supplierOf(draft: EntryDraft, last: string | null | undefined): string {
  if (draft) return draft.supplierId ?? '';
  return last ?? '';
}

/**
 * A known product's form: the purchase price from the last purchase (only when it was in USD, the currency this form
 * sends; a role without `cost.view` gets none and types it), the current selling price, and the supplier.
 */
export function knownForm(found: KnownLookup, locked: boolean, draft: EntryDraft): EntryForm {
  const last = found.lastPurchase;
  const cost = last?.purchasePriceMinor && last.purchaseCurrency === 'USD' ? plainMinor(BigInt(last.purchasePriceMinor), 'USD') : '';
  return {
    ...emptyEntryForm(locked),
    purchasePrice: cost,
    sellPrice: found.sellPrice ? plainMinor(BigInt(found.sellPrice.amountMinor), found.sellPrice.currency) : '',
    supplierId: supplierOf(draft, last?.supplierId),
  };
}

/** A new product's form: a name typed into the scan field (no barcode) starts its name. */
export function newForm(barcode: string | null, typed: string, locked: boolean, draft: EntryDraft): EntryForm {
  return { ...emptyEntryForm(locked), name: barcode === null ? typed.trim() : '', supplierId: supplierOf(draft, null) };
}

const SERVER_FIELDS: Record<string, EntryFieldName> = {
  qty: 'qty',
  expiry: 'expiry',
  purchasePrice: 'purchasePrice',
  sellPrice: 'sellPrice',
  lot: 'lot',
  supplierId: 'supplierId',
  'product.tradeName': 'name',
  'product.activeIngredient': 'activeIngredient',
  'product.stripsPerPacket': 'stripsPerPacket',
  'product.tabletsPerStrip': 'tabletsPerStrip',
  'product.lowStockPackets': 'lowStock',
};

/** The first form field a refusal names (its `fields` paths), with the server's sentence for it; null when it names none. */
export function refusedField(fields: Record<string, string> | undefined, shown: readonly EntryFieldName[]): { field: EntryFieldName; message: string } | null {
  for (const [path, message] of Object.entries(fields ?? {})) {
    const field = SERVER_FIELDS[path];
    if (field && shown.includes(field)) return { field, message };
  }
  return null;
}

/** "3 strip = 30 tablet": the smaller units in one packet, largest first; '' for a product with one unit. */
export function packetLadder(product: KnownLookup['product']): string {
  return [...product.units]
    .filter((u) => u.baseQty < product.packetBaseQty && product.packetBaseQty % u.baseQty === 0)
    .sort((a, b) => b.baseQty - a.baseQty)
    .map((u) => `${product.packetBaseQty / u.baseQty} ${u.label}`)
    .join(' = ');
}

/** The branch's stock in whole packets, and what is left over in the smallest unit. */
export function stockInPackets(found: KnownLookup): { packets: number; rest: number; restLabel: string } {
  const size = Math.max(1, found.product.packetBaseQty);
  const smallest = [...found.product.units].sort((a, b) => a.baseQty - b.baseQty)[0];
  const stock = Math.max(0, found.stockBaseQty);
  return { packets: Math.floor(stock / size), rest: stock % size, restLabel: smallest?.label ?? '' };
}
