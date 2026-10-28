import { readBytes } from '@/server/ai/supply-upload';
import { INTAKE_LIMITS } from '@/server/domain/pharmacy/intake';
import { StudioError } from '@/server/studio/framework/result';

/**
 * Reads the multipart upload of one invoice file into the input of `ph.intake.file.add`. The body is cut off at the file cap
 * plus 1 MB for the form's own overhead BEFORE it is parsed, so an oversized upload is never held in memory. The file's
 * type is only what the browser said: the service checks the bytes.
 */

export const INTAKE_BODY_MAX_BYTES = INTAKE_LIMITS.maxBytes + 1024 * 1024;

const FIELDS = ['restaurantId', 'branchId', 'batchId', 'clientKey'] as const;

const tooLarge = () => new StudioError('INVALID', 'The file is larger than 8 MB', { file: 'The file is larger than 8 MB', phCode: 'TOO_LARGE' });

export async function readIntakeUpload(request: Request): Promise<unknown> {
  const type = request.headers.get('content-type') ?? '';
  if (!type.toLowerCase().startsWith('multipart/form-data')) throw new StudioError('INVALID', 'The upload must be a form');
  const bytes = await readBytes(request, INTAKE_BODY_MAX_BYTES);
  if (bytes === null) throw tooLarge();
  let form: FormData;
  try {
    form = await new Response(Buffer.from(bytes), { headers: { 'content-type': type } }).formData();
  } catch {
    throw new StudioError('INVALID', 'The upload could not be read');
  }
  const file = form.get('file');
  if (!(file instanceof File) || file.size === 0) throw new StudioError('INVALID', 'Choose a file');
  if (file.size > INTAKE_LIMITS.maxBytes) throw tooLarge();
  const fields: Record<string, string> = {};
  for (const name of FIELDS) {
    const value = form.get(name);
    if (typeof value === 'string' && value !== '') fields[name] = value;
  }
  return { ...fields, mediaType: file.type, base64: Buffer.from(await file.arrayBuffer()).toString('base64') };
}
