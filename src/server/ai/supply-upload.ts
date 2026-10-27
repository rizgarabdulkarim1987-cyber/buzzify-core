import { StudioError } from '@/server/studio/framework/result';
import { SUPPLY_FILE_MAX_BYTES, SUPPLY_MEDIA_TYPES, SUPPLY_TEXT_MAX_CHARS } from './supply';

/**
 * Reads the multipart upload of the supply-entry page into the action's input. The body is cut off at 6 MB before it is
 * parsed (a bit over the 5 MB file cap, for the form's own overhead), so an oversized upload is never held in memory.
 */

export const SUPPLY_BODY_MAX_BYTES = SUPPLY_FILE_MAX_BYTES + 1024 * 1024;

export async function readBytes(request: Request, limit: number): Promise<Uint8Array | null> {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > limit) return null;
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

export async function readSupplyUpload(request: Request): Promise<unknown> {
  const type = request.headers.get('content-type') ?? '';
  if (!type.toLowerCase().startsWith('multipart/form-data')) throw new StudioError('INVALID', 'The upload must be a form');
  const bytes = await readBytes(request, SUPPLY_BODY_MAX_BYTES);
  if (bytes === null) throw new StudioError('INVALID', 'tooLarge');
  let form: FormData;
  try {
    form = await new Response(Buffer.from(bytes), { headers: { 'content-type': type } }).formData();
  } catch {
    throw new StudioError('INVALID', 'The upload could not be read');
  }
  const file = form.get('file');
  if (file instanceof File && file.size > 0) {
    if (file.size > SUPPLY_FILE_MAX_BYTES) throw new StudioError('INVALID', 'tooLarge');
    const mediaType = SUPPLY_MEDIA_TYPES.find((m) => m === file.type);
    if (!mediaType) throw new StudioError('INVALID', 'The file must be a PDF, JPEG, PNG or WebP');
    return { kind: 'file', mediaType, base64: Buffer.from(await file.arrayBuffer()).toString('base64') };
  }
  const text = form.get('text');
  if (typeof text === 'string' && text.trim() !== '') return { kind: 'text', text: text.slice(0, SUPPLY_TEXT_MAX_CHARS + 1) };
  throw new StudioError('INVALID', 'Choose a file or paste the invoice text');
}
