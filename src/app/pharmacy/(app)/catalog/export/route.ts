import { invokePhQuery } from '@/server/pharmacy/invoke';
import { products } from '@/server/pharmacy/queries/exports';

/**
 * The catalog as a file: a link the browser downloads (`?format=csv|xlsx&active=active|archived|all`), never base64 in
 * a page. It runs `ph.exports.products` through `invokePhQuery` (the person's chosen place; open while read-only) and
 * answers the file's bytes with a download name, or the refusal as text with its status.
 */

export const runtime = 'nodejs';

const STATUS: Record<string, number> = { UNAUTHENTICATED: 401, FORBIDDEN: 403, NOT_FOUND: 404, INVALID: 400, CONFLICT: 409 };

export async function GET(request: Request): Promise<Response> {
  const search = new URL(request.url).searchParams;
  const result = await invokePhQuery(products, { format: search.get('format') ?? 'csv', active: search.get('active') ?? 'active' });
  if (!result.ok) {
    return new Response(result.error.message, {
      status: STATUS[result.error.code] ?? 400,
      headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
    });
  }
  const { fileName, contentType, base64 } = result.data;
  const ascii = fileName.replace(/[^\x20-\x7e]|["\\]/g, '_');
  return new Response(Buffer.from(base64, 'base64'), {
    headers: {
      'content-type': contentType,
      'content-disposition': `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      'cache-control': 'no-store',
    },
  });
}
