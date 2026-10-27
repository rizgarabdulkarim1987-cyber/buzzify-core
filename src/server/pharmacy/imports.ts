import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { ScopedClient, ScopedTx } from '@/server/data/tenant-db';
import { minorUnitDigits, type Currency } from '@/server/domain/billing/money';
import { sniffMediaType } from '@/server/domain/media-type';
import {
  addScopeIssues,
  batchHash,
  PHARMACY_IMPORT_MAX_ROWS,
  PRODUCT_COLUMNS,
  suggestMapping,
  validateRows,
  type ImportDefaults,
  type ImportIssue,
  type ParsedProduct,
  type ParsedRow,
} from '@/server/domain/pharmacy/import-products';
import { canPh } from '@/server/domain/pharmacy/permissions';
import { isZip, readSheet, SheetReadError, type SheetReadProblem } from '@/server/sheets/read';
import { StudioError } from '@/server/studio/framework/result';
import type { PhActor } from './actor';
import { assertPriceBranch, REASON_SHORT, setFirstPrices } from './prices';
import { assertBranchSettings, createProducts, ListEntryError, productInput, type ProductInput } from './products';

/**
 * A pharmacy's product import (spec: catalog import, Phase 1): a CSV or XLSX file read into a stored preview, then
 * applied in one transaction. The preview changes no product; it keeps every row as read, as parsed and with its issues
 * (`PhImportBatch`, `PhImportRow`). Applying creates the chosen rows through `createProducts` and `setFirstPrices`, the
 * list forms of the services behind `ph.products.create` and `ph.prices.set` (the same checks and the same rows), so a
 * product made by import is checked and stored exactly as one made by hand. All or nothing: one refused row leaves no
 * product of the batch, and the claim on the batch rolls back with it. Every read and write goes through the scoped
 * client or transaction of the definition.
 */

/** The largest file a preview reads, decoded. */
export const PH_IMPORT_MAX_BYTES = 5 * 1024 * 1024;
/** Enough base64 for that file and a little more, so a file just over the limit is refused by its size, not its text. */
const BASE64_MAX = Math.ceil((PH_IMPORT_MAX_BYTES + 1024) / 3) * 4;

/**
 * How long the preview's and the apply's transaction may run (Prisma's default is 5 s). The apply writes up to 10,000
 * products (each with its units, barcode, minimum and price) in ONE transaction, which is what makes it all or nothing:
 * measured on the local test database, 1,000 rows took about 1 s and 10,000 about 10 s, so 60 s leaves room for a
 * remote database's round trips. Splitting it into several transactions would break all or nothing, so the limit is
 * raised instead.
 */
export const PREVIEW_TIMEOUT_MS = 60_000;
export const APPLY_TIMEOUT_MS = 60_000;

/** Rows written per `createMany`, and codes looked up per query. */
const ROW_CHUNK = 1_000;
const LOOKUP_CHUNK = 5_000;
/** How many rows with issues the preview answers with; the rest stay on the stored batch. */
const FIRST_ISSUE_ROWS = 50;

// Input ---------------------------------------------------------------------------------------------------------------

const ID = z.string().min(1).max(64);
const WHOLE = 'Enter a whole number';

/** A preview: the file, the mapping the person confirmed (or none for the suggested one), and their defaults. */
export const importPreviewInput = z.object({
  fileName: z.string().trim().min(1).max(200),
  fileBase64: z.string().min(1).max(BASE64_MAX, 'Use a file of at most 5 MB'),
  mapping: z.record(z.string().max(500), z.enum(PRODUCT_COLUMNS).nullable()).optional(),
  defaults: z
    .object({
      rxLevel: z.enum(['OTC', 'RX', 'RESTRICTED']).optional(),
      // A unit's label is at most 40 characters, so the default pack unit is too.
      packLabel: z.string().trim().min(1, 'Name every unit').max(40, 'Use at most 40 characters').optional(),
      unitsPerPack: z.number(WHOLE).int(WHOLE).min(1, 'Use 1 or more').max(1_000_000, 'Enter a smaller number').optional(),
    })
    .optional(),
  /** Needed to preview a file this business has previewed before; kept in the audit row. */
  overrideReason: z.string(REASON_SHORT).trim().min(3, REASON_SHORT).max(200, 'Use at most 200 characters').optional(),
});
export type ImportPreviewInput = z.infer<typeof importPreviewInput> & { branchId?: string };

export const importApplyInput = z.object({
  batchId: ID,
  batchHash: z.string().min(1).max(128),
  acceptWarnings: z.boolean(),
  /** Rows (by their number in the file) left out: every error row must be, and any other row may be. */
  excludeRowNumbers: z.array(z.number().int().min(1).max(10_000_000)).max(PHARMACY_IMPORT_MAX_ROWS + 1).default([]),
});
export type ImportApplyInput = z.infer<typeof importApplyInput>;

// Refusals ------------------------------------------------------------------------------------------------------------

const FILE_TYPE_MESSAGE = 'Upload a CSV or Excel (.xlsx) file';
const MISMATCH_MESSAGE = 'This file is not what its name says. Save it again as CSV or Excel (.xlsx).';
const UNREADABLE_MESSAGE = 'This file could not be read as a CSV or Excel sheet';
const STALE_MESSAGE = 'This import changed since its preview. Preview the file again.';

const READ_MESSAGES: Record<SheetReadProblem, string> = {
  ENCODING: 'Save the sheet as CSV UTF-8 and upload it again',
  TOO_MANY_ROWS: 'Use at most 10,000 rows',
  EMPTY: 'This sheet is empty',
  UNREADABLE: UNREADABLE_MESSAGE,
};

const stale = () => new StudioError('CONFLICT', STALE_MESSAGE, { phCode: 'BATCH_STALE' });

// The file ------------------------------------------------------------------------------------------------------------

type SheetFormat = 'csv' | 'xlsx';

function bytesOf(base64: string): Uint8Array {
  if (base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) {
    throw new StudioError('INVALID', UNREADABLE_MESSAGE, { phCode: 'UNREADABLE' });
  }
  const bytes = new Uint8Array(Buffer.from(base64, 'base64'));
  if (bytes.length > PH_IMPORT_MAX_BYTES) throw new StudioError('INVALID', 'Use a file of at most 5 MB', { phCode: 'FILE_TOO_LARGE' });
  if (bytes.length === 0) throw new StudioError('INVALID', READ_MESSAGES.EMPTY, { phCode: 'EMPTY' });
  return bytes;
}

/**
 * The format the name says, checked against the bytes: an XLSX is a ZIP (`isZip`, the sheet reader's own test), and a
 * CSV is neither a ZIP nor a picture or other media file (`sniffMediaType`). A name and bytes that disagree are refused,
 * never read as the other kind.
 */
function formatOf(fileName: string, bytes: Uint8Array): SheetFormat {
  const extension = /\.([a-z0-9]+)$/i.exec(fileName)?.[1]?.toLowerCase();
  if (extension !== 'csv' && extension !== 'xlsx') throw new StudioError('INVALID', FILE_TYPE_MESSAGE, { phCode: 'FILE_TYPE' });
  const zip = isZip(bytes);
  const matches = extension === 'xlsx' ? zip : !zip && sniffMediaType(bytes.subarray(0, 4096)) === null;
  if (!matches) throw new StudioError('INVALID', MISMATCH_MESSAGE, { phCode: 'FILE_TYPE_MISMATCH' });
  return extension;
}

async function sheetOf(bytes: Uint8Array) {
  try {
    // At most the cap: one row more is TOO_MANY_ROWS from the reader, never a sheet cut short.
    const sheet = await readSheet(bytes, { maxRows: PHARMACY_IMPORT_MAX_ROWS });
    if (sheet.rows.length === 0) throw new SheetReadError('EMPTY');
    return sheet;
  } catch (error) {
    if (error instanceof SheetReadError) throw new StudioError('INVALID', READ_MESSAGES[error.problem], { phCode: error.problem });
    throw error;
  }
}

// What is stored ------------------------------------------------------------------------------------------------------

/** How the batch was read and what it may write, kept in `PhImportBatch.mapping`. */
const batchConfig = z.object({
  columns: z.record(z.string(), z.string().nullable()),
  defaults: z.object({ rxLevel: z.enum(['OTC', 'RX', 'RESTRICTED']).optional(), packLabel: z.string().optional(), unitsPerPack: z.number().optional() }),
  /** The branch whose minimum quantity the rows set, when exactly one branch was in scope; null otherwise. */
  minQtyBranchId: z.string().nullable(),
  /** Whether the rows' sale prices are written (the person could set business-wide prices). */
  prices: z.boolean(),
});
type BatchConfig = z.infer<typeof batchConfig>;

const ROW_STATUS = { ok: 'OK', warning: 'WARNING', error: 'ERROR', duplicate: 'SKIPPED' } as const;
type StoredStatus = (typeof ROW_STATUS)[keyof typeof ROW_STATUS];
const PARSED_STATUS = Object.fromEntries(Object.entries(ROW_STATUS).map(([k, v]) => [v, k])) as Record<StoredStatus, ParsedRow['status']>;

/** The parsed fields in the order `validateRows` builds them: the batch hash is computed over them in this order. */
const VALUE_KEYS = [
  'tradeName', 'genericName', 'activeIngredient', 'strength', 'form', 'manufacturer', 'category',
  'rxLevel', 'packLabel', 'unitsPerPack', 'barcode', 'salePrice', 'minQty', 'shelfLocation',
] as const satisfies readonly (keyof ParsedProduct)[];

const storedValues = (values: ParsedProduct) => ({
  ...values,
  salePrice: values.salePrice ? { amount: values.salePrice.amount.toString(), currency: values.salePrice.currency } : null,
});

/** A stored row as `validateRows` returned it; null when what is stored is not a row (then the hash cannot match). */
function restoreRow(row: { rowNumber: number; status: StoredStatus | 'IMPORTED'; parsed: unknown; issues: unknown }): ParsedRow | null {
  const parsed = row.parsed as { values?: Record<string, unknown>; identityKey?: unknown } | null;
  if (!parsed?.values || !Array.isArray(row.issues) || row.status === 'IMPORTED') return null;
  const values: Record<string, unknown> = {};
  for (const key of VALUE_KEYS) values[key] = parsed.values[key];
  const price = values.salePrice as { amount?: unknown; currency?: unknown } | null;
  if (price !== null && price !== undefined) {
    if (typeof price.amount !== 'string' || !/^\d{1,30}$/.test(price.amount)) return null;
    values.salePrice = { amount: BigInt(price.amount), currency: price.currency };
  }
  return {
    rowNumber: row.rowNumber,
    status: PARSED_STATUS[row.status],
    issues: row.issues as ImportIssue[],
    values: values as ParsedProduct,
    identityKey: typeof parsed.identityKey === 'string' ? parsed.identityKey : null,
  };
}

// Preview -------------------------------------------------------------------------------------------------------------

/** What a preview found, before it is stored. */
export interface PreparedImport {
  fileSha256: string;
  fileName: string;
  headers: string[];
  cells: string[][];
  rows: ParsedRow[];
  config: BatchConfig;
  suggestedMapping: Record<string, string | null>;
  summary: { ok: number; warnings: number; errors: number; duplicates: number; rows: number };
  batchHash: string;
  /** The earlier batch of the same file, when the person gave a reason to preview it again. */
  duplicateOf: string | null;
}

/** Whether this person may set the business-wide prices an import writes: the price permission and every branch. */
function maySetImportPrices(ph: PhActor): boolean {
  return ph.role !== null && ph.support === null && ph.allBranches && canPh(ph.role, 'price.change');
}

async function inChunks<T, R>(items: readonly T[], size: number, read: (chunk: T[]) => Promise<R[]>): Promise<R[]> {
  const out: R[] = [];
  for (let at = 0; at < items.length; at += size) out.push(...(await read(items.slice(at, at + size))));
  return out;
}

/**
 * Reads and checks the file against the catalog; writes nothing. The catalog is read only for the identity keys and
 * barcodes the file names (at most 10,000 of each, in chunks of 5,000), never whole. A file this business previewed
 * before is refused `DUPLICATE_IMPORT` (naming that batch and when) unless `overrideReason` is given.
 */
export async function prepareImport(scoped: ScopedClient, ph: PhActor, input: ImportPreviewInput): Promise<PreparedImport> {
  const bytes = bytesOf(input.fileBase64);
  formatOf(input.fileName, bytes);
  const fileSha256 = createHash('sha256').update(bytes).digest('hex');

  const earlier = await scoped.phImportBatch.findFirst({
    where: { fileSha256, status: { not: 'CANCELLED' } },
    orderBy: { createdAt: 'asc' },
    select: { id: true, createdAt: true },
  });
  if (earlier && input.overrideReason === undefined) {
    throw new StudioError('CONFLICT', 'This file was already imported. Give a reason to import it again.', {
      phCode: 'DUPLICATE_IMPORT',
      batchId: earlier.id,
      previewedAt: earlier.createdAt.toISOString(),
    });
  }

  const sheet = await sheetOf(bytes);
  const suggestedMapping = suggestMapping(sheet.headers);
  // The confirmed mapping names every header it keeps; a header it leaves out is not imported.
  const columns = input.mapping
    ? Object.fromEntries(Object.keys(suggestedMapping).map((header) => [header, input.mapping![header] ?? null]))
    : suggestedMapping;
  const defaults: ImportDefaults = input.defaults ?? {};
  const settings = await scoped.phSettings.findFirst({ select: { enabledCurrencies: true } });
  const base = {
    headers: sheet.headers,
    rows: sheet.rows,
    rowNumbers: sheet.rowNumbers,
    numericCells: sheet.numericCells,
    mapping: columns,
    enabledCurrencies: (settings?.enabledCurrencies ?? ['IQD']) as Currency[],
    defaults,
  };

  // First pass without the catalog, for the keys and codes the file names; then the real one.
  const draft = validateRows({ ...base, existingIdentityKeys: new Set(), existingBarcodes: new Map() });
  const keys = [...new Set(draft.rows.flatMap((r) => (r.identityKey ? [r.identityKey] : [])))];
  const codes = [...new Set(draft.rows.flatMap((r) => (r.values.barcode !== '' ? [r.values.barcode] : [])))];
  const products = await inChunks(keys, LOOKUP_CHUNK, (chunk) =>
    scoped.phProduct.findMany({ where: { identityKey: { in: chunk } }, select: { identityKey: true } }),
  );
  const barcodes = await inChunks(codes, LOOKUP_CHUNK, (chunk) =>
    scoped.phBarcode.findMany({ where: { code: { in: chunk } }, select: { code: true, productId: true } }),
  );
  const checked = validateRows({
    ...base,
    existingIdentityKeys: new Set(products.map((p) => p.identityKey)),
    existingBarcodes: new Map(barcodes.map((b) => [b.code, b.productId])),
  });
  // The input schema already holds the defaults to what validateRows accepts.
  if (checked.defaultsError) throw new Error('Import defaults passed the input schema but not the row rules');

  // Branch settings are per branch: a minimum quantity goes to the one branch in scope, or nowhere.
  const inScope = input.branchId !== undefined ? [input.branchId] : ph.branchIds;
  const config: BatchConfig = { columns, defaults, minQtyBranchId: inScope.length === 1 ? inScope[0]! : null, prices: maySetImportPrices(ph) };
  addScopeIssues(checked.rows, { minQty: config.minQtyBranchId !== null, prices: config.prices });

  return {
    fileSha256,
    fileName: input.fileName,
    headers: sheet.headers,
    cells: sheet.rows,
    rows: checked.rows,
    config,
    suggestedMapping,
    summary: { ...checked.summary, rows: checked.rows.length },
    batchHash: batchHash(checked.rows, columns, defaults),
    duplicateOf: earlier?.id ?? null,
  };
}

/** Stores the preview: the batch, then its rows in chunks. Returns the batch id. */
export async function storeImport(tx: ScopedTx, ph: PhActor, prepared: PreparedImport): Promise<string> {
  const batch = await tx.phImportBatch.create({
    data: {
      restaurantId: ph.restaurantId,
      status: 'PREVIEWED',
      fileSha256: prepared.fileSha256,
      mapping: prepared.config as never,
      summary: { ...prepared.summary, fileName: prepared.fileName.slice(0, 200) },
      createdById: ph.userId,
    },
    select: { id: true },
  });
  for (let at = 0; at < prepared.rows.length; at += ROW_CHUNK) {
    await tx.phImportRow.createMany({
      data: prepared.rows.slice(at, at + ROW_CHUNK).map((row, offset) => ({
        restaurantId: ph.restaurantId,
        batchId: batch.id,
        rowNumber: row.rowNumber,
        raw: prepared.cells[at + offset]!,
        parsed: { values: storedValues(row.values), identityKey: row.identityKey },
        issues: row.issues as never,
        status: ROW_STATUS[row.status],
      })),
    });
  }
  return batch.id;
}

/** The first rows with any issue, as the preview shows them. */
export function firstRowsWithIssues(rows: readonly ParsedRow[]) {
  return rows
    .filter((row) => row.issues.length > 0)
    .slice(0, FIRST_ISSUE_ROWS)
    .map((row) => ({ rowNumber: row.rowNumber, status: row.status, issues: row.issues.map(({ code, field, severity, message }) => ({ code, field, severity, message })) }));
}

// Apply ---------------------------------------------------------------------------------------------------------------

/** A minor-unit amount as a person types it (`1250` IQD, `12.50` USD): what `setPrice` reads back exactly. */
export function minorText(amount: bigint, currency: Currency): string {
  const digits = minorUnitDigits(currency);
  if (digits === 0) return amount.toString();
  const text = amount.toString().padStart(digits + 1, '0');
  return `${text.slice(0, -digits)}.${text.slice(-digits)}`;
}

/** The product a checked row makes: its pack on top of a base unit (named by the form), its barcode on the pack. */
function productOf(values: ParsedProduct, minQtyBranchId: string | null): ProductInput {
  const per = values.unitsPerPack!;
  const levels =
    per === 1
      ? [{ level: 0, label: values.packLabel, baseQty: 1, sellable: true }]
      : [
          { level: 0, label: (values.form || 'unit').slice(0, 40), baseQty: 1, sellable: true },
          { level: 1, label: values.packLabel, baseQty: per, sellable: true },
        ];
  const top = levels.length - 1;
  return productInput.parse({
    tradeName: values.tradeName,
    genericName: values.genericName,
    activeIngredient: values.activeIngredient,
    strength: values.strength,
    form: values.form,
    manufacturer: values.manufacturer,
    rxLevel: values.rxLevel!,
    levels,
    barcodes: values.barcode !== '' ? [{ code: values.barcode, level: top }] : [],
    branchSettings: minQtyBranchId !== null && values.minQty !== null ? [{ branchId: minQtyBranchId, minQty: values.minQty, reorderQty: 0 }] : [],
  });
}

/** A refusal from one row, naming the row (its number in the file) so the person can find it. */
function atRow(error: unknown, rowNumber: number): unknown {
  if (error instanceof StudioError) return new StudioError(error.code, error.message, { ...(error.fields ?? {}), rowNumber: String(rowNumber) });
  if (error instanceof z.ZodError) return new StudioError('INVALID', undefined, { phCode: 'ROW_INVALID', rowNumber: String(rowNumber) });
  return error;
}

/** A list write whose refusal names the row it came from. */
async function asRow<T>(work: Promise<T>, rowOf: (index: number) => number): Promise<T> {
  try {
    return await work;
  } catch (error) {
    if (error instanceof ListEntryError) throw atRow(error.refusal, rowOf(error.index));
    throw error;
  }
}

export interface ImportApply {
  created: number;
  prices: number;
  /** Duplicates, and warning rows not accepted. */
  skipped: number;
  excluded: number;
  alreadyApplied: boolean;
}

const ALREADY: ImportApply = { created: 0, prices: 0, skipped: 0, excluded: 0, alreadyApplied: true };

/**
 * Applies a previewed batch in the caller's transaction. In order: the batch must exist in the business (NOT_FOUND);
 * the hash recomputed from the stored rows, mapping and defaults must be the one the person saw (`BATCH_STALE`); an
 * applied batch answers `alreadyApplied`; every error row must be excluded (`IMPORT_HAS_ERRORS`, naming the rows); the
 * person must still be allowed what the preview planned (its branch, its prices). Then the batch is claimed
 * (PREVIEWED to COMMITTED, atomically: a second apply at the same time waits, then answers `alreadyApplied`), and each
 * chosen row is created through `createProducts` (and its price through `setFirstPrices`). Any refusal names the row
 * and rolls back everything, the claim included.
 */
export async function applyImport(tx: ScopedTx, ph: PhActor, input: ImportApplyInput): Promise<ImportApply> {
  const batch = await tx.phImportBatch.findFirst({ where: { id: input.batchId }, select: { id: true, status: true, mapping: true, summary: true } });
  if (!batch) throw new StudioError('NOT_FOUND');
  const config = batchConfig.safeParse(batch.mapping);
  if (!config.success) throw stale();
  const stored = await tx.phImportRow.findMany({
    where: { batchId: batch.id },
    orderBy: { rowNumber: 'asc' },
    select: { rowNumber: true, status: true, parsed: true, issues: true },
  });
  const rows = stored.map(restoreRow);
  if (rows.some((row) => row === null)) throw stale();
  const parsed = rows as ParsedRow[];
  const { columns, defaults, minQtyBranchId, prices } = config.data;
  if (batchHash(parsed, columns, defaults as ImportDefaults) !== input.batchHash) throw stale();
  if (batch.status === 'COMMITTED') return ALREADY;
  if (batch.status !== 'PREVIEWED') throw stale();

  const excluded = new Set(input.excludeRowNumbers);
  const errors = parsed.filter((row) => row.status === 'error' && !excluded.has(row.rowNumber));
  if (errors.length > 0) {
    throw new StudioError('INVALID', 'Some rows have errors. Fix them in the file or leave them out.', {
      phCode: 'IMPORT_HAS_ERRORS',
      rows: errors.slice(0, 20).map((row) => row.rowNumber).join(', '),
    });
  }
  const chosen = parsed.filter((row) => !excluded.has(row.rowNumber) && (row.status === 'ok' || (row.status === 'warning' && input.acceptWarnings)));
  if (chosen.length === 0) throw new StudioError('INVALID', 'There are no rows to import', { phCode: 'NOTHING_TO_IMPORT' });
  if (minQtyBranchId !== null) assertBranchSettings(ph, [{ branchId: minQtyBranchId, minQty: 0, reorderQty: 0 }]);
  if (prices && chosen.some((row) => row.values.salePrice !== null)) {
    if (!maySetImportPrices(ph)) throw new StudioError('FORBIDDEN');
    assertPriceBranch(ph, null);
  }

  const claimed = await tx.phImportBatch.updateMany({ where: { id: batch.id, status: 'PREVIEWED' }, data: { status: 'COMMITTED' } });
  if (claimed.count !== 1) {
    // Another apply got there first: it has committed by now (this one waited on the row), or rolled back.
    const now = await tx.phImportBatch.findFirst({ where: { id: batch.id }, select: { status: true } });
    if (now?.status === 'COMMITTED') return ALREADY;
    throw stale();
  }

  const inputs = chosen.map((row) => {
    try {
      return productOf(row.values, minQtyBranchId);
    } catch (error) {
      throw atRow(error, row.rowNumber);
    }
  });
  // createProducts and setFirstPrices: createProduct's and setPrice's checks and rows, a few statements per thousand
  // (one save per row took 77 s for 10,000 rows on the test database; the Task 23 report has the measurements).
  const written = await asRow(createProducts(tx, ph.restaurantId, inputs), (index) => chosen[index]!.rowNumber);
  const from = new Date();
  const priceRows: number[] = [];
  const priceInputs = chosen.flatMap((row, index) => {
    const price = row.values.salePrice;
    if (!prices || price === null) return [];
    priceRows.push(row.rowNumber);
    const top = inputs[index]!.levels.length - 1;
    return [{ productId: written[index]!.id, unitId: written[index]!.unitIds[top]!, currency: price.currency, amount: minorText(price.amount, price.currency), validFrom: from, reason: `import ${batch.id}` }];
  });
  const priced = await asRow(setFirstPrices(tx, ph, priceInputs), (index) => priceRows[index]!);
  const created = written.length;

  const excludedCount = parsed.filter((row) => excluded.has(row.rowNumber)).length;
  const result: ImportApply = { created, prices: priced, skipped: parsed.length - chosen.length - excludedCount, excluded: excludedCount, alreadyApplied: false };
  const summary = (batch.summary ?? {}) as Record<string, unknown>;
  await tx.phImportBatch.updateMany({
    where: { id: batch.id },
    data: { summary: { ...summary, applied: { created, prices: priced, skipped: result.skipped, excluded: excludedCount, acceptWarnings: input.acceptWarnings } } },
  });
  return result;
}
