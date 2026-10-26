import { z } from 'zod';
import type { Prisma } from '@/generated/prisma/client';
import { canonicalStrings } from '@/lib/canonical';
import { LOCALES } from '@/lib/locale';
import { createId } from '@/server/studio/framework/ids';
import type { ActionContext } from '@/server/studio/framework/action';
import { updateWithVersion } from '@/server/studio/framework/concurrency';
import { StudioError } from '@/server/studio/framework/result';
import { checkUploadRequest, declaredMime, MEDIA_MAX_BYTES, UPLOAD_MAX_BYTES } from '@/server/domain/media-type';
import type { SceneMedia } from '@/lib/templates/types';
import { isSceneKind, PICTURE_KINDS, SCENE_KINDS } from '@/server/media/kinds';
import { sceneMediaOf } from '@/server/media/scene';
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
  TYPE: 'Use a JPEG, PNG, WebP, AVIF, SVG or ICO picture, or a GLB, MP4 or Lottie JSON scene file',
  SIZE: 'Use a picture of at most 15 MB, a model of at most 10 MB, a video of at most 20 MB or a Lottie file of at most 2 MB',
  DIMENSIONS: 'Use a picture at most 10,000 pixels on a side and at most 8 times longer than it is wide',
  UNREADABLE: 'This file could not be read as a picture',
  SVG_UNSAFE: 'This SVG has no size or nothing that can be drawn safely',
  POSTER: 'A video needs a still frame to show before it plays; this browser could not take one from it',
  MODEL_INVALID: 'This file could not be read as a GLB model',
  MODEL_EXTERNAL: 'This model loads files from elsewhere; export it as one GLB file with everything inside',
  MODEL_EXTENSION: 'This model needs a decoder the menu does not load (Draco or KTX2); export it without that compression',
  MODEL_TOO_COMPLEX: 'This model is too heavy for a phone: use at most 300,000 triangles and textures of at most 4096 pixels',
  VIDEO_INVALID: 'This file could not be read as an MP4 video',
  VIDEO_CODEC: 'Use an MP4 video in H.264, which every phone plays',
  VIDEO_DIMENSIONS: 'Use a video of at most 1920 pixels on its longest side (export it at 1080p)',
  VIDEO_DURATION: 'Use a video of at most 30 seconds',
  LOTTIE_INVALID: 'This file is not a Lottie animation the menu can play',
  LOTTIE_EXPRESSION: 'This Lottie animation uses expressions, which the menu does not run; export it without them',
  LOTTIE_EXTERNAL: 'This Lottie animation loads images or fonts from elsewhere; embed them in the file',
  LOTTIE_TOO_COMPLEX: 'This Lottie animation is too large: use at most 60 seconds, 4096 pixels a side and 2,000 layers',
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
  /** A video's poster frame, uploaded to its own slot beside it. */
  posterKey: z.string().min(1).max(300).optional(),
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

/** An upload's bytes, at most `maxBytes`; a larger one is removed and refused. */
async function readUpload(key: string, maxBytes: number): Promise<Uint8Array> {
  const storage = getStorage();
  try {
    const object = await storage.get(key, maxBytes);
    if (!object) throw new StudioError('NOT_FOUND');
    return object.bytes;
  } catch (error) {
    if (error instanceof StorageTooLargeError) {
      await storage.delete([key]);
      throw refuse('SIZE');
    }
    throw error;
  }
}

/**
 * Turns an uploaded file into an asset of the library: checked from its bytes, made into variants and stored. A video
 * comes with its poster frame in a second upload. The same file uploaded to the same library again is the asset it
 * already is. The uploads themselves are removed whatever happens.
 */
export async function finalizeUpload(
  ctx: ActionContext,
  library: Library,
  input: { uploadKey: string; posterKey?: string | undefined; alt: Partial<Record<string, string>>; folder: string },
): Promise<{ assetId: string; deduplicated: boolean }> {
  const prefix = `${uploadKey(library, 'x').slice(0, -1)}`;
  const keys = [input.uploadKey, ...(input.posterKey ? [input.posterKey] : [])];
  if (keys.some((key) => !isValidKey(key) || !key.startsWith(prefix))) throw new StudioError('NOT_FOUND');

  const storage = getStorage();
  let prepared;
  try {
    const bytes = await readUpload(input.uploadKey, UPLOAD_MAX_BYTES);
    const poster = input.posterKey ? await readUpload(input.posterKey, MEDIA_MAX_BYTES) : undefined;
    prepared = await prepareAsset(bytes, poster);
  } finally {
    await storage.delete(keys);
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
        durationMs: asset.durationMs,
        meta: asset.meta as Prisma.InputJsonValue,
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
    ...Object.values(variants.poster?.avif ?? {}),
    ...Object.values(variants.poster?.webp ?? {}),
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

  await deleteUnsharedFiles(ctx.db, [row]);
  return { deleted: true };
}

/**
 * Deletes the files of assets whose rows are gone: an asset deleted from its library, or every asset of a deleted
 * restaurant. A folder another asset still names (a copy for another restaurant) stays.
 */
export async function deleteUnsharedFiles(db: ActionContext['db'], assets: ReadonlyArray<{ storageKey: string; variants: unknown }>): Promise<void> {
  const folders = new Map(assets.map((asset) => [asset.storageKey, asset.variants as AssetVariants]));
  for (const [storageKey, variants] of folders) {
    if ((await db.mediaAsset.count({ where: { storageKey } })) > 0) continue;
    await getStorage().delete(fileKeys(variants));
  }
}

// Listing -------------------------------------------------------------------------------------------------------------

export const MEDIA_PAGE_SIZE = 48;

export interface MediaRow {
  id: string;
  kind: 'IMAGE' | 'SVG' | 'ICON' | 'MODEL' | 'VIDEO' | 'LOTTIE';
  /** Empty for a model or a Lottie animation, which have no picture of their own. */
  thumbUrl: string;
  width: number | null;
  height: number | null;
  /** A video's or a Lottie animation's length. */
  durationMs: number | null;
  /** What a scene file holds (a model's triangles, a video's codec and sound, a Lottie's frame rate and layers). */
  meta: Record<string, unknown>;
  /** A scene file as a menu would play it, for the Design tab's live preview; null for a picture. */
  scene: SceneMedia | null;
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

/** A WebP rendition: the given width, else the widest no wider than it, else the narrowest. */
function webpAt(webp: Record<string, string> | undefined, width: number): string | undefined {
  const widths = Object.keys(webp ?? {}).map(Number).sort((a, b) => a - b);
  const chosen = widths.filter((w) => w <= width).at(-1) ?? widths[0];
  return chosen === undefined ? undefined : webp![String(chosen)];
}

/**
 * The key of an asset's small picture: its 320 px WebP, a video's poster at 320 px, or the file itself for an SVG or an
 * icon. Empty for a model or a Lottie animation, which have none.
 */
export function thumbKey(kind: string, variants: AssetVariants): string {
  if (kind === 'IMAGE') return webpAt(variants.webp, 320) ?? variants.original;
  if (kind === 'VIDEO') return webpAt(variants.poster?.webp, 320) ?? '';
  if (kind === 'MODEL' || kind === 'LOTTIE') return '';
  return variants.original;
}

/** The key of an asset's larger picture: its 640 px WebP (a video's poster), or the file itself for an SVG or an icon. */
function previewKey(kind: string, variants: AssetVariants): string {
  if (kind === 'VIDEO') return webpAt(variants.poster?.webp, 640) ?? '';
  if (kind === 'MODEL' || kind === 'LOTTIE') return '';
  if (kind !== 'IMAGE') return variants.original;
  return webpAt(variants.webp, 640) ?? variants.original;
}

/** Which kinds a listing shows: pictures for the pickers that place them, scene files for the Design tab, all for the Media page. */
export const LIST_KINDS = ['pictures', 'scene', 'all'] as const;
export type ListKinds = (typeof LIST_KINDS)[number];

const KINDS_FILTER: Record<ListKinds, Prisma.MediaAssetWhereInput> = {
  pictures: { kind: { in: [...PICTURE_KINDS] } },
  scene: { kind: { in: [...SCENE_KINDS] } },
  all: {},
};

/**
 * A page of a library: a restaurant's assets with the shared ones (for picking), its own alone (`own`, for managing),
 * or the shared library alone; pictures unless `kinds` asks for scene files or everything. `storageBytes` is what the
 * library itself keeps in storage, whatever the kinds shown.
 */
export async function listLibrary(
  db: ActionContext['db'],
  library: Library,
  input: { folder?: string; tag?: string; q?: string; page: number; own?: boolean; kinds?: ListKinds },
): Promise<{ rows: MediaRow[]; folders: string[]; tags: string[]; total: number; storageBytes: number }> {
  const own: Prisma.MediaAssetWhereInput = { restaurantId: library.restaurantId };
  const scope: Prisma.MediaAssetWhereInput = {
    AND: [library.restaurantId === null || input.own ? own : { OR: [{ restaurantId: library.restaurantId }, { restaurantId: null }] }, KINDS_FILTER[input.kinds ?? 'pictures']],
  };
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
  const url = (key: string) => (key === '' ? '' : storage.publicUrl(key));
  return {
    rows: rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      thumbUrl: url(thumbKey(row.kind, row.variants as unknown as AssetVariants)),
      width: row.width,
      height: row.height,
      durationMs: row.durationMs,
      meta: (row.meta ?? {}) as Record<string, unknown>,
      scene: isSceneKind(row.kind) ? sceneMediaOf(row, (key) => storage.publicUrl(key)) : null,
      alt: (row.alt ?? {}) as Record<string, string>,
      folder: row.folder,
      tags: row.tags,
      shared: row.restaurantId === null,
      version: row.version,
      bytes: row.bytes,
      mime: row.mime,
      previewUrl: url(previewKey(row.kind, row.variants as unknown as AssetVariants)),
      originalUrl: storage.publicUrl((row.variants as unknown as AssetVariants).original),
      createdAt: row.createdAt.toISOString(),
    })),
    folders: folders.map((row) => row.folder),
    tags: canonicalStrings(tagged.flatMap((row) => row.tags)),
    total,
    storageBytes: stored._sum.storedBytes ?? 0,
  };
}
