import type { Prisma } from '@/generated/prisma/client';
import { linkDeps, openLink, type LinkDeps } from '@/server/ai/link-fetch';
import { readMenu, toMenuSheet, translateTexts } from '@/server/ai/menu-import';
import { runAi } from '@/server/ai/run';
import type { ImportPreview } from '@/server/domain/import-sheet';
import { importKey, uploadKey } from '@/server/storage/keys';
import { getStorage } from '@/server/storage/storage';
import type { ActionContext } from '@/server/studio/framework/action';
import { StudioError } from '@/server/studio/framework/result';
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
const PHOTO_MAX_BYTES = 2 * 1024 * 1024;
/** A picture is brought from its address in `ImportJob.photos`; once brought, the value there is the library asset's id. */
const PHOTOS_PER_CALL = 3;
const PHOTOS_BUDGET_MS = 40_000;
const TRANSLATE_PER_CALL = 60;
const PHOTO_FOLDER = 'ai-import';

/** A picture's asset in the restaurant's library, or null when it could not be fetched or is not a usable picture. */
async function bringPhoto(ctx: ActionContext, restaurantId: string, url: string, deps: LinkDeps): Promise<string | null> {
  try {
    const { type, bytes } = await openLink(url, deps, 'image/avif,image/webp,image/png,image/jpeg,image/*;q=0.5', PHOTO_MAX_BYTES);
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

  // The pictures are brought in afterwards, a few per request (bringAiPhotos): the job holds their addresses until then.
  const wanted = rows.filter((row) => row.product.imageUrl !== null).slice(0, PHOTOS_MAX);
  const photos = Object.fromEntries(wanted.map((row) => [row.key, row.product.imageUrl!]));

  const key = importKey(menuId, createId());
  await getStorage().put(key, new TextEncoder().encode(csv), { contentType: 'text/csv', cacheControl: 'no-store' });
  const parsed = await parseImport(ctx, { uploadKey: key, fileName: 'ai-menu.csv', hideMissing: false });
  if (Object.keys(photos).length > 0) {
    await ctx.transaction((tx) => tx.importJob.updateMany({ where: { id: parsed.importJobId }, data: { photos: photos as Prisma.InputJsonValue } }));
  }
  const mismatch = reading.sourceCurrency !== null && reading.sourceCurrency !== draft.currency;
  return { ...parsed, skipped: reading.skipped, photos: Object.keys(photos).length, currencyMismatch: mismatch ? { source: reading.sourceCurrency!, menu: draft.currency } : null };
}

/** Brings the next few pictures of an AI reading into the restaurant's library, one at a time, and says how many are left. */
export async function bringAiPhotos(ctx: ActionContext, input: { importJobId: string }, deps: LinkDeps = linkDeps()): Promise<{ remaining: number }> {
  if (ctx.restaurantId === null) throw new Error('A menu import ran without a restaurant');
  const restaurantId = ctx.restaurantId;
  const job = await ctx.transaction((tx) => tx.importJob.findFirst({ where: { id: input.importJobId }, select: { status: true, photos: true } }));
  if (!job || job.status !== 'PARSED') throw new StudioError('NOT_FOUND');
  const photos = { ...((job.photos ?? {}) as Record<string, string>) };
  const pending = Object.entries(photos).filter(([, value]) => /^https?:\/\//.test(value));
  const started = Date.now();
  let done = 0;
  for (const [key, url] of pending.slice(0, PHOTOS_PER_CALL)) {
    if (Date.now() - started > PHOTOS_BUDGET_MS) break;
    const assetId = await bringPhoto(ctx, restaurantId, url, deps);
    if (assetId === null) delete photos[key];
    else photos[key] = assetId;
    done += 1;
  }
  await ctx.transaction((tx) => tx.importJob.updateMany({ where: { id: input.importJobId, status: 'PARSED' }, data: { photos: photos as Prisma.InputJsonValue } }));
  return { remaining: pending.length - done };
}

type Worked = Record<string, { ar: string | null; ckb: string | null }>;

const changeText = (row: ImportPreview['rows'][number], field: string): string => String(row.changes?.find((change) => change.field === field)?.after ?? '');

/**
 * Arabic and Sorani Kurdish for the English names, descriptions and categories a reading from a link is about to create,
 * a batch per request; the answers wait in the job and the apply gives them to the new products and categories. A text a
 * menu already prints in Arabic or Kurdish is never translated. Says how many texts are still to do.
 */
export async function translateAiMenu(ctx: ActionContext, input: { importJobId: string }): Promise<{ remaining: number }> {
  if (ctx.restaurantId === null) throw new Error('A menu import ran without a restaurant');
  const job = await ctx.transaction((tx) => tx.importJob.findFirst({ where: { id: input.importJobId }, select: { status: true, preview: true, translations: true } }));
  if (!job || job.status !== 'PARSED') throw new StudioError('NOT_FOUND');
  const preview = job.preview as unknown as ImportPreview;
  const worked: Worked = { ...((job.translations ?? {}) as Worked) };

  const texts = new Set<string>();
  const want = (en: string, ar: string, ckb: string) => {
    if (en !== '' && ar === '' && ckb === '') texts.add(en);
  };
  for (const category of preview.newCategories) want(category.names.en ?? '', category.names.ar ?? '', category.names.ckb ?? '');
  for (const row of preview.rows) {
    if (row.status !== 'new') continue;
    want(changeText(row, 'name_en'), changeText(row, 'name_ar'), changeText(row, 'name_ckb'));
    want(changeText(row, 'description_en'), changeText(row, 'description_ar'), changeText(row, 'description_ckb'));
  }
  const todo = [...texts].filter((text) => !(text in worked));
  const batch = todo.slice(0, TRANSLATE_PER_CALL);
  if (batch.length === 0) return { remaining: 0 };

  const done = await runAi({ db: ctx.db, restaurantId: ctx.restaurantId, staffId: ctx.pos?.userId ?? null }, { feature: 'MENU_IMPORT', work: (call) => translateTexts(call, batch) });
  // A text the model left out is marked so it is not asked for again.
  for (const text of batch) worked[text] = done.get(text) ?? { ar: null, ckb: null };
  await ctx.transaction((tx) => tx.importJob.updateMany({ where: { id: input.importJobId, status: 'PARSED' }, data: { translations: worked as Prisma.InputJsonValue } }));
  return { remaining: todo.length - batch.length };
}
