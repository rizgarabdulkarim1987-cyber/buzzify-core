import type { ScopedDb, ScopedTx } from '@/server/data/tenant-db';
import { normalizeScan } from '@/server/domain/pharmacy/barcode';
import { StudioError } from '@/server/studio/framework/result';

/**
 * A pharmacy's barcodes: finding the product a scan names, and keeping a product's codes in step with what the person
 * entered. A code is always text, compared exactly after `normalizeScan` (Latin digits, no surrounding whitespace):
 * `0012345678905` and `12345678905` are two codes, never one number. Every read and write goes through the scoped client
 * it is given, so another business's codes are never seen.
 */

export type BarcodeMatch =
  | { kind: 'none' }
  | { kind: 'one'; productId: string; unitId: string }
  | { kind: 'many'; candidates: { productId: string; unitId: string }[] };

/** The active products (and units) a scanned code names; several when the code is shared, none for an archived product. */
export async function resolveBarcode(scoped: ScopedDb, code: string): Promise<BarcodeMatch> {
  const text = normalizeScan(code);
  if (text === '') return { kind: 'none' };
  const rows = await scoped.phBarcode.findMany({
    where: { code: text, product: { active: true } },
    select: { productId: true, unitId: true },
    orderBy: [{ productId: 'asc' }, { unitId: 'asc' }],
  });
  if (rows.length === 0) return { kind: 'none' };
  if (rows.length === 1) return { kind: 'one', productId: rows[0]!.productId, unitId: rows[0]!.unitId };
  return { kind: 'many', candidates: rows.map((r) => ({ productId: r.productId, unitId: r.unitId })) };
}

/** One barcode of a product as the person entered it: on the unit at `level`, `shared` to let other products use it too. */
export interface BarcodeInput {
  code: string;
  level: number;
  shared?: boolean;
}

/** A code this call shared with products that already had it: the audit line names the code and those products only. */
export interface SharedCode {
  code: string;
  productIds: string[];
}

/** A barcode row as every save writes it: the single save (`syncBarcodes`) and the list form (`createProducts`). */
export function barcodeRow(restaurantId: string, productId: string, unitId: string, code: string, shared: boolean) {
  return { restaurantId, productId, unitId, code, shared };
}

export const BARCODE_IN_USE_MESSAGE = 'This barcode is already on another product. Mark it as shared to use it on both.';

/** The rows of `codes` that products other than `exceptProductId` hold, oldest first, with each holder's name. */
export async function heldElsewhere(scoped: ScopedDb, codes: readonly string[], exceptProductId?: string) {
  if (codes.length === 0) return [];
  return scoped.phBarcode.findMany({
    where: { code: { in: [...new Set(codes)] }, ...(exceptProductId ? { productId: { not: exceptProductId } } : {}) },
    select: { code: true, productId: true, product: { select: { tradeName: true, active: true } } },
    orderBy: { createdAt: 'asc' },
  });
}

/** `productArchived` ('true') says the holder is archived, so the screen can offer to edit it or share the code. */
export const inUse = (index: number, holder: { productId: string; product: { tradeName: string; active?: boolean } }) =>
  new StudioError('CONFLICT', BARCODE_IN_USE_MESSAGE, {
    phCode: 'BARCODE_IN_USE',
    productId: holder.productId,
    productName: holder.product.tradeName,
    ...(holder.product.active === false ? { productArchived: 'true' } : {}),
    [`barcodes.${index}.code`]: BARCODE_IN_USE_MESSAGE,
  });

/**
 * The `BARCODE_IN_USE` refusal for the first entry that is not `shared` and whose code (already normalised) another
 * product holds, naming the oldest holder; null when there is none. Also how a save that lost the race for a code (the
 * partial unique index "PhBarcode_one_unshared_code") learns who won.
 */
export async function barcodeInUse(
  scoped: ScopedDb,
  entries: readonly { index: number; code: string; shared: boolean }[],
  exceptProductId?: string,
): Promise<StudioError | null> {
  const unshared = entries.filter((e) => !e.shared);
  const held = await heldElsewhere(scoped, unshared.map((e) => e.code), exceptProductId);
  for (const entry of unshared) {
    const holder = held.find((h) => h.code === entry.code);
    if (holder) return inUse(entry.index, holder);
  }
  return null;
}

/**
 * Makes the product's barcodes exactly `wanted` (codes already normalised, each on a level of `unitIdByLevel`). A code
 * another product of the business has is refused `BARCODE_IN_USE` (naming that product) unless this entry is `shared`;
 * then every row of the code is marked shared and the code is returned in `shared`. Rows are written with the product's
 * own `restaurantId`.
 */
export async function syncBarcodes(
  tx: ScopedTx,
  product: { id: string; restaurantId: string },
  unitIdByLevel: ReadonlyMap<number, string>,
  wanted: readonly BarcodeInput[],
): Promise<{ codes: string[]; shared: SharedCode[] }> {
  const entries = wanted.map((b, index) => ({ index, code: b.code, unitId: unitIdByLevel.get(b.level)!, shared: b.shared === true }));
  const others = await heldElsewhere(tx, entries.map((e) => e.code), product.id);
  const shared: SharedCode[] = [];
  for (const entry of entries) {
    const clashes = others.filter((o) => o.code === entry.code);
    if (clashes.length === 0) continue;
    if (!entry.shared) throw inUse(entry.index, clashes[0]!);
    if (!shared.some((s) => s.code === entry.code)) {
      shared.push({ code: entry.code, productIds: [...new Set(clashes.map((c) => c.productId))] });
    }
  }
  if (shared.length > 0) {
    await tx.phBarcode.updateMany({ where: { code: { in: shared.map((s) => s.code) } }, data: { shared: true } });
  }

  const existing = await tx.phBarcode.findMany({ where: { productId: product.id }, select: { id: true, code: true, unitId: true, shared: true } });
  const key = (code: string, unitId: string) => `${unitId}\n${code}`;
  const wantedByKey = new Map(entries.map((e) => [key(e.code, e.unitId), e]));
  const gone = existing.filter((row) => !wantedByKey.has(key(row.code, row.unitId)));
  if (gone.length > 0) await tx.phBarcode.deleteMany({ where: { id: { in: gone.map((row) => row.id) } } });
  for (const entry of wantedByKey.values()) {
    const row = existing.find((r) => r.code === entry.code && r.unitId === entry.unitId);
    const isShared = entry.shared || shared.some((s) => s.code === entry.code);
    if (!row) {
      await tx.phBarcode.create({ data: barcodeRow(product.restaurantId, product.id, entry.unitId, entry.code, isShared), select: { id: true } });
    } else if (isShared && !row.shared) {
      await tx.phBarcode.updateMany({ where: { id: row.id }, data: { shared: true } });
    }
  }
  return { codes: [...wantedByKey.values()].map((e) => e.code).sort(), shared };
}
