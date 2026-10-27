import type { Prisma } from '@/generated/prisma/client';
import { linkDeps, openLink, type LinkDeps } from '@/server/ai/link-fetch';
import { readMenu, toMenuSheet } from '@/server/ai/menu-import';
import { SUPPLY_FILE_MAX_BYTES } from '@/server/ai/supply-limits';
import type { ImportPreview } from '@/server/domain/import-sheet';
import { importKey, uploadKey } from '@/server/storage/keys';
import { getStorage } from '@/server/storage/storage';
import type { ActionContext } from '@/server/studio/framework/action';
import { createId } from '@/server/studio/framework/ids';
import { loadImportDraft, parseImport } from './imports';
import { finalizeUpload } from './media';

/**
 * The AI menu import, for the Studio and the cashier alike: another menu (a photo, a PDF or a link) is read into products,
 * written as the Studio's own menu sheet and handed to the Studio's importer, which previews it against the draft. The
 * preview, the draft check on apply, the writes and the audit are the ones every menu import has. Products the menu
 * does not name are never hidden. Pictures a link's page shows for its items are brought into the restaurant's media
 * library now and attached to the products the import creates, when it is applied.
 */

const PHOTOS_MAX = 150;
const PHOTOS_AT_ONCE = 8;
/** No new picture is started after this long, so a big menu still answers in time with the pictures already brought. */
const PHOTOS_BUDGET_MS = 40_000;
const PHOTO_FOLDER = 'ai-import';

/** A picture's asset in the restaurant's library, or null when it could not be fetched or is not a usable picture. */
async function bringPhoto(ctx: ActionContext, restaurantId: string, url: string, deps: LinkDeps): Promise<string | null> {
  try {
    const { type, bytes } = await openLink(url, deps, 'image/avif,image/webp,image/png,image/jpeg,image/*;q=0.5', SUPPLY_FILE_MAX_BYTES);
    if (!type.startsWith('image/')) return null;
    const key = uploadKey({ restaurantId }, createId());
    await getStorage().put(key, bytes, { contentType: type, cacheControl: 'no-store' });
    return (await finalizeUpload(ctx, { restaurantId }, { uploadKey: key, alt: {}, folder: PHOTO_FOLDER })).assetId;
  } catch {
    // A picture that cannot be brought in leaves its product without one; the import itself goes on.
    return null;
  }
}

export async function previewAiMenuImport(
  ctx: ActionContext,
  input: unknown,
  deps: LinkDeps = linkDeps(),
): Promise<{ importJobId: string; preview: ImportPreview; skipped: number; photos: number; currencyMismatch: { source: string; menu: string } | null }> {
  if (ctx.menuId === null || ctx.restaurantId === null) throw new Error('A menu import ran without a menu');
  const { menuId, restaurantId } = ctx;
  const draft = await ctx.transaction((tx) => loadImportDraft(tx, menuId));
  const reading = await readMenu({ db: ctx.db, restaurantId, staffId: ctx.pos?.userId ?? null }, input, draft.currency, deps);
  const { csv, rows } = toMenuSheet(reading.products, draft.categories.map((category) => ({ slug: category.slug, names: category.names })));

  const wanted = rows.filter((row) => row.product.imageUrl !== null).slice(0, PHOTOS_MAX);
  const urls = [...new Set(wanted.map((row) => row.product.imageUrl!))];
  const assets = new Map<string, string>();
  const started = Date.now();
  for (let at = 0; at < urls.length && Date.now() - started < PHOTOS_BUDGET_MS; at += PHOTOS_AT_ONCE) {
    await Promise.all(
      urls.slice(at, at + PHOTOS_AT_ONCE).map(async (url) => {
        const assetId = await bringPhoto(ctx, restaurantId, url, deps);
        if (assetId !== null) assets.set(url, assetId);
      }),
    );
  }
  const photos = Object.fromEntries(wanted.flatMap((row) => (assets.has(row.product.imageUrl!) ? [[row.key, assets.get(row.product.imageUrl!)!]] : [])));

  const key = importKey(menuId, createId());
  await getStorage().put(key, new TextEncoder().encode(csv), { contentType: 'text/csv', cacheControl: 'no-store' });
  const parsed = await parseImport(ctx, { uploadKey: key, fileName: 'ai-menu.csv', hideMissing: false });
  if (Object.keys(photos).length > 0) {
    await ctx.transaction((tx) => tx.importJob.updateMany({ where: { id: parsed.importJobId }, data: { photos: photos as Prisma.InputJsonValue } }));
  }
  const mismatch = reading.sourceCurrency !== null && reading.sourceCurrency !== draft.currency;
  return { ...parsed, skipped: reading.skipped, photos: Object.keys(photos).length, currencyMismatch: mismatch ? { source: reading.sourceCurrency!, menu: draft.currency } : null };
}
