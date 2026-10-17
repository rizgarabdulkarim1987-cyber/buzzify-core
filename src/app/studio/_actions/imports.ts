'use server';

import * as imports from '@/server/studio/actions/imports';
import { invoke } from '@/server/studio/framework/invoke';

export async function requestImportUpload(input: unknown) {
  return invoke(imports.requestUpload, input);
}

export async function parseImport(input: unknown) {
  return invoke(imports.parse, input);
}

export async function applyImport(input: unknown) {
  return invoke(imports.apply, input);
}

export async function discardImport(input: unknown) {
  return invoke(imports.discard, input);
}

export async function exportMenu(input: unknown) {
  return invoke(imports.exportMenu, input);
}
