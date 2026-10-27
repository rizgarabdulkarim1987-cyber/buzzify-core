import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Prisma, PrismaClient } from '@/generated/prisma/client';
import { LOCALES, type Locale } from '@/lib/locale';
import { expireLive } from '@/server/data/cache';
import { menuDb, type ScopedDb, type ScopedTx } from '@/server/data/tenant-db';
import {
  diffSheet,
  parseSheetRow,
  readHeaders,
  sheetRowsFromDraft,
  type ImportDraft,
  type ImportPreview,
  type ParsedSheetRow,
} from '@/server/domain/import-sheet';
import { readSheet, SheetReadError, type SheetReadProblem } from '@/server/sheets/read';
import { writeCsv, writeXlsx } from '@/server/sheets/write';
import { exportKey, importKey, isValidKey } from '@/server/storage/keys';
import { getStorage, StorageTooLargeError } from '@/server/storage/storage';
import type { ActionContext } from '@/server/studio/framework/action';
import { createId } from '@/server/studio/framework/ids';
import { StudioError } from '@/server/studio/framework/result';
import { textsOf, uniqueSlug, slugFromNames } from './content';
import { editDraft } from './draft-edit';

/**
 * Importing a menu sheet and exporting the draft as one (spec 13). A sheet is uploaded straight to storage, read into a
 * preview kept as an import job, and applied to the draft in one transaction, only if the draft is still the one the
 * preview compared with. What the sheet changes that guests see at once (sold out, hidden) needs the availability
 * permission; without it those changes are left out and counted.
 */

/** The largest sheet an import reads (spec 13.2). */
export const IMPORT_MAX_BYTES = 5 * 1024 * 1024;
const UPLOAD_SLOT_SECONDS = 600;
const DOWNLOAD_LINK_SEC = 300;

const SHEET_TYPES = {
  csv: 'text/csv',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
} as const;
type SheetFormat = keyof typeof SHEET_TYPES;

export const sheetFileNameField = z.string().trim().min(1).max(200);
export const sheetFormatField = z.enum(['csv', 'xlsx']);

const READ_MESSAGES: Record<SheetReadProblem, string> = {
  ENCODING: 'Save the sheet as CSV UTF-8 and upload it again',
  TOO_MANY_ROWS: 'Use at most 2,000 rows',
  EMPTY: 'This sheet is empty',
  UNREADABLE: 'This file could not be read as a CSV or Excel sheet',
};

function menuOf(ctx: ActionContext): string {
  if (ctx.menuId === null) throw new Error('A menu action ran without a menu');
  return ctx.menuId;
}

/** The format a file name says, or null for one an import does not read. */
function formatOf(fileName: string): SheetFormat | null {
  const extension = /\.([a-z0-9]+)$/i.exec(fileName)?.[1]?.toLowerCase();
  return extension === 'csv' || extension === 'xlsx' ? extension : null;
}

// The draft ------------------------------------------------------------------------------------------------------------

const tags = (value: unknown) => (Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []);

/** The menu's categories and products as the sheet shows them, in their order. */
export async function loadImportDraft(db: ScopedDb | ScopedTx, menuId: string): Promise<ImportDraft> {
  const [menu, categories, products] = await Promise.all([
    db.menu.findFirst({ where: { id: menuId }, select: { currency: true } }),
    db.category.findMany({ orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }], select: { id: true, slug: true, translations: true } }),
    db.product.findMany({ orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] }),
  ]);
  if (!menu) throw new StudioError('NOT_FOUND');
  return {
    currency: menu.currency,
    categories: categories.map((category) => ({ id: category.id, slug: category.slug, names: textsOf(category.translations, 'name') })),
    products: products.map((product) => ({
      id: product.id,
      categoryId: product.categoryId,
      slug: product.slug,
      names: textsOf(product.translations, 'name'),
      descriptions: textsOf(product.translations, 'description'),
      price: product.basePrice,
      isAvailable: product.isAvailable,
      isHidden: product.isHidden,
      isFeatured: product.isFeatured,
      isSignature: product.isSignature,
      badges: tags(product.badges),
      dietary: tags(product.dietary),
      allergens: tags(product.allergens),
      calories: product.calories,
      sortOrder: product.sortOrder,
    })),
  };
}

// Uploading and reading ------------------------------------------------------------------------------------------------

/** A signed slot the browser sends the sheet to, after its name and size pass. */
export async function requestImportUpload(ctx: ActionContext, input: { fileName: string; bytes: number }): Promise<{ uploadKey: string; url: string; headers: Record<string, string> }> {
  const menuId = menuOf(ctx);
  const format = formatOf(input.fileName);
  if (!format) throw new StudioError('INVALID', 'Upload a CSV or Excel (.xlsx) file');
  if (input.bytes > IMPORT_MAX_BYTES) throw new StudioError('INVALID', 'Use a file of at most 5 MB');
  const key = importKey(menuId, createId());
  const slot = await getStorage().presignPut(key, { contentType: SHEET_TYPES[format], contentLength: input.bytes, expiresInSec: UPLOAD_SLOT_SECONDS });
  return { uploadKey: key, ...slot };
}

/** The uploaded file, removed from storage once read (whatever it turns out to be). */
async function takeUpload(menuId: string, uploadKey: string): Promise<Uint8Array> {
  const prefix = importKey(menuId, 'x').slice(0, -1);
  if (!isValidKey(uploadKey) || !uploadKey.startsWith(prefix)) throw new StudioError('NOT_FOUND');
  const storage = getStorage();
  try {
    const file = await storage.get(uploadKey, IMPORT_MAX_BYTES);
    if (!file) throw new StudioError('NOT_FOUND');
    return file.bytes;
  } catch (error) {
    if (error instanceof StorageTooLargeError) throw new StudioError('INVALID', 'Use a file of at most 5 MB');
    throw error;
  } finally {
    await storage.delete([uploadKey]);
  }
}

/**
 * Reads an uploaded sheet into a preview against the draft and keeps it as an import job. A file that cannot be read,
 * or a header row with unknown, missing or repeated columns, is `INVALID` with the reason or the columns.
 */
export async function parseImport(
  ctx: ActionContext,
  input: { uploadKey: string; fileName: string; hideMissing: boolean },
): Promise<{ importJobId: string; preview: ImportPreview }> {
  const menuId = menuOf(ctx);
  const bytes = await takeUpload(menuId, input.uploadKey);
  let sheet;
  try {
    sheet = await readSheet(bytes);
  } catch (error) {
    if (error instanceof SheetReadError) throw new StudioError('INVALID', READ_MESSAGES[error.problem]);
    throw error;
  }
  const header = readHeaders(sheet.headers);
  if (!header.ok) {
    const fields: Record<string, string> = {};
    if (header.unknown.length > 0) fields.unknownColumns = header.unknown.join(', ');
    if (header.missing.length > 0) fields.missingColumns = header.missing.join(', ');
    if (header.duplicate.length > 0) fields.duplicateColumns = header.duplicate.join(', ');
    throw new StudioError('INVALID', 'Some columns of this sheet are not right', fields);
  }

  return ctx.transaction(async (tx) => {
    const menu = await tx.menu.findFirst({ where: { id: menuId }, select: { draftHash: true } });
    if (!menu) throw new StudioError('NOT_FOUND');
    const draft = await loadImportDraft(tx, menuId);
    const rows: ParsedSheetRow[] = sheet.rows.map((cells, index) => {
      const rowNumber = sheet.rowNumbers[index]!;
      const parsed = parseSheetRow(cells, header.columns, { currency: draft.currency, rowNumber });
      return parsed.ok ? { rowNumber, row: parsed.row } : { rowNumber, errors: parsed.errors };
    });
    const preview = diffSheet(rows, draft, { hideMissing: input.hideMissing });
    const job = await tx.importJob.create({
      data: {
        menuId,
        fileName: input.fileName.slice(0, 200),
        preview: preview as unknown as Prisma.InputJsonValue,
        rowCount: rows.length,
        draftHash: menu.draftHash ?? '',
        hideMissing: input.hideMissing,
        createdById: ctx.actor.userId,
      },
      select: { id: true },
    });
    return { importJobId: job.id, preview };
  });
}

// Applying ------------------------------------------------------------------------------------------------------------

type TranslationMap = Record<string, Record<string, string>>;

/** Translations with one text set, or removed when empty; a language left with nothing is dropped. */
function setText(translations: TranslationMap, locale: Locale, field: string, value: string): void {
  const entry = { ...(translations[locale] ?? {}) };
  if (value === '') delete entry[field];
  else entry[field] = value;
  if (Object.keys(entry).length > 0) translations[locale] = entry;
  else delete translations[locale];
}

const TEXT_FIELDS: Record<string, [Locale, 'name' | 'description']> = Object.fromEntries(
  LOCALES.flatMap((locale) => [
    [`name_${locale}`, [locale, 'name']],
    [`description_${locale}`, [locale, 'description']],
  ]),
);

/**
 * Writes a parsed sheet to the draft in one transaction (spec 13.2): new categories and products, and each changed field,
 * moving the version of every product it changes so an editor opened before is refused. Refused as `CONFLICT` when the
 * job was already applied or discarded or the draft changed since it was read, and as `INVALID` while rows are invalid.
 */
export async function applyImport(ctx: ActionContext, input: { importJobId: string }): Promise<{ summary: ImportPreview['summary']; liveSkipped: number }> {
  const canChangeLive = ctx.permissions.has('content.availability');
  return editDraft(ctx, async (tx, menuId) => {
    const job = await tx.importJob.findFirst({ where: { id: input.importJobId } });
    if (!job) throw new StudioError('NOT_FOUND');
    if (job.status !== 'PARSED') throw new StudioError('CONFLICT', 'This import was already applied or discarded');
    const menu = await tx.menu.findFirst({ where: { id: menuId }, select: { draftHash: true } });
    if ((menu?.draftHash ?? '') !== job.draftHash) throw new StudioError('CONFLICT', 'The menu changed after this sheet was read. Upload it again.');
    const preview = job.preview as unknown as ImportPreview;
    if (preview.summary.invalid > 0) throw new StudioError('INVALID', 'Fix the rows marked invalid and upload the sheet again');

    // Pictures an AI reading brought from a link, for the new products it creates; only assets of this restaurant's own library.
    const photos = (job.photos ?? {}) as Record<string, string>;
    // Arabic and Kurdish the AI worked out for English-only texts, by the English text; they go to new products and categories only.
    const worked = (job.translations ?? {}) as Record<string, { ar: string | null; ckb: string | null }>;
    // A value that is still an address was never brought in; it is not an asset.
    const photoIds = [...new Set(Object.values(photos).filter((value) => !/^https?:\/\//.test(value)))];
    const ownedPhotos = new Set(photoIds.length === 0 || ctx.restaurantId === null ? [] : (await ctx.db.mediaAsset.findMany({ where: { id: { in: photoIds }, restaurantId: ctx.restaurantId }, select: { id: true } })).map((asset) => asset.id));

    // New categories go after the others, in the order the sheet names them.
    const categories = await tx.category.findMany({ select: { id: true, slug: true, sortOrder: true } });
    const categoryIds = new Map(categories.map((category) => [category.slug, category.id]));
    let nextCategory = categories.reduce((max, category) => Math.max(max, category.sortOrder + 1), 0);
    for (const category of preview.newCategories) {
      const translations = Object.fromEntries(Object.entries(category.names).map(([locale, name]) => [locale, { name }]));
      const spoken = category.names.en && !category.names.ar && !category.names.ckb ? worked[category.names.en] : undefined;
      if (spoken?.ar) translations.ar = { name: spoken.ar };
      if (spoken?.ckb) translations.ckb = { name: spoken.ckb };
      const row = await tx.category.create({ data: { menuId, slug: category.slug, sortOrder: nextCategory++, translations }, select: { id: true } });
      categoryIds.set(category.slug, row.id);
      ctx.audit({ action: 'category.created', entityType: 'Category', entityId: row.id, changes: { names: { before: null, after: category.names }, slug: { before: null, after: category.slug } } });
    }

    const products = await tx.product.findMany({ select: { id: true, slug: true, categoryId: true, sortOrder: true, translations: true } });
    const byId = new Map(products.map((product) => [product.id, product]));
    const takenSlugs = new Set(products.map((product) => product.slug));
    for (const row of preview.rows) if (row.status === 'new' && row.productSlug) takenSlugs.add(row.productSlug);
    const nextSort = new Map<string, number>();
    for (const product of products) nextSort.set(product.categoryId, Math.max(nextSort.get(product.categoryId) ?? 0, product.sortOrder + 1));

    let liveSkipped = 0;
    let liveChanged = false;
    for (const row of preview.rows) {
      if (row.status !== 'new' && row.status !== 'changed') continue;
      const existing = row.productId ? byId.get(row.productId) : undefined;
      if (row.status === 'changed' && !existing) throw new StudioError('CONFLICT', 'The menu changed after this sheet was read. Upload it again.');
      const translations: TranslationMap = structuredClone((existing?.translations ?? {}) as TranslationMap);
      const data: Record<string, unknown> = {};
      const live: Record<string, unknown> = {};
      for (const change of row.changes ?? []) {
        const text = TEXT_FIELDS[change.field];
        if (text) setText(translations, text[0], text[1], String(change.after ?? ''));
        else if (change.field === 'category') data.categoryId = categoryIds.get(String(change.after));
        else if (change.field === 'price') data.basePrice = change.after;
        else if (change.field === 'featured') data.isFeatured = change.after;
        else if (change.field === 'signature') data.isSignature = change.after;
        else if (change.field === 'badges' || change.field === 'dietary' || change.field === 'allergens') data[change.field] = change.after;
        else if (change.field === 'calories') data.calories = change.after;
        else if (change.field === 'sort') data.sortOrder = change.after;
        else if (change.field === 'available') {
          if (!change.live || canChangeLive) live.isAvailable = change.after;
          else liveSkipped += 1;
        }
      }

      if (row.status === 'new') {
        const categoryId = data.categoryId as string;
        const slug = row.productSlug || uniqueSlug(slugFromNames({ en: row.name }, 'product'), takenSlugs);
        takenSlugs.add(slug);
        const sortOrder = (data.sortOrder as number | undefined) ?? nextSort.get(categoryId) ?? 0;
        nextSort.set(categoryId, Math.max(nextSort.get(categoryId) ?? 0, sortOrder + 1));
        for (const field of ['name', 'description'] as const) {
          const english = translations.en?.[field];
          const spoken = english && !translations.ar?.[field] && !translations.ckb?.[field] ? worked[english] : undefined;
          if (spoken?.ar) setText(translations, 'ar', field, spoken.ar);
          if (spoken?.ckb) setText(translations, 'ckb', field, spoken.ckb);
        }
        const photo = photos[`${String(row.changes?.find((change) => change.field === 'category')?.after ?? '')}\n${row.name.toLowerCase()}`];
        const media = photo !== undefined && ownedPhotos.has(photo) ? { media: [{ kind: 'asset', assetId: photo }] } : {};
        const created = await tx.product.create({ data: { ...data, ...live, ...media, menuId, categoryId, slug, sortOrder, basePrice: data.basePrice as number, translations } as never, select: { id: true } });
        ctx.audit({ action: 'product.created', entityType: 'Product', entityId: created.id, changes: { names: { before: null, after: { en: row.name } }, price: { before: null, after: data.basePrice } } });
        continue;
      }
      const draftChanged = Object.keys(data).length > 0 || JSON.stringify(translations) !== JSON.stringify(existing!.translations ?? {});
      // Each product's own audit row: an editor opened before the import is refused naming who changed it (spec 10.5).
      const audited = Object.fromEntries((row.changes ?? []).filter((change) => !change.live).map((change) => [change.field, { before: change.before, after: change.after }]));
      if (draftChanged) {
        await tx.product.updateMany({ where: { id: existing!.id }, data: { ...data, ...live, translations, version: { increment: 1 } } as never });
        ctx.audit({ action: 'product.updated', entityType: 'Product', entityId: existing!.id, changes: audited });
      } else if (Object.keys(live).length > 0) {
        // Sold out alone is not part of the draft: like the Availability tab, it moves no version.
        await tx.product.updateMany({ where: { id: existing!.id }, data: live as never });
      }
      if (Object.keys(live).length > 0) {
        liveChanged = true;
        const change = row.changes!.find((entry) => entry.field === 'available')!;
        ctx.audit({ action: 'product.availability_changed', entityType: 'Product', entityId: existing!.id, changes: { isAvailable: { before: change.before, after: change.after } } });
      }
    }

    if (job.hideMissing && preview.missing.length > 0) {
      if (canChangeLive) {
        const shown = await tx.product.findMany({ where: { id: { in: preview.missing.map((product) => product.productId) }, isHidden: false }, select: { id: true } });
        await tx.product.updateMany({ where: { id: { in: shown.map((product) => product.id) } }, data: { isHidden: true } });
        for (const product of shown) ctx.audit({ action: 'product.availability_changed', entityType: 'Product', entityId: product.id, changes: { isHidden: { before: false, after: true } } });
        liveChanged = true;
      } else liveSkipped += preview.summary.hidden;
    }

    await tx.importJob.updateMany({ where: { id: job.id }, data: { status: 'APPLIED', appliedAt: new Date() } });
    ctx.audit({
      action: 'menu.imported',
      entityType: 'ImportJob',
      entityId: job.id,
      changes: { fileName: { before: null, after: job.fileName }, summary: { before: null, after: preview.summary }, liveSkipped: { before: null, after: liveSkipped } },
    });
    if (liveChanged) ctx.afterCommit(() => expireLive(menuId));
    return { summary: preview.summary, liveSkipped };
  });
}

/** Sets a parsed sheet aside without applying it. */
export async function discardImport(ctx: ActionContext, input: { importJobId: string }): Promise<void> {
  await ctx.transaction(async (tx) => {
    const job = await tx.importJob.findFirst({ where: { id: input.importJobId }, select: { id: true, status: true } });
    if (!job) throw new StudioError('NOT_FOUND');
    if (job.status !== 'PARSED') throw new StudioError('CONFLICT', 'This import was already applied or discarded');
    await tx.importJob.updateMany({ where: { id: job.id }, data: { status: 'DISCARDED' } });
  });
}

export interface ImportJobView {
  id: string;
  fileName: string;
  status: 'PARSED' | 'APPLIED' | 'DISCARDED' | 'FAILED';
  preview: ImportPreview;
  hideMissing: boolean;
  createdAt: string;
}

export async function importJob(db: PrismaClient, menuId: string, importJobId: string): Promise<ImportJobView> {
  const job = await menuDb(db, menuId).importJob.findFirst({ where: { id: importJobId } });
  if (!job) throw new StudioError('NOT_FOUND');
  return {
    id: job.id,
    fileName: job.fileName,
    status: job.status,
    preview: job.preview as unknown as ImportPreview,
    hideMissing: job.hideMissing,
    createdAt: job.createdAt.toISOString(),
  };
}

// Exporting ------------------------------------------------------------------------------------------------------------

/** The draft as a sheet in the import's own format, handed out through a five-minute link. */
export async function exportMenu(ctx: ActionContext, input: { format: SheetFormat }): Promise<{ url: string }> {
  const menuId = menuOf(ctx);
  const scoped = menuDb(ctx.db, menuId);
  const [menu, draft] = await Promise.all([scoped.menu.findFirst({ where: { id: menuId }, select: { slug: true } }), loadImportDraft(scoped, menuId)]);
  if (!menu) throw new StudioError('NOT_FOUND');
  const rows = sheetRowsFromDraft(draft);
  const body = input.format === 'csv' ? writeCsv(rows) : await writeXlsx(rows);
  const fileName = `${menu.slug}-menu.${input.format}`;
  const storage = getStorage();
  const key = exportKey(menuId, randomUUID(), fileName);
  await storage.put(key, body, { contentType: SHEET_TYPES[input.format], cacheControl: 'private, no-store' });
  ctx.audit({ action: 'menu.exported', entityType: 'Menu', entityId: menuId, changes: { format: { before: null, after: input.format }, products: { before: null, after: draft.products.length } } });
  return { url: await storage.presignGet(key, { fileName, expiresInSec: DOWNLOAD_LINK_SEC }) };
}
