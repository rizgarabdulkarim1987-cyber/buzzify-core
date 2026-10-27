import { z } from 'zod';
import { guardedAi } from '@/server/ai/ai-error-code';
import { menuImportInput } from '@/server/ai/menu-import';
import { defineAction } from '@/server/studio/framework/action';
import { idField } from '@/server/studio/services/content';
import {
  applyImport,
  discardImport,
  exportMenu as exportDraft,
  parseImport,
  requestImportUpload,
  sheetFileNameField,
  sheetFormatField,
} from '@/server/studio/services/imports';
import { bringAiPhotos, previewAiMenuImport, translateAiMenu } from '@/server/studio/services/imports-ai';

/** The Import and export tab (spec 13): a sheet in, previewed and applied to the draft; the draft out as a sheet. */

const atMenu = (menuId: string) => ({ kind: 'menu', menuId }) as const;
const jobInput = z.object({ menuId: idField, importJobId: idField });

export const requestUpload = defineAction({
  name: 'import.requestUpload',
  permission: 'import.run',
  input: z.object({ menuId: idField, fileName: sheetFileNameField, bytes: z.number().int().min(1) }),
  target: (i) => atMenu(i.menuId),
  run: (ctx, input) => requestImportUpload(ctx, input),
});

export const parse = defineAction({
  name: 'import.parse',
  permission: 'import.run',
  input: z.object({ menuId: idField, uploadKey: z.string().min(1).max(300), fileName: sheetFileNameField, hideMissing: z.boolean() }),
  target: (i) => atMenu(i.menuId),
  run: (ctx, input) => parseImport(ctx, input),
});

/** Reads another menu (a photo, a PDF or a link) with AI into the usual import preview. Saves nothing. */
export const aiRead = defineAction({
  name: 'import.aiRead',
  permission: 'import.run',
  input: z.object({ menuId: idField, source: menuImportInput }),
  target: (i) => atMenu(i.menuId),
  run: (ctx, input) => guardedAi(() => previewAiMenuImport(ctx, input.source)),
});

/** Brings the next few pictures of an AI reading into the library; the page asks again until none are left. */
export const aiPhotos = defineAction({
  name: 'import.aiPhotos',
  permission: 'import.run',
  input: jobInput,
  target: (i) => atMenu(i.menuId),
  run: (ctx, input) => bringAiPhotos(ctx, input),
});

/** Works out Arabic and Kurdish for what an AI reading is about to create; the page asks again until none is left. */
export const aiTranslate = defineAction({
  name: 'import.aiTranslate',
  permission: 'import.run',
  input: jobInput,
  target: (i) => atMenu(i.menuId),
  run: (ctx, input) => guardedAi(() => translateAiMenu(ctx, input)),
});

export const apply = defineAction({
  name: 'import.apply',
  permission: 'import.run',
  input: jobInput,
  target: (i) => atMenu(i.menuId),
  run: (ctx, input) => applyImport(ctx, input),
});

export const discard = defineAction({
  name: 'import.discard',
  permission: 'import.run',
  input: jobInput,
  target: (i) => atMenu(i.menuId),
  run: (ctx, input) => discardImport(ctx, input),
});

export const exportMenu = defineAction({
  name: 'export.download',
  permission: 'export.run',
  input: z.object({ menuId: idField, format: sheetFormatField }),
  target: (i) => atMenu(i.menuId),
  run: (ctx, input) => exportDraft(ctx, input),
});
