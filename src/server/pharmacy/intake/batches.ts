import { z } from 'zod';
import type { ScopedClient } from '@/server/data/tenant-db';
import { StudioError } from '@/server/studio/framework/result';
import { approvalOf, effectiveHeader, evaluateRows, headerView, loadRows, verdictTokenOf, type Ack, type RowView, type StoredHeader } from './rows';

/**
 * Invoice intake, reading batches (R5-14: `purchase.manage`). Everything is derived from the stored extraction, edits, match
 * and acknowledgements at read time (`evaluateRows`), so a stale stored flag cannot mislead a reader. Money keys (unit cost,
 * line totals, header amounts, differences, totals) exist only for a role with `cost.view`; amounts are text (bigint on the wire).
 * Another branch's batch, and another business's, is not found.
 */

export const PAGE = 50;

export const batchListInput = z.object({
  status: z.enum(['OPEN', 'APPROVED', 'CANCELLED']).optional(),
  /** Keyset position from the previous page (`createdAt` and id, both fixed for a batch, so a status change cannot move a batch between pages). */
  cursor: z.string().min(1).max(100).nullish(),
  take: z.number().int().min(1).max(PAGE).default(PAGE),
});

const encode = (createdAt: Date, id: string) => Buffer.from(`${createdAt.toISOString()}|${id}`).toString('base64url');
function decode(cursor: string): { createdAt: Date; id: string } {
  const [iso, id] = Buffer.from(cursor, 'base64url').toString().split('|');
  const createdAt = new Date(iso ?? '');
  if (!id || Number.isNaN(createdAt.getTime())) throw new StudioError('INVALID', 'This page position is not valid', { cursor: 'This page position is not valid' });
  return { createdAt, id };
}

const asObject = (value: unknown): Record<string, unknown> => (value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {});
const COST_KEYS: readonly string[] = ['unitCost', 'lineTotal'];
const omitCost = (o: Record<string, unknown>): Record<string, unknown> => Object.fromEntries(Object.entries(o).filter(([k]) => !COST_KEYS.includes(k)));
const HEADER_MONEY: readonly string[] = ['total', 'tax', 'discount'];
const omitHeaderMoney = (o: Record<string, unknown>): Record<string, unknown> => Object.fromEntries(Object.entries(o).filter(([k]) => !HEADER_MONEY.includes(k)));

export interface BatchSummary {
  id: string;
  status: 'OPEN' | 'APPROVED' | 'CANCELLED';
  branchId: string;
  supplierId: string | null;
  supplierName: string | null;
  receiptId: string | null;
  invoiceNumber: string | null;
  currency: 'IQD' | 'USD' | null;
  fileCount: number;
  version: number;
  createdAt: string;
  totalMinor?: string | null;
}

export async function listBatches(
  scoped: ScopedClient,
  input: z.infer<typeof batchListInput> & { branchId?: string },
  withCost: boolean,
): Promise<{ items: BatchSummary[]; nextCursor: string | null }> {
  const at = input.cursor ? decode(input.cursor) : null;
  const rows = await scoped.phIntakeBatch.findMany({
    where: {
      ...(input.status ? { status: input.status } : {}),
      ...(input.branchId ? { branchId: input.branchId } : {}),
      ...(at ? { OR: [{ createdAt: { lt: at.createdAt } }, { createdAt: at.createdAt, id: { lt: at.id } }] } : {}),
    },
    select: { id: true, status: true, branchId: true, supplierId: true, supplier: { select: { name: true } }, receiptId: true, header: true, version: true, createdAt: true, _count: { select: { files: true } } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: input.take + 1,
  });
  const more = rows.length > input.take;
  const page = more ? rows.slice(0, input.take) : rows;
  const last = page[page.length - 1];
  return {
    items: page.map((b) => {
      const header = effectiveHeader(b.header);
      return {
        id: b.id,
        status: b.status,
        branchId: b.branchId,
        supplierId: b.supplierId,
        supplierName: b.supplier?.name ?? null,
        receiptId: b.receiptId,
        invoiceNumber: header.invoiceNumber,
        currency: header.currency,
        fileCount: b._count.files,
        version: b.version,
        createdAt: b.createdAt.toISOString(),
        ...(withCost ? { totalMinor: header.total === null ? null : String(header.total) } : {}),
      };
    }),
    nextCursor: more && last ? encode(last.createdAt, last.id) : null,
  };
}

export interface RowRead {
  id: string;
  fileId: string;
  lineNo: number;
  page: number;
  version: number;
  removed: boolean;
  manual: boolean;
  line: Record<string, unknown>;
  extracted: Record<string, unknown>;
  edited: Record<string, unknown>;
  /** What the row raises now, and what is still open after the reviewer's acknowledgement (both recomputed here). */
  flags: string[];
  openFlags: string[];
  matchState: string;
  match: { productId: string; unitId: string | null; name: string; strength: string; form: string; unitLabel: string | null } | null;
  candidates: Array<{ productId: string; name: string; strength: string; form: string; score: number }>;
  reviewed: boolean;
  note: string | null;
  acknowledged: { flags: string[]; mismatch: { difference?: string } | null };
}

function candidatesOf(raw: unknown): Array<{ productId: string; score: number }> {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((c) => {
    const o = asObject(c);
    return typeof o.productId === 'string' && typeof o.score === 'number' ? [{ productId: o.productId, score: o.score }] : [];
  });
}

const ackOf = (ack: Ack, withCost: boolean): RowRead['acknowledged'] => ({
  flags: ack.flags,
  mismatch: ack.mismatch ? (withCost ? { difference: ack.mismatch.difference } : {}) : null,
});

export async function getBatch(scoped: ScopedClient, batchId: string, branchId: string | undefined, withCost: boolean, now: Date) {
  const batch = await scoped.phIntakeBatch.findFirst({
    where: { id: batchId, ...(branchId ? { branchId } : {}) },
    select: { id: true, status: true, branchId: true, supplierId: true, supplier: { select: { name: true } }, receiptId: true, header: true, version: true, createdAt: true },
  });
  if (!batch) throw new StudioError('NOT_FOUND', 'Batch not found');
  const files = await scoped.phIntakeFile.findMany({
    where: { batchId },
    select: { id: true, status: true, failureCode: true, pages: true, mediaType: true, bytes: true, attempts: true, extractedAt: true },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  const records = await loadRows(scoped, batchId);
  const rows = evaluateRows(records, now);
  const header = headerView(batch.header, rows);
  const approval = approvalOf(rows, header, files.filter((f) => f.status === 'UPLOADED' || f.status === 'EXTRACTING').length);
  const candidateOfRow = new Map(records.map((r) => [r.id, candidatesOf(r.candidates)]));

  const productIds = [...new Set(rows.flatMap((r) => [...(r.matchedProductId ? [r.matchedProductId] : []), ...(candidateOfRow.get(r.id) ?? []).map((c) => c.productId)]))];
  const products = productIds.length === 0 ? [] : await scoped.phProduct.findMany({ where: { id: { in: productIds } }, select: { id: true, tradeName: true, strength: true, form: true, units: { select: { id: true, label: true } } } });
  const byId = new Map(products.map((p) => [p.id, p]));

  const read = (r: RowView): RowRead => {
    const product = r.matchedProductId ? byId.get(r.matchedProductId) : undefined;
    const row: RowRead = {
      id: r.id,
      fileId: r.fileId,
      lineNo: r.lineNo,
      page: r.page,
      version: r.version,
      removed: r.removed,
      manual: r.manual,
      line: r.line as unknown as Record<string, unknown>,
      extracted: r.extracted,
      edited: r.edited,
      flags: r.derived,
      openFlags: r.open,
      matchState: r.matchState,
      match:
        product && r.matchedProductId
          ? { productId: r.matchedProductId, unitId: r.matchedUnitId, name: product.tradeName, strength: product.strength, form: product.form, unitLabel: product.units.find((u) => u.id === r.matchedUnitId)?.label ?? null }
          : null,
      candidates: (candidateOfRow.get(r.id) ?? []).flatMap((c) => {
        const p = byId.get(c.productId);
        return p ? [{ productId: c.productId, name: p.tradeName, strength: p.strength, form: p.form, score: c.score }] : [];
      }),
      reviewed: r.reviewed,
      note: r.note,
      acknowledged: ackOf(r.ack, withCost),
    };
    return withCost ? row : { ...row, line: omitCost(row.line), extracted: omitCost(row.extracted), edited: omitCost(row.edited) };
  };

  const currency = header.values.currency ?? 'UNKNOWN';
  const totals = new Map<string, bigint>();
  for (const r of rows) if (!r.removed && r.line.lineTotal !== null) totals.set(currency, (totals.get(currency) ?? 0n) + BigInt(r.line.lineTotal));

  const stored = asObject(batch.header) as StoredHeader;
  const arithmetic = header.arithmetic;
  return {
    batch: {
      id: batch.id,
      status: batch.status,
      branchId: batch.branchId,
      supplierId: batch.supplierId,
      supplierName: batch.supplier?.name ?? null,
      receiptId: batch.receiptId,
      version: batch.version,
      createdAt: batch.createdAt.toISOString(),
    },
    header: {
      values: withCost ? { ...header.values } : omitHeaderMoney({ ...header.values }),
      extracted: withCost ? asObject(stored.extracted) : omitHeaderMoney(asObject(stored.extracted)),
      edited: withCost ? asObject(stored.edited) : omitHeaderMoney(asObject(stored.edited)),
      status: header.status,
      conflicts: Array.isArray(stored.conflicts) ? stored.conflicts : [],
      acknowledged: header.acknowledged ? { reason: header.acknowledged.reason, ...(withCost ? { difference: header.acknowledged.difference } : {}) } : null,
      ...(withCost
        ? {
            arithmetic:
              arithmetic.status === 'UNKNOWN'
                ? { status: 'UNKNOWN' as const }
                : {
                    status: arithmetic.status,
                    expected: arithmetic.expected.toString(),
                    actual: arithmetic.actual.toString(),
                    difference: arithmetic.difference.toString(),
                    ...(arithmetic.assumed ? { assumed: arithmetic.assumed } : {}),
                  },
          }
        : {}),
    },
    files: files.map((f) => ({ id: f.id, status: f.status, failureCode: f.failureCode, pages: f.pages, mediaType: f.mediaType, bytes: f.bytes, attempts: f.attempts, extractedAt: f.extractedAt?.toISOString() ?? null })),
    rows: rows.map(read),
    approval,
    /** What this read rests on: the approval sends it back and the server refuses (`APPROVAL_STALE`) when it no longer matches. */
    verdictToken: verdictTokenOf({ version: batch.version, supplierId: batch.supplierId, files, rows, header }),
    ...(withCost ? { totals: [...totals].map(([c, total]) => ({ currency: c, lineTotalMinor: total.toString() })) } : {}),
  };
}
