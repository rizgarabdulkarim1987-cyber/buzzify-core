'use server';

import * as qr from '@/server/studio/actions/qr';
import { invoke, invokeQuery } from '@/server/studio/framework/invoke';
import * as qrQueries from '@/server/studio/queries/qr';

export async function createQrCode(input: unknown) {
  return invoke(qr.create, input);
}

export async function createTableQrCodes(input: unknown) {
  return invoke(qr.createForTables, input);
}

export async function updateQrCode(input: unknown) {
  return invoke(qr.update, input);
}

export async function applyQrStyle(input: unknown) {
  return invoke(qr.applyStyle, input);
}

export async function deleteQrCode(input: unknown) {
  return invoke(qr.remove, input);
}

export async function downloadQrCode(input: unknown) {
  return invoke(qr.download, input);
}

export async function downloadTableQrCodes(input: unknown) {
  return invoke(qr.downloadTables, input);
}

export async function previewQrCode(input: unknown) {
  return invokeQuery(qrQueries.preview, input);
}
