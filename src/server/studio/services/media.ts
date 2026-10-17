import { z } from 'zod';
import type { Prisma } from '@/generated/prisma/client';
import { canonicalStrings } from '@/lib/canonical';
import { LOCALES } from '@/lib/locale';
import { createId } from '@/server/studio/framework/ids';
import type { ActionContext } from '@/server/studio/framework/action';
import { updateWithVersion } from '@/server/studio/framework/concurrency';
import { StudioError } from '@/server/studio/framework/result';
import { checkUploadRequest, declaredMime, MEDIA_MAX_BYTES } from '@/server/domain/media-type';
import { prepareAsset, storeAsset, type AssetVariants, type MediaRefusal } from '@/server/media/process';
import { assetUsage, menusUsingInDraft, usageCount } from '@/server/media/usage';
import { isValidKey, uploadKey } from '@/server/storage/keys';
import { getStorage, StorageTooLargeError } from '@/server/storage/storage';
import { refreshDraftHashes } from './restaurants';

/**
 * The media library's work, shared by a restaurant's library and the platform's shared one (`restaurantId` null). The
 * actions check who may do it; the client of their transaction keeps each library to itself (`RESTAURANT_OR_SHARED_MODELS`),
 * and every query here also names the library, so a restaurant never reaches the shared rows to change them.
 */

export interface Library {
  restaurantId: string | null;
}

/** How long a browser has to send a file to its upload slot. */
export const UPLOAD_SLOT_SECONDS = 300;

/** Why the library refused a file, in words for the person (the Studio shows `media.refusal.*` in their language). */
export const REFUSAL_MESSAGES: Record<MediaRefusal, string> = {
  TYPE: 'Use a JPEG, PNG, WebP, AVIF, SVG or ICO file',
  SIZE: 'Use a file of at most 15 MB',
  DIMENSIONS: 'Use a picture at most 10,000 pixels on a side and at most 8 times longer than it is wide',
  UNREADABLE: 'This file could not be read as a picture',
  SVG_UNSAFE: 'This SVG has no size or nothing that can be drawn safely',
};

const refuse = (reason: MediaRefusal) => new StudioError('INVALID', REFUSAL_MESSAGES[reason], { file: reason });

// What the Studio accepts ---------------------------------------------------------------------------------------------

export const altInput = z.partialRecord(z.enum(LOCALES), z.string().trim().max(250, 'Use at most 250 characters')).default({});
export const folderField = z.string().trim().max(60, 'Use at most 60 characters').default('');
export const tagsField = z.array(z.string().trim().max(40, 'Use at most 40 characters')).max(20, 'Use at most 20 tags').default([]);
export const assetIdField = z.string().min(1).max(100);

export const uploadRequestFields = {
  fileName: z.string().trim().min(1).max(200),
  mime: z.string().trim().max(100),
  bytes: z.number().int(),
};

export const finalizeFields = {
  uploadKey: z.string().min(1).max(300),
  alt: altInput,
  folder: folderField,
};

export const updateFields = {
  assetId: assetIdField,
  version: z.number().int().positive(),
  alt: altInput,
  folder: folderField,
  tags: tagsField,
};

/** Alt text with the empty languages left out. */
function cleanAlt(alt: Partial<Record<string, string>>): Record<string, string> {
  return Object.fromEntries(Object.entries(alt).filter(([, text]) => typeof text === 'string' && text !== '')) as Record<string, string>;
}

// Uploading -----------------------------------------------------------------------------------------------------------

/** A signed slot the browser sends one file to, after the declared type and size pass. */
export async function requestUploadSlot(
  library: Library,
  input: { fileName: string; mime: string; bytes: number },
): Promise<{ uploadKey: string; url: string; headers: Record<string, string>; expiresAt: string }> {
  const problem = checkUploadRequest(input);
  if (problem) throw refuse(problem);
  const key = uploadKey(library, createId());
  const slot = await getStorage().presignPut(key, {
    contentType: declaredMime(input.mime)!,
    contentLength: input.bytes,
    expiresInSec: UPLOAD_SLOT_SECONDS,
  });
  return { uploadKey: key, ...slot, expiresAt: new Date(Date.now() + UPLOAD_SLOT_SECONDS * 1000).toISOString() };
}

/**
 * Turns an uploaded file into an asset of the library: checked from its bytes, made into variants and stored. The same
 * file uploaded to the same library again is the asset it already is. The upload itself is removed whatever happens.
 */
export async function finalizeUpload(
  ctx: ActionContext,
  library: Library,
  input: { uploadKey: string; alt: Partial<Record<string, string>>; folder: string },
): Promise<{ assetId: string; deduplicated: boolean }> {
  const prefix = `${uploadKey(library, 'x').slice(0, -1)}`;
  if (!isValidKey(input.uploadKey) || !input.uploadKey.startsWith(prefix)) throw new StudioError('NOT_FOUND');

  const storage = getStorage();
  let object;
  try {
    object = await storage.get(input.uploadKey, MEDIA_MAX_BYTES);
  } catch (error) {
    if (error instanceof StorageTooLargeError) {
      await storage.delete([input.uploadKey]);
      throw refuse('SIZE');
    }
    throw error;
  }
  if (!object) throw new StudioError('NOT_FOUND');

  let prepared;
  try {
    prepared = await prepareAsset(object.bytes);
  } finally {
    await storage.delete([input.uploadKey]);
  }
  if (!prepared.ok) throw refuse(prepared.reason);
  const asset = prepared.asset;

  const existing = await ctx.db.mediaAsset.findFirst({
    where: { restaurantId: library.restaurantId, contentHash: asset.contentHash },
    select: { id: true },
  });
  if (existing) return { assetId: existing.id, deduplicated: true };

  // The files are written first: they are named by their content, so a failed transaction leaves nothing wrong behind.
  const stored = await storeAsset(storage, library, asset);
  const assetId = await ctx.transaction(async (tx) => {
    const row = await tx.mediaAsset.create({
      data: {
        kind: asset.kind,
        storageKey: stored.storageKey,
        contentHash: asset.contentHash,
        mime: asset.mime,
        bytes: asset.bytes,
        storedBytes: stored.storedBytes,
        width: asset.width,
        height: asset.height,
        variants: stored.variants as unknown as Prisma.InputJsonValue,
        placeholder: asset.placeholder,
        alt: cleanAlt(input.alt),
        folder: input.folder,
        tags: [],
        uploadedById: ctx.actor.userId,
      },
      select: { id: true },
    });
    ctx.audit({
      action: 'media.uploaded',
      entityType: 'MediaAsset',
      entityId: row.id,
      changes: { kind: { before: null, after: asset.kind }, bytes: { before: null, after: asset.bytes } },
    });
    return row.id;
  });
  return { assetId, deduplicated: false };
}

// Changing and deleting -----------------------------------------------------------------------------------------------

/** The library's own row, or `NOT_FOUND`: a restaurant reads the shared rows too, but changes only its own. */
async function ownRow(ctx: ActionContext, library: Library, assetId: string) {
  const row = await ctx.db.mediaAsset.findFirst({ where: { id: assetId, restaurantId: library.restaurantId } });
  if (!row) throw new StudioError('NOT_FOUND');
  return row;
}

/** Saves an asset's alt text, folder and tags, and refreshes the menus whose draft shows a changed alt text. */
export async function updateAssetRow(
  ctx: ActionContext,
  library: Library,
  input: { assetId: string; version: number; alt: Partial<Record<string, string>>; folder: string; tags: string[] },
): Promise<{ version: number }> {
  const before = await ownRow(ctx, library, input.assetId);
  const alt = cleanAlt(input.alt);
  const tags = canonicalStrings(input.tags.map((tag) => tag.toLowerCase()));
  const altChanged = JSON.stringify(Object.entries(alt).sort()) !== JSON.stringify(Object.entries((before.alt ?? {}) as object).sort());

  await ctx.transaction(async (tx) => {
    await updateWithVersion(tx.mediaAsset, { id: input.assetId, version: input.version, data: { alt, folder: input.folder, tags }, entityType: 'MediaAsset' }, tx);
    ctx.audit({
      action: 'media.updated',
      entityType: 'MediaAsset',
      entityId: input.assetId,
      changes: {
        ...(altChanged ? { alt: { before: before.alt, after: alt } } : {}),
        ...(before.folder !== input.folder ? { folder: { before: before.folder, after: input.folder } } : {}),
        ...(JSON.stringify(before.tags) !== JSON.stringify(tags) ? { tags: { before: before.tags, after: tags } } : {}),
      },
    });
  });

  // Alt text is part of what guests are shown, so the drafts that show the asset have changed.
  if (altChanged) await refreshDraftHashes(ctx.db, menusUsingInDraft(await assetUsage(ctx.db, before)));
  return { version: input.version + 1 };
}

/** Every storage key of an asset's files. */
function fileKeys(variants: AssetVariants): string[] {
  return [
    variants.original,
    ...Object.values(variants.avif ?? {}),
    ...Object.values(variants.webp ?? {}),
    ...Object.values(variants.favicon ?? {}),
  ].filter((key) => typeof key === 'string' && key !== '');
}

/**
 * Deletes an asset no draft and no revision uses. Its files go too, unless another asset (a copy for another
 * restaurant) still points at them.
 */
export async function deleteAssetRow(ctx: ActionContext, library: Library, assetId: string): Promise<{ deleted: true }> {
  const row = await ownRow(ctx, library, assetId);
  const usage = await assetUsage(ctx.db, row);
  const uses = usageCount(usage);
  if (uses > 0) {
    throw new StudioError('INVALID', 'This file is used by a menu; remove it there first', { usage: String(uses) });
  }

  await ctx.transaction(async (tx) => {
    const { count } = await tx.mediaAsset.deleteMany({ where: { id: assetId } });
    if (count === 0) throw new StudioError('NOT_FOUND');
    ctx.audit({ action: 'media.deleted', entityType: 'MediaAsset', entityId: assetId, changes: { kind: { before: row.kind, after: null } } });
  });

  const others = await ctx.db.mediaAsset.count({ where: { storageKey: row.storageKey } });
  if (others === 0) await getStorage().delete(fileKeys(row.variants as unknown as AssetVariants));
  return { deleted: true };
}

// Listing -------------------------------------------------------------------------------------------------------------

export const MEDIA_PAGE_SIZE = 48;

export interface MediaRow {
  id: string;
  kind: 'IMAGE' | 'SVG' | 'ICON';
  thumbUrl: string;
  width: number | null;
  height: number | null;
  alt: Record<string, string>;
  folder: string;
  tags: string[];
  shared: boolean;
  version: number;
  bytes: number;
  mime: string;
  /** A larger picture for the details panel: the 640 px WebP, or the file itself for an SVG or an icon. */
  previewUrl: string;
  /** The file as it was uploaded (an SVG as sanitized). */
  originalUrl: string;
  createdAt: string;
}

/** The URL of an asset's small picture: its 320 px WebP, or the file itself for an SVG or an icon. */
export function thumbKey(kind: string, variants: AssetVariants): string {
  if (kind === 'IMAGE') return variants.webp?.['320'] ?? Object.values(variants.webp ?? {})[0] ?? variants.original;
  return variants.original;
}

/** The URL of an asset's larger picture: its 640 px WebP (else its widest), or the file itself for an SVG or an icon. */
function previewKey(kind: string, variants: AssetVariants): string {
  if (kind !== 'IMAGE') return variants.original;
  const widths = Object.keys(variants.webp ?? {}).map(Number).sort((a, b) => a - b);
  const width = widths.filter((w) => w <= 640).at(-1) ?? widths[0];
  return width === undefined ? variants.original : variants.webp![String(width)]!;
}

/**
 * A page of a library: a restaurant's assets with the shared ones (for picking), its own alone (`own`, for managing),
 * or the shared library alone. `storageBytes` is what the library itself keeps in storage.
 */
export async function listLibrary(
  db: ActionContext['db'],
  library: Library,
  input: { folder?: string; tag?: string; q?: string; page: number; own?: boolean },
): Promise<{ rows: MediaRow[]; folders: string[]; tags: string[]; total: number; storageBytes: number }> {
  const own: Prisma.MediaAssetWhereInput = { restaurantId: library.restaurantId };
  const scope: Prisma.MediaAssetWhereInput =
    library.restaurantId === null || input.own ? own : { OR: [{ restaurantId: library.restaurantId }, { restaurantId: null }] };
  const filters: Prisma.MediaAssetWhereInput[] = [scope];
  if (input.folder !== undefined) filters.push({ folder: input.folder });
  if (input.tag) filters.push({ tags: { has: input.tag.toLowerCase() } });
  if (input.q) filters.push({ OR: [{ folder: { contains: input.q, mode: 'insensitive' } }, { tags: { has: input.q.toLowerCase() } }] });
  const where: Prisma.MediaAssetWhereInput = { AND: filters };

  const [rows, total, folders, tagged, stored] = await Promise.all([
    db.mediaAsset.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (input.page - 1) * MEDIA_PAGE_SIZE,
      take: MEDIA_PAGE_SIZE,
    }),
    db.mediaAsset.count({ where }),
    db.mediaAsset.findMany({ where: { AND: [scope, { folder: { not: '' } }] }, distinct: ['folder'], select: { folder: true }, orderBy: { folder: 'asc' } }),
    db.mediaAsset.findMany({ where: scope, select: { tags: true }, take: 2000 }),
    db.mediaAsset.aggregate({ where: own, _sum: { storedBytes: true } }),
  ]);

  const storage = getStorage();
  return {
    rows: rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      thumbUrl: storage.publicUrl(thumbKey(row.kind, row.variants as unknown as AssetVariants)),
      width: row.width,
      height: row.height,
      alt: (row.alt ?? {}) as Record<string, string>,
      folder: row.folder,
      tags: row.tags,
      shared: row.restaurantId === null,
      version: row.version,
      bytes: row.bytes,
      mime: row.mime,
      previewUrl: storage.publicUrl(previewKey(row.kind, row.variants as unknown as AssetVariants)),
      originalUrl: storage.publicUrl((row.variants as unknown as AssetVariants).original),
      createdAt: row.createdAt.toISOString(),
    })),
    folders: folders.map((row) => row.folder),
    tags: canonicalStrings(tagged.flatMap((row) => row.tags)),
    total,
    storageBytes: stored._sum.storedBytes ?? 0,
  };
}
