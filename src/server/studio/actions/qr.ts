import { z } from 'zod';
import { defineAction } from '@/server/studio/framework/action';
import { idField } from '@/server/studio/services/content';
import {
  applyQrStyle,
  createQrCode,
  createTableCodes,
  deleteQrCode,
  downloadQrCode,
  downloadTableCodes,
  MAX_TABLE_CODES,
  QR_PNG_SIZES,
  qrLabelField,
  qrStyleField,
  tableNumberField,
  updateQrCode,
} from '@/server/studio/services/qr';

/** The QR tab (spec 10.8): codes for the menu and its tables, their look, and their downloads. */

const atMenu = (menuId: string) => ({ kind: 'menu', menuId }) as const;

export const create = defineAction({
  name: 'qr.create',
  permission: 'qr.manage',
  input: z.object({ menuId: idField, label: qrLabelField, tableNumber: tableNumberField.optional() }),
  target: (i) => atMenu(i.menuId),
  run: (ctx, input) => createQrCode(ctx, input),
});

export const createForTables = defineAction({
  name: 'qr.createForTables',
  permission: 'qr.manage',
  input: z
    .object({ menuId: idField, from: tableNumberField, to: tableNumberField })
    .refine((input) => input.to >= input.from, { message: 'The last table comes after the first', path: ['to'] })
    .refine((input) => input.to - input.from < MAX_TABLE_CODES, { message: 'Make at most 200 codes at once', path: ['to'] }),
  target: (i) => atMenu(i.menuId),
  run: (ctx, input) => createTableCodes(ctx, input),
});

export const update = defineAction({
  name: 'qr.update',
  permission: 'qr.manage',
  input: z.object({ menuId: idField, qrCodeId: idField, version: z.number().int().min(1), label: qrLabelField, style: qrStyleField }),
  target: (i) => atMenu(i.menuId),
  run: (ctx, input) => updateQrCode(ctx, input),
});

export const applyStyle = defineAction({
  name: 'qr.applyStyle',
  permission: 'qr.manage',
  input: z.object({ menuId: idField, qrCodeId: idField }),
  target: (i) => atMenu(i.menuId),
  run: (ctx, input) => applyQrStyle(ctx, input),
});

export const remove = defineAction({
  name: 'qr.delete',
  permission: 'qr.manage',
  input: z.object({ menuId: idField, qrCodeId: idField }),
  target: (i) => atMenu(i.menuId),
  run: (ctx, input) => deleteQrCode(ctx, input),
});

export const download = defineAction({
  name: 'qr.download',
  permission: 'qr.manage',
  input: z.object({
    menuId: idField,
    qrCodeId: idField,
    format: z.enum(['svg', 'png']),
    size: z.union(QR_PNG_SIZES.map((size) => z.literal(size))).optional(),
  }),
  target: (i) => atMenu(i.menuId),
  run: (ctx, input) => downloadQrCode(ctx, input),
});

export const downloadTables = defineAction({
  name: 'qr.downloadTables',
  permission: 'qr.manage',
  input: z.object({ menuId: idField }),
  target: (i) => atMenu(i.menuId),
  run: (ctx) => downloadTableCodes(ctx),
});
