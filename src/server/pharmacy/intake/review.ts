import { createHash } from 'node:crypto';
import { z } from 'zod';
import { scopedClient, type ScopedTx } from '@/server/data/tenant-db';
import {
  barcodeForms,
  parseExpiry,
  parseGs1,
  parseMoneyMinor,
  parseQuantity,
  rankMatches,
  type Candidate,
  type Flag,
} from '@/server/domain/pharmacy/intake';
import { normalizeForSearch } from '@/server/domain/pharmacy/product-identity';
import { packLabelOf } from '@/server/domain/pharmacy/units';
import type { AuditEntry } from '@/server/studio/framework/action';
import { StudioError } from '@/server/studio/framework/result';
import { cleanText, NS_CLIENT_KEY } from '../suppliers';
import {
  arithmeticJson,
  effectiveHeader,
  effectiveLine,
  evaluateRows,
  headerView,
  loadRows,
  lockBatch,
  recomputeBatch,
  ROW_SELECT,
  type Ack,
  type RowRecord,
  type RowView,
  type StoredHeader,
} from './rows';

/**
 * Invoice intake, step three (R5-8, R5-9, R5-10, R5-13): matching lines to the catalog, and the review edits. This file and
 * `extract.ts` are the only writers of a row's edits, match and acknowledgement (`rows.ts` keeps the flags in step).
 *
 * - Matching never picks between doubts: `rankMatches` says MATCHED, AMBIGUOUS or UNMATCHED and a person's choice (CHOSEN) is never
 *   overwritten. Archived products are not matched. The catalog is read once per call (three statements whatever the number of
 *   lines); the per-line work is in memory.
 * - A line's `extracted` JSON is never written here. A person's values go to `edited` (over the model's reading), the removal of a
 *   line is `edited.removed`, a line a person added has `extracted = {}` and `edited.source = 'manual'`, and a lot or expiry read
 *   from a barcode is marked in `edited.fieldSources`. Flags are recomputed from the stored values after every write.
 * - Audit: ids, field NAMES and flag codes. Never a value, a note, a name or a barcode.
 *
 * Lock order (extends files.ts): client key (advisory, 7201) -> the batch row FOR UPDATE -> the rows of that batch.
 */

type Everyone = Parameters<typeof scopedClient>[0];
type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
const toJson = (value: unknown): { [key: string]: Json } => JSON.parse(JSON.stringify(value)) as { [key: string]: Json };
const asObject = (value: unknown): Record<string, unknown> => (value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {});

const lineNotFound = () => new StudioError('NOT_FOUND', 'Line not found');
const batchNotFound = () => new StudioError('NOT_FOUND', 'Batch not found');
const notOpen = () => new StudioError('CONFLICT', 'Only an open batch can be edited', { phCode: 'BATCH_NOT_OPEN' });
const removedLine = () => new StudioError('CONFLICT', 'This line was removed', { phCode: 'ROW_REMOVED' });
const keyMismatch = () => new StudioError('CONFLICT', 'This key was already used for a different change', { phCode: 'CLIENT_KEY_MISMATCH' });
const invalid = (field: string, message: string, phCode: string) => new StudioError('INVALID', message, { [field]: message, phCode });

export type Audit = (entry: AuditEntry) => void;

// Matching -------------------------------------------------------------------------------------------------------------

export interface MatchSummary {
  matched: number;
  ambiguous: number;
  unmatched: number;
  chosen: number;
}

/** At most this many catalog products are compared with one line (those sharing the start of a word of its name, or a barcode). */
const MAX_COMPARED = 300;

/** The start of a word, so a misspelt or cut word still finds its products (the ranking decides what is close enough). */
const stem = (token: string): string => token.slice(0, 3);

/**
 * Matches the lines of one batch inside `tx` (the batch row is locked by the caller). Lines a person chose and lines a person
 * removed are left alone. Reads the catalog in three statements however many lines there are.
 */
export async function matchInTx(tx: ScopedTx, batchId: string, now: Date): Promise<MatchSummary> {
  const rows = await loadRows(tx, batchId);
  const targets = rows.filter((r) => r.matchState !== 'CHOSEN' && asObject(r.edited).removed !== true);
  const summary: MatchSummary = { matched: 0, ambiguous: 0, unmatched: 0, chosen: rows.filter((r) => r.matchState === 'CHOSEN').length };
  if (targets.length > 0) {
    const lines = new Map(targets.map((r) => [r.id, effectiveLine(r.extracted, r.edited)]));
    const codes = [...new Set([...lines.values()].flatMap((l) => (l.barcodeText === null ? [] : barcodeForms(l.barcodeText))))];
    const [products, hits] = [
      await tx.phProduct.findMany({
        where: { active: true },
        select: { id: true, tradeName: true, strength: true, form: true, units: { select: { id: true, level: true, label: true, baseQty: true, sellable: true } } },
      }),
      codes.length === 0 ? [] : await tx.phBarcode.findMany({ where: { code: { in: codes }, product: { active: true } }, select: { code: true, productId: true, unitId: true } }),
    ];

    const byToken = new Map<string, string[]>();
    const candidateOf = new Map<string, Candidate>();
    const hitsOf = new Map<string, Array<{ code: string; unitId: string }>>();
    for (const h of hits) hitsOf.set(h.productId, [...(hitsOf.get(h.productId) ?? []), { code: h.code, unitId: h.unitId }]);
    for (const p of products) {
      const top = [...p.units].sort((a, b) => b.level - a.level)[0];
      candidateOf.set(p.id, {
        productId: p.id,
        tradeName: p.tradeName,
        strength: p.strength,
        form: p.form,
        packLabel: packLabelOf(p.units),
        manufacturer: '',
        barcodes: hitsOf.get(p.id) ?? [],
        defaultUnitId: top?.id ?? null,
      });
      for (const token of new Set(normalizeForSearch(p.tradeName).split(' ').filter(Boolean).map(stem))) byToken.set(token, [...(byToken.get(token) ?? []), p.id]);
    }

    for (const r of targets) {
      const line = lines.get(r.id)!;
      const ids = new Set<string>();
      for (const token of new Set(normalizeForSearch(line.name ?? '').split(' ').filter(Boolean).map(stem))) for (const id of byToken.get(token) ?? []) ids.add(id);
      for (const productId of hitsOf.keys()) ids.add(productId);
      const compared = [...ids].sort().slice(0, MAX_COMPARED).map((id) => candidateOf.get(id)!);
      const result = rankMatches({ barcode: line.barcodeText, name: line.name ?? '', strength: line.strength ?? '', form: line.form ?? '', pack: line.pack ?? '' }, compared);
      const productId = result.status === 'MATCHED' ? (result.productId ?? null) : null;
      const unitId = productId === null ? null : (result.unitId ?? null);
      const candidates = result.candidates.map((c) => ({ productId: c.productId, score: c.score }));
      const state = result.status === 'MATCHED' ? 'MATCHED' : result.status;
      if (result.status === 'MATCHED') summary.matched += 1;
      else if (result.status === 'AMBIGUOUS') summary.ambiguous += 1;
      else summary.unmatched += 1;
      const same =
        r.matchedProductId === productId && r.matchedUnitId === unitId && r.matchState === state && JSON.stringify(r.candidates) === JSON.stringify(candidates);
      if (!same) {
        await tx.phIntakeRow.updateMany({
          where: { id: r.id },
          data: { matchedProductId: productId, matchedUnitId: unitId, matchState: state, candidates: toJson(candidates), version: { increment: 1 } },
        });
      }
    }
  }
  await recomputeBatch(tx, batchId, now);
  return summary;
}

/**
 * Matches the lines of an OPEN batch (called by `extractFile` once the rows are saved, and by the rematch action through
 * `matchInTx`). `ctx` names the business; the batch is locked first. A batch that is not open is left as it is (null).
 */
export async function matchRows(db: Everyone, ctx: { restaurantId: string }, batchId: string, now: Date = new Date()): Promise<MatchSummary | null> {
  const writer = scopedClient(db, { restaurantId: ctx.restaurantId, allBranches: true });
  return writer.$transaction(async (tx) => {
    await lockBatch(tx, ctx.restaurantId, batchId);
    const batch = await tx.phIntakeBatch.findFirst({ where: { id: batchId }, select: { status: true } });
    if (!batch || batch.status !== 'OPEN') return null;
    return matchInTx(tx, batchId, now);
  });
}

// Finding what to edit ---------------------------------------------------------------------------------------------------

interface Open {
  batchId: string;
  version: number;
  header: StoredHeader;
  supplierId: string | null;
}

/** An OPEN batch of the place's branch, locked. Another branch's or business's batch is not found. */
async function openBatch(tx: ScopedTx, a: { restaurantId: string; branchId: string; batchId: string }): Promise<Open> {
  const found = await tx.phIntakeBatch.findFirst({ where: { id: a.batchId, branchId: a.branchId }, select: { id: true } });
  if (!found) throw batchNotFound();
  await lockBatch(tx, a.restaurantId, a.batchId);
  const batch = await tx.phIntakeBatch.findFirst({ where: { id: a.batchId }, select: { status: true, version: true, header: true, supplierId: true } });
  if (!batch) throw batchNotFound();
  if (batch.status !== 'OPEN') throw notOpen();
  return { batchId: a.batchId, version: batch.version, header: asObject(batch.header) as StoredHeader, supplierId: batch.supplierId };
}

/** The batch of a row, locked and OPEN, and the row as it is now. */
async function openRow(tx: ScopedTx, a: { restaurantId: string; branchId: string; rowId: string }): Promise<Open & { row: RowRecord }> {
  const found = await tx.phIntakeRow.findFirst({ where: { id: a.rowId }, select: { file: { select: { batchId: true } } } });
  if (!found) throw lineNotFound();
  const owner = await tx.phIntakeBatch.findFirst({ where: { id: found.file.batchId, branchId: a.branchId }, select: { id: true } });
  if (!owner) throw lineNotFound();
  const batch = await openBatch(tx, { restaurantId: a.restaurantId, branchId: a.branchId, batchId: owner.id });
  const row = await tx.phIntakeRow.findFirst({ where: { id: a.rowId }, select: ROW_SELECT });
  if (!row) throw lineNotFound();
  return { ...batch, row: row as unknown as RowRecord };
}

const viewOf = (views: readonly RowView[], id: string): RowView => views.find((v) => v.id === id)!;
const codes = (flags: readonly Flag[]): Flag[] => [...flags];

export interface RowResult {
  rowId: string;
  version: number;
  /** The flags still open after the acknowledgement, recomputed on the server. */
  flags: Flag[];
  replayed: boolean;
}

// Editing a line ---------------------------------------------------------------------------------------------------------

const amount = z.union([z.number().int().min(0).max(Number.MAX_SAFE_INTEGER), z.string().trim().min(1).max(40)]).nullable().optional();
const wide = (max: number) => z.string().max(max).nullable().optional();

/** What a person may change on a line. Every key is optional; `null` clears a value. Unknown keys are refused. */
export const rowPatchInput = z
  .object({
    name: wide(200),
    strength: wide(60),
    form: wide(60),
    pack: wide(60),
    quantity: amount,
    bonus: amount,
    unitCost: amount,
    lineTotal: amount,
    lot: wide(100),
    expiry: wide(40),
    barcodeText: wide(200),
    freeOfCharge: z.boolean().optional(),
  })
  .strict()
  .refine((p) => Object.values(p).some((v) => v !== undefined), { message: 'Change at least one field' });
export type RowPatch = z.infer<typeof rowPatchInput>;

const text = (value: string | null): string | null => {
  if (value === null) return null;
  const t = cleanText(value);
  return t === '' ? null : t;
};

function count(field: string, value: string | number | null, allowZero: boolean): number | null {
  if (value === null) return null;
  if (typeof value === 'number') return value;
  if (allowZero && /^[0٠]+$/.test(value.trim())) return 0;
  const n = parseQuantity(value);
  if (n === null) throw invalid(`patch.${field}`, 'Enter a whole number of units', 'INVALID_QUANTITY');
  return n;
}

function money(field: string, value: string | number | null, currency: 'IQD' | 'USD' | null): number | null {
  if (value === null) return null;
  if (typeof value === 'number') return value;
  if (currency === null) throw invalid(`patch.${field}`, 'Choose the invoice currency first', 'CURRENCY_UNKNOWN');
  const minor = parseMoneyMinor(value, currency);
  if (minor === null || minor > BigInt(Number.MAX_SAFE_INTEGER)) throw invalid(`patch.${field}`, 'Enter an amount in the invoice currency', 'INVALID_MONEY');
  return Number(minor);
}

/** The edits a patch makes, validated with the domain parsers; text is stored as typed (trimmed). */
function parsePatch(patch: RowPatch, currency: 'IQD' | 'USD' | null, now: Date): Record<string, Json> {
  const out: Record<string, Json> = {};
  for (const key of ['name', 'strength', 'form', 'pack', 'lot', 'barcodeText'] as const) if (patch[key] !== undefined) out[key] = text(patch[key]!);
  if (patch.quantity !== undefined) out.quantity = count('quantity', patch.quantity, false);
  if (patch.bonus !== undefined) out.bonus = count('bonus', patch.bonus, true);
  if (patch.unitCost !== undefined) out.unitCost = money('unitCost', patch.unitCost, currency);
  if (patch.lineTotal !== undefined) out.lineTotal = money('lineTotal', patch.lineTotal, currency);
  if (patch.expiry !== undefined) {
    const t = text(patch.expiry);
    if (t !== null && parseExpiry(t, now) === null) throw invalid('patch.expiry', 'Enter a date such as 03/2028 or 2028-03-31', 'INVALID_EXPIRY');
    out.expiry = t;
  }
  if (patch.freeOfCharge !== undefined) out.freeOfCharge = patch.freeOfCharge;
  return out;
}

const stable = (value: unknown): string => JSON.stringify(value, (_k, v) => (v !== null && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1))) : v));

/**
 * Applies a patch to a line's `edited` (never to `extracted`), then recomputes every flag of the batch from the stored values.
 * `version`, when given, must be the line's current one. A repeat of the same `clientKey` by the same person with the same patch
 * answers the stored state; with another patch it is `CLIENT_KEY_MISMATCH`. (Only the line's latest key is remembered.)
 */
export async function updateRow(
  tx: ScopedTx,
  a: { restaurantId: string; branchId: string; userId: string; rowId: string; version?: number; patch: RowPatch; clientKey: string; now: Date; audit: Audit },
): Promise<RowResult> {
  // eslint-disable-next-line no-restricted-properties -- an advisory lock touches no tenant rows: it only serialises one client key
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${NS_CLIENT_KEY}::int, hashtext(${`${a.restaurantId}:${a.clientKey}`}))`;
  const open = await openRow(tx, a);
  const hash = createHash('sha256').update(stable([a.rowId, a.userId, a.patch])).digest('hex');
  if (open.row.lastKey === a.clientKey) {
    if (open.row.lastKeyHash !== hash) throw keyMismatch();
    const now = viewOf(evaluateRows(await loadRows(tx, open.batchId), a.now), a.rowId);
    return { rowId: a.rowId, version: now.version, flags: codes(now.open), replayed: true };
  }
  if (a.version !== undefined && a.version !== open.row.version) throw new StudioError('CONFLICT', 'Someone else changed this line: reload it', { phCode: 'ROW_STALE' });
  const edited = asObject(open.row.edited);
  if (edited.removed === true) throw removedLine();

  const before = viewOf(evaluateRows(await loadRows(tx, open.batchId), a.now), a.rowId);
  const parsed = parsePatch(a.patch, effectiveHeader(open.header).currency, a.now);
  const next: Record<string, unknown> = { ...edited, ...parsed };
  // A value a person typed is theirs now: it is no longer "read from the barcode".
  const sources = { ...asObject(edited.fieldSources) };
  for (const key of Object.keys(parsed)) delete sources[key];
  if (Object.keys(sources).length > 0) next.fieldSources = sources;
  else delete next.fieldSources;

  await tx.phIntakeRow.updateMany({ where: { id: a.rowId }, data: { edited: toJson(next), version: { increment: 1 }, lastKey: a.clientKey, lastKeyHash: hash } });
  const after = viewOf((await recomputeBatch(tx, open.batchId, a.now)).rows, a.rowId);
  a.audit({
    action: 'ph.intake.row.update',
    entityType: 'PhIntakeRow',
    entityId: a.rowId,
    changes: { fields: { before: null, after: Object.keys(parsed).sort() }, flags: { before: codes(before.open), after: codes(after.open) } },
  });
  return { rowId: a.rowId, version: after.version, flags: codes(after.open), replayed: false };
}

// Matches chosen by a person ---------------------------------------------------------------------------------------------

export const matchChoiceInput = z.object({ rowId: z.string().min(1).max(64), productId: z.string().min(1).max(64), unitId: z.string().min(1).max(64) });

/** A person chooses the product and unit of a line. The product must be an active one of the business and the unit one of its units. */
export async function chooseMatch(
  tx: ScopedTx,
  a: { restaurantId: string; branchId: string; rowId: string; productId: string; unitId: string; now: Date; audit: Audit },
): Promise<RowResult> {
  const open = await openRow(tx, a);
  if (asObject(open.row.edited).removed === true) throw removedLine();
  const product = await tx.phProduct.findFirst({ where: { id: a.productId }, select: { active: true, units: { where: { id: a.unitId }, select: { id: true } } } });
  if (!product) throw new StudioError('NOT_FOUND', 'Product not found');
  if (!product.active) throw new StudioError('CONFLICT', 'This product is archived', { phCode: 'PRODUCT_ARCHIVED' });
  if (product.units.length === 0) throw invalid('unitId', 'This unit is not one of the product’s units', 'UNIT_NOT_OF_PRODUCT');
  const before = viewOf(evaluateRows(await loadRows(tx, open.batchId), a.now), a.rowId);
  await tx.phIntakeRow.updateMany({
    where: { id: a.rowId },
    data: { matchedProductId: a.productId, matchedUnitId: a.unitId, matchState: 'CHOSEN', version: { increment: 1 } },
  });
  const after = viewOf((await recomputeBatch(tx, open.batchId, a.now)).rows, a.rowId);
  a.audit({
    action: 'ph.intake.row.match',
    entityType: 'PhIntakeRow',
    entityId: a.rowId,
    changes: {
      matchState: { before: before.matchState, after: 'CHOSEN' },
      productId: { before: before.matchedProductId, after: a.productId },
      unitId: { before: before.matchedUnitId, after: a.unitId },
      flags: { before: codes(before.open), after: codes(after.open) },
    },
  });
  return { rowId: a.rowId, version: after.version, flags: codes(after.open), replayed: false };
}

/** Takes a line's match back: it is UNMATCHED (and MISSING) until the matcher or a person decides again. */
export async function clearMatch(tx: ScopedTx, a: { restaurantId: string; branchId: string; rowId: string; now: Date; audit: Audit }): Promise<RowResult> {
  const open = await openRow(tx, a);
  if (asObject(open.row.edited).removed === true) throw removedLine();
  const before = viewOf(evaluateRows(await loadRows(tx, open.batchId), a.now), a.rowId);
  await tx.phIntakeRow.updateMany({ where: { id: a.rowId }, data: { matchedProductId: null, matchedUnitId: null, matchState: 'UNMATCHED', version: { increment: 1 } } });
  const after = viewOf((await recomputeBatch(tx, open.batchId, a.now)).rows, a.rowId);
  a.audit({
    action: 'ph.intake.row.clearMatch',
    entityType: 'PhIntakeRow',
    entityId: a.rowId,
    changes: { matchState: { before: before.matchState, after: 'UNMATCHED' }, flags: { before: codes(before.open), after: codes(after.open) } },
  });
  return { rowId: a.rowId, version: after.version, flags: codes(after.open), replayed: false };
}

// Acknowledging ----------------------------------------------------------------------------------------------------------

export const reviewInput = z.object({
  rowId: z.string().min(1).max(64),
  note: z.string().trim().min(1, 'Write what you checked').max(500, 'Use at most 500 characters'),
  /** The reason for a line total that does not match quantity x cost; without it MATH_MISMATCH stays open. */
  mismatchReason: z.string().trim().min(1, 'Write what you checked').max(500, 'Use at most 500 characters').optional(),
});

/**
 * Records that a person looked at a line. The note clears exactly the flags the line raises NOW (MODEL_UNCLEAR, EXPIRED,
 * DUPLICATE_LINE: the others need data or a choice); a flag raised by a later edit is not covered. A mismatch reason is bound to
 * the difference on screen: change the line and it is open again.
 */
export async function reviewRow(
  tx: ScopedTx,
  a: { restaurantId: string; branchId: string; rowId: string; note: string; mismatchReason?: string; now: Date; audit: Audit },
): Promise<RowResult> {
  const open = await openRow(tx, a);
  if (asObject(open.row.edited).removed === true) throw removedLine();
  const before = viewOf(evaluateRows(await loadRows(tx, open.batchId), a.now), a.rowId);
  const ack: Ack = {
    flags: [...before.derived],
    mismatch:
      a.mismatchReason !== undefined && before.arithmetic.status === 'MISMATCH'
        ? { reason: cleanText(a.mismatchReason), difference: before.arithmetic.difference.toString() }
        : before.ack.mismatch,
  };
  await tx.phIntakeRow.updateMany({ where: { id: a.rowId }, data: { reviewed: true, note: cleanText(a.note), acknowledged: toJson(ack), version: { increment: 1 } } });
  const after = viewOf((await recomputeBatch(tx, open.batchId, a.now)).rows, a.rowId);
  a.audit({
    action: 'ph.intake.row.review',
    entityType: 'PhIntakeRow',
    entityId: a.rowId,
    changes: { reviewed: { before: before.reviewed, after: true }, acknowledgedFlags: { before: codes(before.ack.flags), after: codes(after.ack.flags) }, flags: { before: codes(before.open), after: codes(after.open) } },
  });
  return { rowId: a.rowId, version: after.version, flags: codes(after.open), replayed: false };
}

// Reading a barcode ------------------------------------------------------------------------------------------------------

/**
 * Takes the lot and expiry a GS1 barcode carries into the line, only where the line has none (a printed or typed value is never
 * replaced). The values go to `edited` with `fieldSources.<field> = 'barcode'`. Refused when there is nothing to take.
 */
export async function fillFromBarcode(
  tx: ScopedTx,
  a: { restaurantId: string; branchId: string; rowId: string; now: Date; audit: Audit },
): Promise<RowResult & { filled: string[] }> {
  const open = await openRow(tx, a);
  const edited = asObject(open.row.edited);
  if (edited.removed === true) throw removedLine();
  const views = evaluateRows(await loadRows(tx, open.batchId), a.now);
  const before = viewOf(views, a.rowId);
  const gs1 = (before.line.barcodeText === null ? null : parseGs1(before.line.barcodeText)) ?? (asObject(open.row.extracted).gs1 as ReturnType<typeof parseGs1> | undefined) ?? null;
  const patch: Record<string, Json> = {};
  if (gs1?.lot && before.line.lot === null) patch.lot = gs1.lot;
  if (gs1?.expiry && before.line.expiry === null) patch.expiry = gs1.expiry.date;
  const filled = Object.keys(patch).sort();
  if (filled.length === 0) {
    if (!gs1 || (!gs1.lot && !gs1.expiry)) throw new StudioError('INVALID', 'This barcode holds no lot or expiry to use', { phCode: 'NOTHING_TO_FILL' });
    // The barcode has a lot or expiry, but the line has its own: nothing is replaced.
    return { rowId: a.rowId, version: before.version, flags: codes(before.open), replayed: false, filled };
  }
  const sources = { ...asObject(edited.fieldSources) };
  for (const key of filled) sources[key] = 'barcode';
  await tx.phIntakeRow.updateMany({ where: { id: a.rowId }, data: { edited: toJson({ ...edited, ...patch, fieldSources: sources }), version: { increment: 1 } } });
  const after = viewOf((await recomputeBatch(tx, open.batchId, a.now)).rows, a.rowId);
  a.audit({
    action: 'ph.intake.row.fillFromBarcode',
    entityType: 'PhIntakeRow',
    entityId: a.rowId,
    changes: { fields: { before: null, after: filled }, source: { before: null, after: 'barcode' }, flags: { before: codes(before.open), after: codes(after.open) } },
  });
  return { rowId: a.rowId, version: after.version, flags: codes(after.open), replayed: false, filled };
}

// Adding and removing lines ----------------------------------------------------------------------------------------------

/** A line the model dropped, added by a person to a file of an OPEN batch: empty, `manual`, MISSING until it is filled in. */
export async function addRow(
  tx: ScopedTx,
  a: { restaurantId: string; branchId: string; fileId: string; now: Date; audit: Audit },
): Promise<{ rowId: string; lineNo: number }> {
  const file = await tx.phIntakeFile.findFirst({ where: { id: a.fileId }, select: { batchId: true, pages: true } });
  if (!file) throw new StudioError('NOT_FOUND', 'File not found');
  const open = await openBatch(tx, { restaurantId: a.restaurantId, branchId: a.branchId, batchId: file.batchId });
  const last = await tx.phIntakeRow.aggregate({ where: { fileId: a.fileId }, _max: { lineNo: true } });
  const lineNo = (last._max.lineNo ?? 0) + 1;
  const made = await tx.phIntakeRow.create({
    data: { restaurantId: a.restaurantId, fileId: a.fileId, lineNo, page: 1, extracted: {}, edited: { source: 'manual' }, flags: ['MISSING'] },
    select: { id: true },
  });
  await recomputeBatch(tx, open.batchId, a.now);
  a.audit({ action: 'ph.intake.row.add', entityType: 'PhIntakeRow', entityId: made.id, changes: { lineNo: { before: null, after: lineNo }, fileId: { before: null, after: a.fileId } } });
  return { rowId: made.id, lineNo };
}

/** Takes a line out of the review. The row stays (`edited.removed`), so before and after can be reproduced; approval ignores it. */
export async function removeRow(tx: ScopedTx, a: { restaurantId: string; branchId: string; rowId: string; now: Date; audit: Audit }): Promise<RowResult> {
  const open = await openRow(tx, a);
  const edited = asObject(open.row.edited);
  if (edited.removed === true) return { rowId: a.rowId, version: open.row.version, flags: [], replayed: true };
  const before = viewOf(evaluateRows(await loadRows(tx, open.batchId), a.now), a.rowId);
  await tx.phIntakeRow.updateMany({ where: { id: a.rowId }, data: { edited: toJson({ ...edited, removed: true }), version: { increment: 1 } } });
  const after = viewOf((await recomputeBatch(tx, open.batchId, a.now)).rows, a.rowId);
  a.audit({
    action: 'ph.intake.row.remove',
    entityType: 'PhIntakeRow',
    entityId: a.rowId,
    changes: { removed: { before: false, after: true }, flags: { before: codes(before.open), after: [] } },
  });
  return { rowId: a.rowId, version: after.version, flags: [], replayed: false };
}

// The header -------------------------------------------------------------------------------------------------------------

export const headerPatchInput = z
  .object({
    invoiceNumber: wide(100),
    invoiceDate: wide(40),
    currency: z.enum(['IQD', 'USD']).nullable().optional(),
    total: amount,
    discount: amount,
    tax: amount,
    supplierId: z.string().min(1).max(64).nullable().optional(),
  })
  .strict()
  .refine((p) => Object.values(p).some((v) => v !== undefined), { message: 'Change at least one field' });
export type HeaderPatch = z.infer<typeof headerPatchInput>;

export interface HeaderResult {
  batchId: string;
  version: number;
  status: 'OK' | 'MISMATCH' | 'UNKNOWN';
}

/** Edits the invoice's header over the model's reading (`header.edited`); the supplier is checked and goes to the batch. */
export async function updateHeader(
  tx: ScopedTx,
  a: { restaurantId: string; branchId: string; batchId: string; version?: number; patch: HeaderPatch; now: Date; audit: Audit },
): Promise<HeaderResult> {
  const open = await openBatch(tx, a);
  if (a.version !== undefined && a.version !== open.version) throw new StudioError('CONFLICT', 'Someone else changed this invoice: reload it', { phCode: 'BATCH_STALE' });
  const currency = a.patch.currency !== undefined ? a.patch.currency : effectiveHeader(open.header).currency;
  const edits: Record<string, Json> = {};
  if (a.patch.invoiceNumber !== undefined) edits.invoiceNumber = text(a.patch.invoiceNumber);
  if (a.patch.currency !== undefined) edits.currency = a.patch.currency;
  if (a.patch.invoiceDate !== undefined) {
    const t = text(a.patch.invoiceDate);
    const day = t === null ? null : parseExpiry(t, a.now);
    if (t !== null && (day === null || day.precision !== 'DAY')) throw invalid('patch.invoiceDate', 'Enter the invoice date as a day, such as 2028-03-31', 'INVALID_DATE');
    edits.invoiceDate = day?.date ?? null;
  }
  for (const key of ['total', 'discount', 'tax'] as const) if (a.patch[key] !== undefined) edits[key] = money(key, a.patch[key]!, currency);
  const fields = [...Object.keys(edits), ...(a.patch.supplierId !== undefined ? ['supplierId'] : [])].sort();

  let supplierId = open.supplierId;
  if (a.patch.supplierId !== undefined) {
    supplierId = a.patch.supplierId;
    if (supplierId !== null) {
      const supplier = await tx.phSupplier.findFirst({ where: { id: supplierId }, select: { active: true } });
      if (!supplier) throw new StudioError('NOT_FOUND', 'Supplier not found');
      if (!supplier.active) throw new StudioError('CONFLICT', 'This supplier is archived', { phCode: 'SUPPLIER_ARCHIVED' });
    }
  }
  const beforeStatus = headerView(open.header, evaluateRows(await loadRows(tx, open.batchId), a.now)).status;
  const header = toJson({ ...open.header, edited: { ...asObject(open.header.edited), ...edits } });
  await tx.phIntakeBatch.updateMany({ where: { id: open.batchId }, data: { header, supplierId, version: { increment: 1 } } });
  const { header: view } = await recomputeBatch(tx, open.batchId, a.now);
  a.audit({
    action: 'ph.intake.header.update',
    entityType: 'PhIntakeBatch',
    entityId: open.batchId,
    changes: { fields: { before: null, after: fields }, headerStatus: { before: beforeStatus, after: view.status } },
  });
  return { batchId: open.batchId, version: open.version + 1, status: view.status };
}

export const headerAckInput = z.object({
  batchId: z.string().min(1).max(64),
  reason: z.string().trim().min(1, 'Write what you checked').max(500, 'Use at most 500 characters'),
});

/** Accepts the difference between the printed total and the lines, with a reason, bound to that exact difference. */
export async function acknowledgeHeader(
  tx: ScopedTx,
  a: { restaurantId: string; branchId: string; batchId: string; reason: string; now: Date; audit: Audit },
): Promise<HeaderResult & { difference: string }> {
  const open = await openBatch(tx, a);
  const view = headerView(open.header, evaluateRows(await loadRows(tx, open.batchId), a.now));
  if (view.arithmetic.status !== 'MISMATCH') throw new StudioError('CONFLICT', 'There is no difference to acknowledge', { phCode: 'NO_DIFFERENCE' });
  const difference = view.arithmetic.difference.toString();
  const header = toJson({ ...open.header, acknowledged: { reason: cleanText(a.reason), difference }, arithmetic: arithmeticJson(view.arithmetic) });
  await tx.phIntakeBatch.updateMany({ where: { id: open.batchId }, data: { header, version: { increment: 1 } } });
  a.audit({
    action: 'ph.intake.header.acknowledge',
    entityType: 'PhIntakeBatch',
    entityId: open.batchId,
    changes: { headerDifference: { before: null, after: { difference, currency: view.values.currency } } },
  });
  return { batchId: open.batchId, version: open.version + 1, status: 'MISMATCH', difference };
}

// Rematching -------------------------------------------------------------------------------------------------------------

/** Matches the lines of an OPEN batch again; a person's choices stay. */
export async function rematch(
  tx: ScopedTx,
  a: { restaurantId: string; branchId: string; batchId: string; now: Date; audit: Audit },
): Promise<MatchSummary> {
  await openBatch(tx, a);
  const summary = await matchInTx(tx, a.batchId, a.now);
  a.audit({
    action: 'ph.intake.rematch',
    entityType: 'PhIntakeBatch',
    entityId: a.batchId,
    changes: { matched: { before: null, after: summary.matched }, ambiguous: { before: null, after: summary.ambiguous }, unmatched: { before: null, after: summary.unmatched } },
  });
  return summary;
}
