import { preview } from '@/server/pharmacy/actions/imports';
import { PH_IMPORT_MAX_BYTES } from '@/server/pharmacy/imports';
import { invokePh } from '@/server/pharmacy/invoke';
import { failure, type ActionResult } from '@/server/studio/framework/result';
import { sameOrigin } from '@/server/studio/framework/route';

/**
 * The import's upload: the file as multipart form data, through a Route Handler rather than a Server Action because a
 * Server Action's body is capped at 1 MB and a catalog file may be 5 MB. It runs `ph.imports.preview` through `invokePh`
 * (the place is the person's chosen one, never the request's) and answers the action's result as JSON. The body is read
 * up to the file limit plus room for the other fields, and refused past it without buffering the rest.
 */

export const runtime = 'nodejs';

/** The form's other fields (mapping, defaults, a reason) and multipart framing. */
const SLACK = 256 * 1024;
const MAX_BODY = PH_IMPORT_MAX_BYTES + SLACK;
const TOO_LARGE = 'Use a file of at most 5 MB';

const answer = (result: ActionResult<unknown>, status = 200) => Response.json(result, { status, headers: { 'cache-control': 'no-store' } });

async function bodyWithLimit(request: Request): Promise<Uint8Array<ArrayBuffer> | null> {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_BODY) return null;
  if (!request.body) return new Uint8Array(new ArrayBuffer(0));
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const joined = new Uint8Array(new ArrayBuffer(total));
  let at = 0;
  for (const chunk of chunks) {
    joined.set(chunk, at);
    at += chunk.byteLength;
  }
  return joined;
}

function json(text: FormDataEntryValue | null): unknown {
  if (typeof text !== 'string' || text === '') return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export async function POST(request: Request): Promise<Response> {
  if (!sameOrigin(request)) return answer(failure('FORBIDDEN', 'Cross-origin requests are refused'), 403);
  const body = await bodyWithLimit(request);
  if (body === null) return answer(failure('INVALID', TOO_LARGE, { phCode: 'FILE_TOO_LARGE' }), 413);
  let form: FormData;
  try {
    form = await new Response(body, { headers: { 'content-type': request.headers.get('content-type') ?? '' } }).formData();
  } catch {
    return answer(failure('INVALID', 'Upload a CSV or Excel (.xlsx) file', { phCode: 'FILE_TYPE' }), 400);
  }
  const file = form.get('file');
  if (!(file instanceof File)) return answer(failure('INVALID', 'Upload a CSV or Excel (.xlsx) file', { phCode: 'FILE_TYPE' }), 400);
  if (file.size > PH_IMPORT_MAX_BYTES) return answer(failure('INVALID', TOO_LARGE, { phCode: 'FILE_TOO_LARGE' }), 413);

  const reason = form.get('overrideReason');
  const result = await invokePh(preview, {
    fileName: file.name,
    fileBase64: Buffer.from(await file.arrayBuffer()).toString('base64'),
    mapping: json(form.get('mapping')),
    defaults: json(form.get('defaults')),
    overrideReason: typeof reason === 'string' && reason.trim() !== '' ? reason : undefined,
  });
  return answer(result);
}
