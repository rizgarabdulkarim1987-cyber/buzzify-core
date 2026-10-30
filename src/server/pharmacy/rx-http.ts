import { readBytes } from '@/server/ai/supply-upload';
import { getPrisma } from '@/server/data/prisma';
import { sameOrigin } from '@/server/studio/framework/route';
import { actorFromHeaders } from '@/server/studio/auth/actor';
import { runQuery } from '@/server/studio/framework/query';
import { failure, StudioError, type ErrorCode } from '@/server/studio/framework/result';
import { attachmentRead } from './queries/prescriptions';
import { RX_FILE_MAX_BYTES } from './prescriptions';

/**
 * The two HTTP edges of prescription files (phase 7, R7-3): reading an uploaded form into the input of `ph.rx.file.add`, and
 * streaming one stored file to a person who may see it. Neither decides anything: the definitions do (`rx.dispense`,
 * `rx.attachment.view`, the business and the branch), so the route only carries the request to them.
 */

/** The multipart body is cut off at the file cap plus 1 MB for the form's own overhead BEFORE it is parsed. */
export const RX_BODY_MAX_BYTES = RX_FILE_MAX_BYTES + 1024 * 1024;
const FIELDS = ['restaurantId', 'branchId', 'prescriptionId'] as const;
const tooLarge = () => new StudioError('INVALID', 'The file is larger than 5 MB', { file: 'The file is larger than 5 MB', phCode: 'TOO_LARGE' });

export async function readRxUpload(request: Request): Promise<unknown> {
  const type = request.headers.get('content-type') ?? '';
  if (!type.toLowerCase().startsWith('multipart/form-data')) throw new StudioError('INVALID', 'The upload must be a form');
  const bytes = await readBytes(request, RX_BODY_MAX_BYTES);
  if (bytes === null) throw tooLarge();
  let form: FormData;
  try {
    form = await new Response(Buffer.from(bytes), { headers: { 'content-type': type } }).formData();
  } catch {
    throw new StudioError('INVALID', 'The upload could not be read');
  }
  const file = form.get('file');
  if (!(file instanceof File) || file.size === 0) throw new StudioError('INVALID', 'Choose a file');
  if (file.size > RX_FILE_MAX_BYTES) throw tooLarge();
  const fields: Record<string, string> = {};
  for (const name of FIELDS) {
    const value = form.get(name);
    if (typeof value === 'string' && value !== '') fields[name] = value;
  }
  return { ...fields, base64: Buffer.from(await file.arrayBuffer()).toString('base64') };
}

const STATUS: Record<ErrorCode, number> = {
  UNAUTHENTICATED: 401,
  TWO_FACTOR_REQUIRED: 403,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  INVALID: 400,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  UPGRADE_REQUIRED: 403,
};

const PRIVATE = {
  'cache-control': 'private, no-store',
  'x-content-type-options': 'nosniff',
  // Contain any active content in a PDF: nothing loads, nothing runs, no same-origin access.
  'content-security-policy': "default-src 'none'; sandbox",
} as const;

function refuse(code: ErrorCode, message?: string): Response {
  const result = failure(code, message);
  return Response.json({ error: result.error }, { status: STATUS[code], headers: PRIVATE });
}

/**
 * Whether a read comes from the pharmacy's own pages. A browser marks a cross-site request (`Sec-Fetch-Site`) and sends `Origin`
 * with every cross-origin one; either one that names another site is refused. A request with neither (a script, a test) is
 * judged by the session alone.
 */
export function isSameSiteRead(request: Request): boolean {
  const site = request.headers.get('sec-fetch-site');
  if (site !== null && site !== 'same-origin' && site !== 'none') return false;
  const origin = request.headers.get('origin');
  return origin === null || sameOrigin(request);
}

/**
 * Streams one prescription file: `GET /api/pharmacy/rx-attachments/<id>?restaurantId=<business>[&branchId=<branch>]`. The session is
 * read from the request, `ph.rx.attachment.read` is run for that person (so `rx.attachment.view` is checked on EVERY read, a support
 * actor is refused, the business and the branch confine the file, and the read is audited by count), and the bytes are answered
 * with `Cache-Control: private, no-store`. Every failure is a JSON error with no file detail.
 */
export async function serveRxAttachment(request: Request, id: string): Promise<Response> {
  if (!isSameSiteRead(request)) return refuse('FORBIDDEN', 'Cross-origin requests are refused');
  const prisma = getPrisma();
  const actor = await actorFromHeaders(prisma, request.headers);
  if (!actor) return refuse('UNAUTHENTICATED');
  const search = new URL(request.url).searchParams;
  const restaurantId = search.get('restaurantId');
  const branchId = search.get('branchId');
  if (!restaurantId) return refuse('INVALID', 'Choose the pharmacy');
  const result = await runQuery(prisma, actor, attachmentRead, { restaurantId, ...(branchId ? { branchId } : {}), id });
  if (!result.ok) return refuse(result.error.code);
  const bytes = Buffer.from(result.data.base64, 'base64');
  return new Response(bytes, {
    status: 200,
    headers: {
      ...PRIVATE,
      'content-type': result.data.mime,
      'content-length': String(bytes.length),
      'content-disposition': 'inline; filename="prescription"',
    },
  });
}
