import { StudioError } from '@/server/studio/framework/result';
import { SUPPLY_FILE_MAX_BYTES, SUPPLY_MEDIA_TYPES } from './supply-limits';
import { readBytes, SUPPLY_BODY_MAX_BYTES } from './supply-upload';

/**
 * Reads the multipart upload of the AI menu import into the reading's input: a photo or a PDF as `file`, or a link as `url`.
 * The body is cut off before it is parsed, like the supply entry's, so an oversized upload is never held in memory.
 */
export async function readMenuImportUpload(request: Request): Promise<unknown> {
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
  const url = form.get('url');
  if (typeof url === 'string' && url.trim() !== '') return { kind: 'link', url: url.slice(0, 2_001) };
  throw new StudioError('INVALID', 'Choose a file or paste a link');
}
