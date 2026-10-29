import { createHash } from 'node:crypto';
import { baghdadDayOf } from '@/lib/baghdad';
import type { ScopedDb, ScopedTx } from '@/server/data/tenant-db';
import {
  canApprove,
  deriveFlags,
  effectiveRow,
  headerArithmetic,
  lineArithmetic,
  openFlags,
  parseExpiry,
  type Arithmetic,
  type ApprovalReason,
  type ExpiryValue,
  type Flag,
  type MatchStatus,
} from '@/server/domain/pharmacy/intake';

/**
 * Invoice intake, the rows (R5-8, R5-9, R5-13): what a line and a header are once a person's edits lie over the model's
 * reading, which flags that raises, which of them a person acknowledged, and the writes that keep the stored flags in step.
 * Used by the review service, the extraction service (the header arithmetic) and the product service (unit removal). It imports
 * nothing of the product or receipt services: they import this.
 *
 * Nothing stored here is trusted when a decision is made: `evaluateRows` derives flags, differences and acknowledgements from
 * the stored extraction, edits, match and acknowledgements every time, and the stored `flags` column is only what `recomputeBatch`
 * last wrote (a reader that wants the truth calls `evaluateRows` itself).
 *
 * Lock order (extends files.ts): client key (7201) -> the batch row FOR UPDATE (`lockBatch`) -> its row updates.
 */

// Shapes --------------------------------------------------------------------------------------------------------------

/** The editable fields of a line. `unclear` and `page` are the model's; `freeOfCharge` exists only as an edit. */
export interface Line {
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

export const LINE_FIELDS = ['name', 'strength', 'form', 'pack', 'quantity', 'bonus', 'unitCost', 'lineTotal', 'lot', 'expiry', 'barcodeText', 'freeOfCharge'] as const;
export type LineField = (typeof LINE_FIELDS)[number];

/** A line with every field empty: the base under a row a person added (`extracted = {}`), so edits to it are effective. */
export const EMPTY_LINE: Line = {
  name: null,
  strength: null,
  form: null,
  pack: null,
  quantity: null,
  bonus: null,
  unitCost: null,
  lineTotal: null,
  lot: null,
  expiry: null,
  barcodeText: null,
  unclear: [],
  freeOfCharge: false,
};

export interface HeaderValues {
  invoiceNumber: string | null;
  invoiceDate: string | null;
  currency: 'IQD' | 'USD' | null;
  total: number | null;
  discount: number | null;
  tax: number | null;
}
export const HEADER_FIELDS = ['invoiceNumber', 'invoiceDate', 'currency', 'total', 'discount', 'tax'] as const;
export type HeaderField = (typeof HEADER_FIELDS)[number];
export const EMPTY_HEADER: HeaderValues = { invoiceNumber: null, invoiceDate: null, currency: null, total: null, discount: null, tax: null };

/** `PhIntakeBatch.header`: the model's reading, a person's edits over it, the arithmetic and the header acknowledgement. */
export interface StoredHeader {
  extracted?: Partial<HeaderValues> & { supplierName?: string | null; unclear?: string[] };
  edited?: Partial<HeaderValues>;
  arithmetic?: unknown;
  /** The reason a person gave for a header total that does not add up, with the exact difference and currency they accepted. */
  acknowledged?: { reason: string; difference: string; currency?: string | null } | null;
  /** Header keys two files of the batch read differently (names only): each reads as unset until a person edits it. */
  conflicts?: string[];
}

export type MatchState = 'MATCHED' | 'UNMATCHED' | 'AMBIGUOUS' | 'CHOSEN';

/** What a row's acknowledgement stores: the flags a note was written for and the mismatch reason with its difference. */
export interface Ack {
  flags: Flag[];
  mismatch: { reason: string; difference: string } | null;
}

/** A stored row as the readers select it. */
export interface RowRecord {
  id: string;
  fileId: string;
  lineNo: number;
  page: number;
  extracted: unknown;
  edited: unknown;
  matchedProductId: string | null;
  matchedUnitId: string | null;
  matchState: string;
  candidates: unknown;
  flags: string[];
  reviewed: boolean;
  note: string | null;
  acknowledged: unknown;
  version: number;
  lastKey?: string | null;
  lastKeyHash?: string | null;
}

export const ROW_SELECT = {
  id: true,
  fileId: true,
  lineNo: true,
  page: true,
  extracted: true,
  edited: true,
  matchedProductId: true,
  matchedUnitId: true,
  matchState: true,
  candidates: true,
  flags: true,
  reviewed: true,
  note: true,
  acknowledged: true,
  version: true,
  lastKey: true,
  lastKeyHash: true,
} as const;

export interface RowView {
  id: string;
  fileId: string;
  lineNo: number;
  page: number;
  version: number;
  /** A line a person removed: kept for the record, ignored by flags, totals and approval. */
  removed: boolean;
  /** A line a person added (the model never saw it). */
  manual: boolean;
  line: Line;
  expiry: ExpiryValue | null;
  matchedProductId: string | null;
  matchedUnitId: string | null;
  matchState: MatchState;
  arithmetic: Arithmetic;
  /** The flags the row raises now, before any acknowledgement. */
  derived: Flag[];
  /** What is still open after the acknowledgement. */
  open: Flag[];
  reviewed: boolean;
  note: string | null;
  ack: Ack;
  edited: Record<string, unknown>;
  extracted: Record<string, unknown>;
  stored: { flags: string[]; ack: Ack };
}

// Reading ---------------------------------------------------------------------------------------------------------------

const asObject = (value: unknown): Record<string, unknown> => (value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {});

const FLAGS: readonly Flag[] = ['AMBIGUOUS_MATCH', 'DUPLICATE_LINE', 'EXPIRED', 'MATH_MISMATCH', 'MISSING', 'MODEL_UNCLEAR'];
const isFlag = (value: unknown): value is Flag => typeof value === 'string' && (FLAGS as readonly string[]).includes(value);

export function readAck(value: unknown): Ack {
  const o = asObject(value);
  const flags = Array.isArray(o.flags) ? o.flags.filter(isFlag) : [];
  const m = asObject(o.mismatch);
  const mismatch = typeof m.reason === 'string' && typeof m.difference === 'string' && /^-?\d+$/.test(m.difference) ? { reason: m.reason, difference: m.difference } : null;
  return { flags: [...new Set(flags)].sort(), mismatch };
}

const stateOf = (value: string): MatchState => (value === 'MATCHED' || value === 'AMBIGUOUS' || value === 'CHOSEN' ? value : 'UNMATCHED');

/** The values a line has: the model's reading with the person's edits over it (an explicit null clears). */
export function effectiveLine(extracted: unknown, edited: unknown): Line {
  const base = { ...EMPTY_LINE, ...asObject(extracted) } as Line;
  return effectiveRow(base, asObject(edited) as Partial<Line>);
}

export function effectiveHeader(header: unknown): HeaderValues {
  const stored = asObject(header) as StoredHeader;
  const base = { ...EMPTY_HEADER, ...asObject(stored.extracted) } as HeaderValues;
  for (const key of Array.isArray(stored.conflicts) ? stored.conflicts : []) if (key in base) (base as unknown as Record<string, unknown>)[key] = null;
  return effectiveRow(base, asObject(stored.edited) as Partial<HeaderValues>);
}

const sameAck = (a: Ack, b: Ack) => a.flags.join() === b.flags.join() && (a.mismatch?.reason ?? null) === (b.mismatch?.reason ?? null) && (a.mismatch?.difference ?? null) === (b.mismatch?.difference ?? null);

/** The flags, differences and acknowledgements of every row of one batch, derived from what is stored. `rows` are in file then line order. */
export function evaluateRows(rows: readonly RowRecord[], now: Date): RowView[] {
  const today = baghdadDayOf(now);
  const base = rows.map((r) => {
    const edited = asObject(r.edited);
    const extracted = asObject(r.extracted);
    const line = effectiveLine(extracted, edited);
    const state = stateOf(r.matchState);
    return { r, edited, extracted, line, removed: edited.removed === true, state, expiry: line.expiry === null ? null : parseExpiry(line.expiry, now) };
  });
  const live = base.filter((b) => !b.removed);
  const context = {
    today,
    rows: live.map((b) => ({ id: b.r.id, productId: b.r.matchedProductId, unitId: b.r.matchedUnitId, lot: b.line.lot })),
  };
  return base.map((b) => {
    const { r, line } = b;
    const arithmetic = lineArithmetic(line);
    const matchStatus: MatchStatus = b.state === 'AMBIGUOUS' ? 'AMBIGUOUS' : b.state === 'UNMATCHED' ? 'UNMATCHED' : 'MATCHED';
    const derived = b.removed
      ? []
      : deriveFlags(
          {
            id: r.id,
            productId: r.matchedProductId,
            unitId: r.matchedUnitId,
            quantity: line.quantity,
            lot: line.lot,
            expiry: b.expiry?.date ?? null,
            unitCost: line.unitCost,
            freeOfCharge: line.freeOfCharge,
            matchStatus,
            arithmetic: arithmetic.status,
            unclear: line.unclear,
          },
          context,
        );
    const stored = readAck(r.acknowledged);
    // An acknowledgement stays only for what it was written for and still applies: a flag that went away and came back is
    // new, and a mismatch reason belongs to the difference it saw.
    const difference = arithmetic.status === 'MISMATCH' ? arithmetic.difference : null;
    const ack: Ack = {
      flags: stored.flags.filter((f) => derived.includes(f)),
      mismatch: stored.mismatch !== null && difference !== null && BigInt(stored.mismatch.difference) === difference && derived.includes('MATH_MISMATCH') ? stored.mismatch : null,
    };
    const noted = r.reviewed && (r.note ?? '').trim() !== '';
    const open = openFlags(
      derived,
      {
        reviewed: noted ? { note: r.note ?? '', flags: ack.flags } : null,
        mismatchAcknowledged: ack.mismatch ? { reason: ack.mismatch.reason, difference: BigInt(ack.mismatch.difference) } : null,
      },
      difference,
    );
    return {
      id: r.id,
      fileId: r.fileId,
      lineNo: r.lineNo,
      page: r.page,
      version: r.version,
      removed: b.removed,
      manual: b.edited.source === 'manual',
      line,
      expiry: b.expiry,
      matchedProductId: r.matchedProductId,
      matchedUnitId: r.matchedUnitId,
      matchState: b.state,
      arithmetic,
      derived,
      open,
      reviewed: r.reviewed,
      note: r.note,
      ack,
      edited: b.edited,
      extracted: b.extracted,
      stored: { flags: r.flags, ack: stored },
    };
  });
}

export interface HeaderView {
  values: HeaderValues;
  arithmetic: Arithmetic;
  /** The difference a person accepted, when it is still the current one. */
  acknowledged: { reason: string; difference: string } | null;
  status: 'OK' | 'MISMATCH' | 'UNKNOWN';
}

export function headerView(header: unknown, rows: readonly RowView[]): HeaderView {
  const values = effectiveHeader(header);
  const arithmetic = headerArithmetic(
    rows.filter((r) => !r.removed).map((r) => ({ lineTotal: r.line.lineTotal })),
    { total: values.total, tax: values.tax, discount: values.discount },
  );
  const stored = asObject((asObject(header) as StoredHeader).acknowledged);
  const ack = typeof stored.reason === 'string' && typeof stored.difference === 'string' && /^-?\d+$/.test(stored.difference) ? { reason: stored.reason, difference: stored.difference, currency: typeof stored.currency === 'string' ? stored.currency : null } : null;
  const current = arithmetic.status === 'MISMATCH' ? arithmetic.difference : null;
  // Bound to the difference AND the currency it was accepted in: another currency is another amount.
  const bound = ack !== null && current !== null && BigInt(ack.difference) === current && ack.currency === values.currency;
  return {
    values,
    arithmetic,
    acknowledged: bound ? { reason: ack.reason, difference: ack.difference } : null,
    status: arithmetic.status,
  };
}

/** The JSON a header's `arithmetic` key holds (bigint as text). */
export function arithmeticJson(a: Arithmetic): Record<string, unknown> {
  return a.status === 'UNKNOWN'
    ? { status: 'UNKNOWN' }
    : { status: a.status, expected: a.expected.toString(), actual: a.actual.toString(), difference: a.difference.toString(), ...(a.assumed ? { assumed: a.assumed } : {}) };
}

/** Whether the batch can be approved now, decided from the derived flags and differences: never from a client's word. */
export function approvalOf(rows: readonly RowView[], header: HeaderView, processingFiles = 0): ApprovalVerdict {
  const live = rows.filter((r) => !r.removed);
  const current = header.arithmetic.status === 'MISMATCH' ? header.arithmetic.difference : null;
  const verdict = canApprove(
    live.map((r) => ({
      flags: r.derived,
      mismatchDifference: r.arithmetic.status === 'MISMATCH' ? r.arithmetic.difference : null,
      reviewed: r.reviewed && (r.note ?? '').trim() !== '' ? { note: r.note ?? '', flags: r.ack.flags } : null,
      mismatchAcknowledged: r.ack.mismatch ? { reason: r.ack.mismatch.reason, difference: BigInt(r.ack.mismatch.difference) } : null,
    })),
    {
      status: header.status,
      difference: current,
      acknowledgedReason: header.acknowledged?.reason ?? null,
      acknowledgedDifference: header.acknowledged ? BigInt(header.acknowledged.difference) : null,
    },
  );
  // A file still waiting to be read, or being read, may still bring lines: the batch is not ready while any is.
  if (processingFiles > 0) return { ok: false, reasons: [{ code: 'FILES_STILL_PROCESSING', files: processingFiles }, ...verdict.reasons] };
  return verdict;
}

/**
 * The verdict token: a hash over everything an approval rests on, so a reviewer approves exactly what they saw. It covers the
 * batch version and supplier, every file (id and status: a second file finishing its reading changes it), every line (version,
 * effective values, match, derived and open flags, acknowledgement, removed or not) and the header (effective values, arithmetic,
 * acknowledgement). It is computed from the full rows whoever asks, so a reader without `cost.view` gets the same token.
 * `batch.get` returns it; the approval computes it again inside its transaction and refuses with `APPROVAL_STALE` on a difference.
 */
export function verdictTokenOf(a: { version: number; supplierId: string | null; files: ReadonlyArray<{ id: string; status: string }>; rows: readonly RowView[]; header: HeaderView }): string {
  const canonical = {
    version: a.version,
    supplierId: a.supplierId,
    files: a.files.map((f) => [f.id, f.status]),
    rows: a.rows.map((r) =>
      r.removed
        ? [r.id, r.version, true]
        : [
            r.id,
            r.version,
            false,
            r.fileId,
            r.lineNo,
            LINE_FIELDS.map((f) => r.line[f]),
            r.line.unclear,
            r.matchedProductId,
            r.matchedUnitId,
            r.matchState,
            r.derived,
            r.open,
            arithmeticJson(r.arithmetic),
            r.ack,
            r.reviewed,
            r.note,
          ],
    ),
    header: [HEADER_FIELDS.map((f) => a.header.values[f]), arithmeticJson(a.header.arithmetic), a.header.acknowledged, a.header.status],
  };
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

export type ApprovalVerdict = { ok: boolean; reasons: Array<ApprovalReason | { code: 'FILES_STILL_PROCESSING'; files: number }> };

// Writing ---------------------------------------------------------------------------------------------------------------

/** Row lock on the batch: a parallel edit, rematch, extraction or cancel waits here. The business is part of the match. */
export async function lockBatch(tx: ScopedTx, restaurantId: string, batchId: string): Promise<void> {
  // eslint-disable-next-line no-restricted-properties -- row lock on the batch; no tenant data is read through it
  await tx.$queryRaw`SELECT "id" FROM "PhIntakeBatch" WHERE "id" = ${batchId} AND "restaurantId" = ${restaurantId} FOR UPDATE`;
}

/**
 * Marks the batch as worked on (its `updatedAt`, which the 30-day expiry reads) without touching its version: every intake write
 * that holds the batch lock calls this, so a batch under review never looks idle. Row, file and header edits otherwise leave the
 * batch row alone.
 */
export async function touchBatch(tx: ScopedTx, batchId: string, now: Date): Promise<void> {
  await tx.phIntakeBatch.updateMany({ where: { id: batchId }, data: { updatedAt: now } });
}

/** All rows of a batch, in file then line order. */
export async function loadRows(tx: ScopedDb, batchId: string): Promise<RowRecord[]> {
  const files = await tx.phIntakeFile.findMany({ where: { batchId }, select: { id: true }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
  const rows = await tx.phIntakeRow.findMany({ where: { fileId: { in: files.map((f) => f.id) } }, select: ROW_SELECT });
  const order = new Map(files.map((f, i) => [f.id, i]));
  return (rows as unknown as RowRecord[]).sort((a, b) => (order.get(a.fileId) ?? 0) - (order.get(b.fileId) ?? 0) || a.lineNo - b.lineNo);
}

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
const toJson = (value: unknown): { [key: string]: Json } => JSON.parse(JSON.stringify(value)) as { [key: string]: Json };

/**
 * Brings every row's stored `flags` and acknowledgement in step with what is derived now, and the header's `arithmetic` with the
 * lines (the batch's version is not touched: a line edit does not stale a header edit). Returns the evaluated rows.
 */
export async function recomputeBatch(tx: ScopedTx, batchId: string, now: Date): Promise<{ rows: RowView[]; header: HeaderView }> {
  const rows = evaluateRows(await loadRows(tx, batchId), now);
  for (const v of rows) {
    // `flags` stores what the row raises (sorted); the open subset is derived on read.
    const flags = v.derived;
    if (flags.join() !== v.stored.flags.join() || !sameAck(v.ack, v.stored.ack)) {
      await tx.phIntakeRow.updateMany({ where: { id: v.id }, data: { flags, acknowledged: toJson(v.ack) } });
    }
  }
  const batch = await tx.phIntakeBatch.findFirst({ where: { id: batchId }, select: { header: true } });
  const stored = asObject(batch?.header) as StoredHeader;
  const header = headerView(stored, rows);
  const next = { ...stored, arithmetic: arithmeticJson(header.arithmetic) };
  if (header.acknowledged === null && stored.acknowledged) delete next.acknowledged;
  if (JSON.stringify(next) !== JSON.stringify(stored)) await tx.phIntakeBatch.updateMany({ where: { id: batchId }, data: { header: toJson(next) } });
  return { rows, header };
}

/**
 * A pack unit is about to be removed (review I5): the lines of an OPEN or CANCELLED batch matched to it go back to unmatched and
 * their flags are recomputed in the same transaction (a cancelled batch is dead, it holds nothing). A line of an APPROVED batch
 * is history that points at the unit: the removal is refused by the caller (`UNIT_IN_USE`) when this returns `blocked`.
 *
 * The batches are locked (in id order, as every writer of rows does) BEFORE the status is read, so an approval that is running
 * has finished (or has not started) when the status is looked at: a line cannot slip into an approved batch between the check
 * and the delete. The foreign key on the line is the last guard (the caller maps its violation to `UNIT_IN_USE`).
 */
export async function clearUnitMatches(tx: ScopedTx, restaurantId: string, unitIds: readonly string[], now: Date): Promise<{ cleared: number; blocked: number }> {
  if (unitIds.length === 0) return { cleared: 0, blocked: 0 };
  const find = () =>
    tx.phIntakeRow.findMany({
      where: { matchedUnitId: { in: [...unitIds] } },
      select: { id: true, file: { select: { batchId: true, batch: { select: { status: true } } } } },
    });
  const batchIds = [...new Set((await find()).map((r) => r.file.batchId))].sort();
  if (batchIds.length === 0) return { cleared: 0, blocked: 0 };
  for (const batchId of batchIds) await lockBatch(tx, restaurantId, batchId);
  // Read again under the locks: the statuses and the rows are the settled ones.
  const rows = await find();
  const clearable = rows.filter((r) => r.file.batch.status !== 'APPROVED');
  const blocked = rows.length - clearable.length;
  if (clearable.length === 0) return { cleared: 0, blocked };
  await tx.phIntakeRow.updateMany({
    where: { id: { in: clearable.map((r) => r.id) } },
    data: { matchedProductId: null, matchedUnitId: null, matchState: 'UNMATCHED', candidates: [], version: { increment: 1 } },
  });
  for (const batchId of [...new Set(clearable.map((r) => r.file.batchId))].sort()) await recomputeBatch(tx, batchId, now);
  return { cleared: clearable.length, blocked };
}
