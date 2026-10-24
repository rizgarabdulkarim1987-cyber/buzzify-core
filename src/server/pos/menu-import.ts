import { importKey } from '@/server/storage/keys';
import { getStorage } from '@/server/storage/storage';
import type { ActionContext } from '@/server/studio/framework/action';
import { createId } from '@/server/studio/framework/ids';
import { loadImportDraft, parseImport } from '@/server/studio/services/imports';
import { parsePosCsv, refuseCsv, toStudioSheet } from './menu-csv';

/**
 * Reads the cashier's old product list into a preview against the restaurant's product-list menu. The file becomes the
 * Studio's own menu sheet and goes through the Studio's importer, so the preview, the draft check on apply, the writes
 * and the audit are the ones every menu import has. Products the file does not name are never hidden.
 */
export async function previewPosImport(ctx: ActionContext, input: { fileName: string; csv: string }) {
  if (ctx.menuId === null) throw new Error('A till action ran without a menu');
  const menuId = ctx.menuId;
  const parsed = parsePosCsv(input.csv);
  if (parsed.errors.length > 0) throw refuseCsv(parsed.errors);

  const draft = await ctx.transaction((tx) => loadImportDraft(tx, menuId));
  const sheet = toStudioSheet(parsed.rows, draft.categories.map((category) => ({ slug: category.slug, names: category.names })));
  const key = importKey(menuId, createId());
  const bytes = new TextEncoder().encode(sheet);
  await getStorage().put(key, bytes, { contentType: 'text/csv', cacheControl: 'no-store' });
  return parseImport(ctx, { uploadKey: key, fileName: input.fileName, hideMissing: false });
}
