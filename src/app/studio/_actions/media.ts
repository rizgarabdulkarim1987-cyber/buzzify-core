'use server';

import * as media from '@/server/studio/actions/media';
import { invoke, invokeQuery } from '@/server/studio/framework/invoke';
import * as mediaQueries from '@/server/studio/queries/media';

export async function requestUpload(input: unknown) {
  return invoke(media.requestUpload, input);
}

export async function requestSharedUpload(input: unknown) {
  return invoke(media.requestSharedUpload, input);
}

export async function updateAsset(input: unknown) {
  return invoke(media.updateAsset, input);
}

export async function updateSharedAsset(input: unknown) {
  return invoke(media.updateSharedAsset, input);
}

export async function deleteAsset(input: unknown) {
  return invoke(media.deleteAsset, input);
}

export async function deleteSharedAsset(input: unknown) {
  return invoke(media.deleteSharedAsset, input);
}

export async function listMedia(input: unknown) {
  return invokeQuery(mediaQueries.listMedia, input);
}

export async function mediaUsage(input: unknown) {
  return invokeQuery(mediaQueries.usage, input);
}

export async function sharedMediaUsage(input: unknown) {
  return invokeQuery(mediaQueries.sharedUsage, input);
}
