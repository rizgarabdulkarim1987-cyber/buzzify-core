import { attemptKeyFor } from './purchasing-logic';
import { formatMinor, plainMinor, type Currency } from './sell-logic';

/**
 * The invoice review screen's decisions, apart from the screen: the view of a line and of the header (what was read, what
 * was edited, what is missing), the patch an edit sends, the keys of an attempt, the flags in words' terms (the screen holds
 * the words), what blocks the approval and why a control is disabled, and the small rules of the original picture (when a
 * signed link is stale, the zoom steps). Money is a BigInt in minor units whenever it is added or compared and text
 * whenever it is shown; a `Number` never holds a sum. The server stays the judge of every flag and of the approval: the
 * reasons here are its own reasons, grouped. No motion, no I/O.
 */

export type { Currency };

export type FlagCode = 'AMBIGUOUS_MATCH' | 'DUPLICATE_LINE' | 'EXPIRED' | 'MATH_MISMATCH' | 'MISSING' | 'MODEL_UNCLEAR';
/** The order flags are listed in: what blocks most plainly first. */
export const FLAG_ORDER: readonly FlagCode[] = ['MISSING', 'AMBIGUOUS_MATCH', 'MATH_MISMATCH', 'MODEL_UNCLEAR', 'EXPIRED', 'DUPLICATE_LINE'];
/** The flags a person clears by writing what they checked; the others need a value or a product. */
export const NOTE_FLAGS: readonly FlagCode[] = ['MODEL_UNCLEAR', 'EXPIRED', 'DUPLICATE_LINE', 'MATH_MISMATCH'];

// Shapes (what `ph.intake.batch.get` returns, as the screen needs it) ---------------------------------------------------

export interface ReviewLine {
  name: string | null;
  strength: string | null;
  form: string | null;
  pack: string | null;
  quantity: number | null;
  bonus: number | null;
  unitCost: number | null;
  lineTotal: number | null;
  lot: string | null;
  expiry: string | null;
  barcodeText: string | null;
  unclear: string[];
  freeOfCharge: boolean;
}

/** A unit of a product: `baseQty` is how many base units (tablets) one of it holds. */
export interface PackUnit {
  id: string;
  label: string;
  baseQty: number;
  level: number;
}

export interface ReviewRow {
  id: string;
  fileId: string;
  lineNo: number;
  page: number;
  version: number;
  removed: boolean;
  manual: boolean;
  line: ReviewLine;
  extracted: Record<string, unknown>;
  edited: Record<string, unknown>;
  flags: string[];
  openFlags: string[];
  matchState: string;
  match: { productId: string; unitId: string | null; name: string; strength: string; form: string; unitLabel: string | null; units?: PackUnit[] } | null;
  candidates: Array<{ productId: string; name: string; strength: string; form: string; score: number; units?: PackUnit[] }>;
  reviewed: boolean;
  note: string | null;
  acknowledged: { flags: string[]; mismatch: { difference?: string } | null };
}

export const HEADER_FIELDS = ['invoiceNumber', 'invoiceDate', 'currency', 'total', 'discount', 'tax'] as const;
export type HeaderField = (typeof HEADER_FIELDS)[number];

export type ApprovalReason = { code: 'NO_ROWS' } | { code: 'OPEN_FLAG'; rowIndex: number; flag: string } | { code: 'HEADER_MISMATCH' } | { code: 'FILES_STILL_PROCESSING'; files: number };

export interface ReviewHeader {
  values: { invoiceNumber: string | null; invoiceDate: string | null; currency: Currency | null; total: number | null; discount: number | null; tax: number | null };
  extracted: Record<string, unknown>;
  edited: Record<string, unknown>;
  status: 'OK' | 'MISMATCH' | 'UNKNOWN';
  conflicts: string[];
  acknowledged: { reason: string; difference?: string } | null;
  arithmetic?: { status: 'OK' | 'MISMATCH' | 'UNKNOWN'; expected?: string; actual?: string; difference?: string; assumed?: Array<'tax' | 'discount'> };
}

export interface ReviewData {
  batch: { id: string; status: 'OPEN' | 'APPROVED' | 'CANCELLED'; version: number; receiptId: string | null; supplierId: string | null; supplierName: string | null };
  header: ReviewHeader;
  files: Array<{ id: string; status: string; mediaType: string; pages: number }>;
  rows: ReviewRow[];
  approval: { ok: boolean; reasons: ApprovalReason[] };
  verdictToken: string;
}

// Money ---------------------------------------------------------------------------------------------------------------

/** `1,250` for IQD, `12.50` for USD, grouped, exact for any size; null for a value that was not read. */
export function formatAmount(value: number | string | bigint | null | undefined, currency: Currency | null): string | null {
  if (value === null || value === undefined || currency === null) return null;
  return formatMinor(BigInt(value), currency);
}

function amountText(value: number | string | bigint | null | undefined, currency: Currency | null): string {
  if (value === null || value === undefined) return '';
  return plainMinor(BigInt(value), currency ?? 'IQD');
}

// Lines -------------------------------------------------------------------------------------------------------------------

export const liveRows = <T extends { removed: boolean }>(rows: readonly T[]): T[] => rows.filter((r) => !r.removed);

export const EDIT_FIELDS = ['name', 'strength', 'form', 'pack', 'quantity', 'bonus', 'unitCost', 'lineTotal', 'lot', 'expiry', 'barcodeText'] as const;
export type EditField = (typeof EDIT_FIELDS)[number];
export const MONEY_FIELDS: readonly EditField[] = ['unitCost', 'lineTotal'];
export const COUNT_FIELDS: readonly EditField[] = ['quantity', 'bonus'];

/** What every editable field of a line holds as plain text (empty for a value not read). */
export function rowFormOf(row: ReviewRow, currency: Currency | null): Record<EditField, string> {
  const l = row.line;
  return {
    name: l.name ?? '',
    strength: l.strength ?? '',
    form: l.form ?? '',
    pack: l.pack ?? '',
    quantity: l.quantity === null ? '' : String(l.quantity),
    bonus: l.bonus === null ? '' : String(l.bonus),
    unitCost: amountText(l.unitCost, currency),
    lineTotal: amountText(l.lineTotal, currency),
    lot: l.lot ?? '',
    expiry: l.expiry ?? '',
    barcodeText: l.barcodeText ?? '',
  };
}

/** The fields a person changed, as the patch `ph.intake.row.update` takes: typed text, an emptied field as null. The server parses and judges. */
export function buildRowPatch(row: ReviewRow, values: Partial<Record<EditField, string>>, currency: Currency | null): { patch: Record<string, string | null> } {
  const current = rowFormOf(row, currency);
  const patch: Record<string, string | null> = {};
  for (const field of EDIT_FIELDS) {
    const typed = values[field];
    if (typed === undefined) continue;
    const text = typed.trim();
    if (text === current[field].trim()) continue;
    patch[field] = text === '' ? null : text;
  }
  return { patch };
}

export type MissingField = 'product' | 'quantity' | 'lot' | 'expiry' | 'cost';

/** The fields a MISSING line lacks, mirroring the server's rule (product and unit, a positive quantity, lot, expiry, a cost unless free). */
export function missingFields(row: ReviewRow): MissingField[] {
  const l = row.line;
  const out: MissingField[] = [];
  if (row.match === null || row.match.unitId === null) out.push('product');
  if (l.quantity === null || l.quantity <= 0) out.push('quantity');
  if ((l.lot ?? '').trim() === '') out.push('lot');
  if (l.expiry === null || l.expiry.trim() === '') out.push('expiry');
  if (!l.freeOfCharge && (l.unitCost === null || l.unitCost === 0)) out.push('cost');
  return out;
}

/** Quantity x cost against the line total, as text; null while one of them was not read. */
export function mathFigures(row: ReviewRow, currency: Currency | null): { expected: string; actual: string; difference: string } | null {
  const { quantity, unitCost, lineTotal } = row.line;
  if (quantity === null || unitCost === null || lineTotal === null) return null;
  const expected = BigInt(quantity) * BigInt(unitCost);
  const actual = BigInt(lineTotal);
  return { expected: formatMinor(expected, currency ?? 'IQD'), actual: formatMinor(actual, currency ?? 'IQD'), difference: formatMinor(actual - expected, currency ?? 'IQD') };
}

export type MatchChip = 'matched' | 'unmatched' | 'ambiguous' | 'chosen';
export function matchChipOf(row: ReviewRow): MatchChip {
  if (row.matchState === 'CHOSEN') return 'chosen';
  if (row.matchState === 'AMBIGUOUS') return 'ambiguous';
  if (row.matchState === 'MATCHED' && row.match) return 'matched';
  return 'unmatched';
}

export type ValueSource = 'read' | 'edited' | 'barcode' | 'manual';
/** Where a line's value came from: the model's reading, a person's edit, a barcode, or a line a person added. */
export function rowFieldSource(row: ReviewRow, field: EditField | 'freeOfCharge'): ValueSource {
  const sources = row.edited.fieldSources;
  if (sources && typeof sources === 'object' && (sources as Record<string, unknown>)[field] === 'barcode') return 'barcode';
  if (field in row.edited) return 'edited';
  return row.manual ? 'manual' : 'read';
}

/** The flags the screen shows the server when a line is marked reviewed: what the line raises now, not only what is still open. */
export const reviewShown = (row: ReviewRow): string[] => [...row.flags].sort();

/** The flags of a line in the order they are listed. */
export const orderedFlags = (flags: readonly string[]): FlagCode[] => FLAG_ORDER.filter((f) => flags.includes(f));

// Keys ----------------------------------------------------------------------------------------------------------------------

export interface AttemptKey {
  clientKey: string;
  keySig?: string | undefined;
}

/** The key a line edit is sent with: the saved one while line, version and patch are the same, a new one as soon as one changed. */
export function rowKeyFor(prev: AttemptKey | undefined, rowId: string, version: number, patch: Record<string, unknown>, make?: (prefix: string) => string): { clientKey: string; keySig: string } {
  return attemptKeyFor(prev ?? { clientKey: '', keySig: undefined }, JSON.stringify([rowId, version, patch]), 'irow', make);
}

/** What an approval rests on: the batch version and the token of the last reading. A new reading is a new attempt. */
export const approveSignature = (version: number, token: string): string => JSON.stringify([version, token]);

// Counts and blockers -----------------------------------------------------------------------------------------------------

export function reviewCounts(data: ReviewData): { rows: number; removed: number; openFlags: number; flaggedRows: number; reviewed: number } {
  const live = liveRows(data.rows);
  return {
    rows: live.length,
    removed: data.rows.length - live.length,
    openFlags: live.reduce((n, r) => n + r.openFlags.length, 0),
    flaggedRows: live.filter((r) => r.openFlags.length > 0).length,
    reviewed: live.filter((r) => r.reviewed).length,
  };
}

export type Blocker =
  | { kind: 'noRows' }
  | { kind: 'processing'; files: number }
  | { kind: 'flag'; flag: string; count: number; rowId: string; lineNo: number }
  | { kind: 'header' }
  | { kind: 'supplier' }
  | { kind: 'currency' }
  | { kind: 'number' };

/**
 * Why the batch cannot be approved, in the server's own terms: its reasons (open flags grouped by flag, with the first line
 * to jump to, since the server counts lines among the live ones) plus what the approval asks for besides them: a supplier,
 * a currency and an invoice number. Empty when nothing blocks.
 */
export function approveBlockers(data: ReviewData): Blocker[] {
  const live = liveRows(data.rows);
  const out: Blocker[] = [];
  for (const reason of data.approval.reasons) {
    if (reason.code === 'NO_ROWS') out.push({ kind: 'noRows' });
    else if (reason.code === 'FILES_STILL_PROCESSING') out.push({ kind: 'processing', files: reason.files });
    else if (reason.code === 'HEADER_MISMATCH') out.push({ kind: 'header' });
    else {
      const target = live[reason.rowIndex];
      const existing = out.find((b): b is Extract<Blocker, { kind: 'flag' }> => b.kind === 'flag' && b.flag === reason.flag);
      if (existing) existing.count += 1;
      else if (target) out.push({ kind: 'flag', flag: reason.flag, count: 1, rowId: target.id, lineNo: target.lineNo });
    }
  }
  if (data.batch.supplierId === null) out.push({ kind: 'supplier' });
  if (data.header.values.currency === null) out.push({ kind: 'currency' });
  if ((data.header.values.invoiceNumber ?? '').trim() === '') out.push({ kind: 'number' });
  return out;
}

export const jumpId = (rowId: string): string => `review-row-${rowId}`;

// Controls --------------------------------------------------------------------------------------------------------------------

export interface ReviewContext {
  /** The batch is OPEN. */
  open: boolean;
  /** The role holds `ai.use`. */
  mayAi: boolean;
  /** The pharmacy is open for writing and the role may buy. */
  writable: boolean;
  /** The branch chosen is this batch's branch. */
  branchOk: boolean;
  online: boolean;
  /** Something typed on the screen is not saved yet. */
  unsaved?: boolean;
  /** A save or another write is running. */
  writing?: boolean;
}

export type EditBlock = 'readOnly' | 'branch' | 'closed' | 'noAi' | 'offline';

/** Why the lines cannot be edited now, or false. Editing needs `ai.use` as well as `purchase.manage`. */
export function editReason(ctx: ReviewContext): false | EditBlock {
  if (!ctx.writable) return 'readOnly';
  if (!ctx.branchOk) return 'branch';
  if (!ctx.open) return 'closed';
  if (!ctx.mayAi) return 'noAi';
  if (!ctx.online) return 'offline';
  return false;
}

export type ApproveBlock = 'readOnly' | 'branch' | 'closed' | 'offline' | 'unsaved' | 'writing' | 'blocked';

/** Why the approve button is disabled, or false. Approving needs `purchase.manage` only: a role without `ai.use` may approve a clean batch. */
export function approveControl(data: ReviewData, ctx: ReviewContext): false | ApproveBlock {
  if (!ctx.writable) return 'readOnly';
  if (!ctx.branchOk) return 'branch';
  if (!ctx.open) return 'closed';
  if (!ctx.online) return 'offline';
  if (ctx.unsaved) return 'unsaved';
  if (ctx.writing) return 'writing';
  if (approveBlockers(data).length > 0) return 'blocked';
  return false;
}

// Header ------------------------------------------------------------------------------------------------------------------------

export type HeaderSource = 'read' | 'edited' | 'conflict' | 'notRead';

export function headerFieldSource(header: ReviewHeader, field: HeaderField): HeaderSource {
  // A value a person set ends the disagreement between files.
  if (field in header.edited) return 'edited';
  if (header.conflicts.includes(field)) return 'conflict';
  const read = header.extracted[field];
  return read !== null && read !== undefined && read !== '' ? 'read' : 'notRead';
}

export type HeaderFormField = HeaderField | 'supplierId';

export function headerFormOf(data: ReviewData): Record<HeaderFormField, string> {
  const v = data.header.values;
  const c = v.currency;
  return {
    supplierId: data.batch.supplierId ?? '',
    invoiceNumber: v.invoiceNumber ?? '',
    invoiceDate: v.invoiceDate ?? '',
    currency: c ?? '',
    total: amountText(v.total, c),
    discount: amountText(v.discount, c),
    tax: amountText(v.tax, c),
  };
}

/** The header fields a person changed, as the patch `ph.intake.header.update` takes. */
export function buildHeaderPatch(data: ReviewData, values: Partial<Record<HeaderFormField, string>>): Record<string, string | null> {
  const current = headerFormOf(data);
  const patch: Record<string, string | null> = {};
  for (const field of ['supplierId', ...HEADER_FIELDS] as const) {
    const typed = values[field];
    if (typed === undefined) continue;
    const text = typed.trim();
    if (text === current[field].trim()) continue;
    patch[field] = text === '' ? null : text;
  }
  return patch;
}

/** The difference and currency the acknowledgement is bound to, exactly as the server sees them now; null when the header does not differ. */
export function headerAckShown(data: ReviewData): { difference: string; currency: Currency | null } | null {
  const a = data.header.arithmetic;
  if (!a || a.status !== 'MISMATCH' || a.difference === undefined) return null;
  return { difference: a.difference, currency: data.header.values.currency };
}

// The original ------------------------------------------------------------------------------------------------------------------

/** A signed link lives five minutes; one older than four is asked for again before it is used. */
export const URL_FRESH_MS = 4 * 60_000;
export const urlFresh = (fetchedAt: number, now: number): boolean => now - fetchedAt <= URL_FRESH_MS;

export const ZOOMS = [50, 75, 100, 150, 200, 300] as const;
export function zoomStep(current: number, direction: 'in' | 'out'): number {
  const at = ZOOMS.findIndex((z) => z >= current);
  const index = at === -1 ? ZOOMS.length - 1 : at;
  return ZOOMS[Math.min(ZOOMS.length - 1, Math.max(0, index + (direction === 'in' ? 1 : -1)))]!;
}

// After the batch is closed -------------------------------------------------------------------------------------------------

const META_KEYS = new Set(['removed', 'source', 'fieldSources']);

/** What was done to a closed batch's lines, as counts only (never a value). */
export function historyOf(rows: readonly ReviewRow[]): { lines: number; edited: number; removed: number; added: number; reviewed: number } {
  return {
    lines: rows.length,
    edited: rows.filter((r) => !r.removed && !r.manual && Object.keys(r.edited).some((k) => !META_KEYS.has(k))).length,
    removed: rows.filter((r) => r.removed).length,
    added: rows.filter((r) => r.manual).length,
    reviewed: rows.filter((r) => r.reviewed).length,
  };
}

/** Where a duplicate-invoice refusal points: the invoice already entered, or the batch that was approved for it. */
export function duplicateTarget(fields: Record<string, string> | undefined): { kind: 'invoice' | 'batch'; id: string } | null {
  if (fields?.phCode !== 'DUPLICATE_INVOICE') return null;
  if (fields.existingInvoiceId) return { kind: 'invoice', id: fields.existingInvoiceId };
  if (fields.batchId) return { kind: 'batch', id: fields.batchId };
  return null;
}

// The draft kept on the device ------------------------------------------------------------------------------------------------

/** What the review screen keeps while a person types: unsaved line forms, the header form, and the keys of attempts that may repeat. */
export interface ReviewDraft {
  forms: Record<string, Partial<Record<EditField, string>>>;
  header: Partial<Record<HeaderFormField, string>> | null;
  keys: Record<string, AttemptKey>;
  approve: AttemptKey | null;
}

export const emptyReviewDraft = (): ReviewDraft => ({ forms: {}, header: null, keys: {}, approve: null });

/** True when something typed is not saved yet. Keys alone are not unsaved work. */
export const hasUnsaved = (draft: ReviewDraft): boolean => Object.keys(draft.forms).length > 0 || draft.header !== null;

// The pack unit and the quantity in base units ---------------------------------------------------------------------------------

const normPack = (text: string): string => text.toLowerCase().replace(/s+/g, ' ').trim();

/** The unit the invoice's pack text names ("10 strip", "box"), or null when it does not decide: then the person chooses. */
export function unitForPack<U extends { id: string; label: string; baseQty: number }>(units: readonly U[], pack: string | null): U | null {
  const wanted = normPack(pack ?? '');
  if (wanted === '') return null;
  const bySize = units.filter((u) => normPack(`${u.baseQty} ${u.label}`) === wanted);
  if (bySize.length === 1) return bySize[0]!;
  if (bySize.length > 1) return null;
  const byName = units.filter((u) => normPack(u.label) === wanted);
  return byName.length === 1 ? byName[0]! : null;
}

/** What one pack holds and what the line comes to in base units (bonus separately), as text, so a strip taken for a box shows at once. */
export function baseFigures(row: ReviewRow): { perPack: number; unitLabel: string; base: string; bonusBase: string } | null {
  const unit = row.match?.units?.find((u) => u.id === row.match?.unitId);
  if (!unit || row.line.quantity === null) return null;
  const per = BigInt(unit.baseQty);
  return { perPack: unit.baseQty, unitLabel: unit.label, base: String(BigInt(row.line.quantity) * per), bonusBase: String(BigInt(row.line.bonus ?? 0) * per) };
}

// Unsaved work and open items --------------------------------------------------------------------------------------------------

/** The line numbers (and whether the header) that hold unsaved work, for the sentence that says why approving waits. */
export function unsavedParts(draft: ReviewDraft, rows: readonly ReviewRow[]): { lines: number[]; header: boolean } {
  const lines = rows.filter((r) => r.id in draft.forms).map((r) => r.lineNo).sort((a, b) => a - b);
  return { lines, header: draft.header !== null };
}

/** The lines still to look at: an open item or a form being edited. Removed lines are not. */
export function openRowIds(rows: readonly ReviewRow[], forms: Record<string, unknown>): string[] {
  return rows.filter((r) => !r.removed && (r.openFlags.length > 0 || r.id in forms)).map((r) => r.id);
}

/** The next line to look at after `current` (the first when none), wrapping round; null when there is none. */
export function nextOpenId(rows: readonly ReviewRow[], current: string | null, forms: Record<string, unknown>): string | null {
  const open = new Set(openRowIds(rows, forms));
  if (open.size === 0) return null;
  const at = current === null ? -1 : rows.findIndex((r) => r.id === current);
  for (let i = 1; i <= rows.length; i += 1) {
    const r = rows[(at + i) % rows.length]!;
    if (open.has(r.id)) return r.id;
  }
  return null;
}
