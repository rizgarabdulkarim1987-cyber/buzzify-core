import { requestSharedUpload, requestUpload } from '@/app/studio/_actions/media';
import type { Locale } from '@/lib/locale';
import type { ActionResult, StudioFailure } from '@/server/studio/framework/result';

/**
 * Uploads a file to a media library from the browser (spec 11): asks for a signed slot, sends the file straight to
 * storage (R2, or the development folder) so it never passes through a function, then asks the server to check it and
 * make its variants. Progress covers the sending, which is most of the wait.
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
function send(url: string, headers: Record<string, string>, file: File, onProgress?: (fraction: number) => void): Promise<boolean> {
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

export async function uploadMedia(
  file: File,
  target: UploadTarget,
  options: UploadOptions = {},
): Promise<ActionResult<{ assetId: string; deduplicated: boolean }>> {
  const shared = 'shared' in target;
  const request = { fileName: file.name, mime: file.type, bytes: file.size };
  const slot = shared ? await requestSharedUpload(request) : await requestUpload({ ...request, restaurantId: target.restaurantId });
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
