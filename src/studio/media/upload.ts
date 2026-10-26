import { requestSharedUpload, requestUpload } from '@/app/studio/_actions/media';
import type { Locale } from '@/lib/locale';
import type { ActionResult, StudioFailure } from '@/server/studio/framework/result';
import { posterFrame } from './poster';

/**
 * Uploads a file to a media library from the browser (spec 11): asks for a signed slot, sends the file straight to
 * storage (R2, or the development folder) so it never passes through a function, then asks the server to check it and
 * make its variants. Progress covers the sending, which is most of the wait. A video goes with a poster frame taken from
 * it here (`poster.ts`), sent to a slot of its own first.
 */

export type UploadTarget = { restaurantId: string } | { shared: true };

export interface UploadOptions {
  alt?: Partial<Record<Locale, string>>;
  folder?: string;
  /** From 0 to 1 while the file is sent. */
  onProgress?(fraction: number): void;
}

const failed = (message: string): ActionResult<never> => ({ ok: false, error: { code: 'INVALID', message } });

/** Sends the file to the signed slot, reporting progress. */
function send(url: string, headers: Record<string, string>, file: Blob, onProgress?: (fraction: number) => void): Promise<boolean> {
  return new Promise((resolve) => {
    const request = new XMLHttpRequest();
    request.open('PUT', url);
    for (const [name, value] of Object.entries(headers)) request.setRequestHeader(name, value);
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(event.loaded / event.total);
    };
    request.onload = () => resolve(request.status >= 200 && request.status < 300);
    request.onerror = () => resolve(false);
    request.send(file);
  });
}

/** What the Studio accepts in a file picker: pictures, and scene files for a template's background. */
export const PICTURE_ACCEPT = 'image/jpeg,image/png,image/webp,image/avif,image/svg+xml,image/x-icon,.ico';
export const SCENE_ACCEPT = '.glb,model/gltf-binary,.mp4,video/mp4,.json,application/json';

/** Scene files by name, for the browsers that give a GLB (or anything) no type. The server checks the bytes anyway. */
const BY_EXTENSION: Record<string, string> = { glb: 'model/gltf-binary', mp4: 'video/mp4', json: 'application/json' };

/** The type to ask a slot for: the browser's, unless it gave none worth having. */
function declaredType(file: File): string {
  if (file.type && file.type !== 'application/octet-stream') return file.type;
  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  return BY_EXTENSION[extension] ?? file.type;
}

/** The poster frame's text when the browser cannot take one: what the server says about a video without one. */
const NO_POSTER = 'A video needs a still frame to show before it plays; this browser could not take one from it';

export async function uploadMedia(
  file: File,
  target: UploadTarget,
  options: UploadOptions = {},
): Promise<ActionResult<{ assetId: string; deduplicated: boolean }>> {
  const shared = 'shared' in target;
  const mime = declaredType(file);
  const slotFor = (name: string, type: string, bytes: number) => {
    const request = { fileName: name, mime: type, bytes };
    return shared ? requestSharedUpload(request) : requestUpload({ ...request, restaurantId: target.restaurantId });
  };

  // A video brings its poster frame, taken here before anything is sent.
  let poster: { uploadKey: string } | null = null;
  if (mime === 'video/mp4') {
    const frame = await posterFrame(file);
    if (!frame) return { ok: false, error: { code: 'INVALID', message: NO_POSTER, fields: { file: 'POSTER' } } };
    const posterSlot = await slotFor('poster', frame.type, frame.size);
    if (!posterSlot.ok) return posterSlot;
    if (!(await send(posterSlot.data.url, posterSlot.data.headers, frame))) return failed('The file could not be sent. Check the connection and try again.');
    poster = { uploadKey: posterSlot.data.uploadKey };
  }

  const slot = await slotFor(file.name, mime, file.size);
  if (!slot.ok) return slot;

  const sent = await send(slot.data.url, slot.data.headers, file, options.onProgress);
  if (!sent) return failed('The file could not be sent. Check the connection and try again.');
  options.onProgress?.(1);

  const response = await fetch(shared ? '/api/studio/media/finalize-shared' : '/api/studio/media/finalize', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      ...(shared ? {} : { restaurantId: target.restaurantId }),
      uploadKey: slot.data.uploadKey,
      ...(poster ? { posterKey: poster.uploadKey } : {}),
      alt: options.alt ?? {},
      folder: options.folder ?? '',
    }),
  });
  const body = (await response.json().catch(() => null)) as
    | { data: { assetId: string; deduplicated: boolean } }
    | { error: StudioFailure }
    | null;
  if (body && 'data' in body) return { ok: true, data: body.data };
  if (body && 'error' in body) return { ok: false, error: body.error };
  return failed('The file could not be finished. Try again.');
}
