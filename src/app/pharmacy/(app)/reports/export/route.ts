import { exportReport } from '@/app/pharmacy/_actions/reports';
import { failure, type StudioFailure } from '@/server/studio/framework/result';

/**
 * A report (or the chain dashboard) as a file: `GET ?report=&format=csv|xlsx&from=&to=&groupBy=&currency=&status=&branch=` with the
 * SAME filters as the screen (`exportParams`). It runs `ph.exports.report` through the report wrapper (`invokePhReport`: the business is the
 * person's chosen place, the person and pharmacy are resolved once for the request); a `branch` narrows the file to that branch when it is one of theirs
 * (the place's own branch does not narrow it, like the screens, R6-15). A file made for a page of another site is refused (it writes an audit row). The answer is the file's bytes with the
 * name the server chose, or a JSON `{ error }` the button says in words. Open while the pharmacy is read-only (the query allows it).
 */

export const runtime = 'nodejs';

const STATUS: Record<string, number> = { UNAUTHENTICATED: 401, FORBIDDEN: 403, NOT_FOUND: 404, INVALID: 400, CONFLICT: 409 };
const FIELDS = ['report', 'format', 'from', 'to', 'groupBy', 'currency', 'status'] as const;

const refuse = (error: StudioFailure) => Response.json({ error }, { status: STATUS[error.code] ?? 400, headers: { 'cache-control': 'no-store' } });

export async function GET(request: Request): Promise<Response> {
  const search = new URL(request.url).searchParams;
  // The file is made by a click on this site's own screens. A request another site started (it carries our cookie) makes no file and no audit row.
  if (request.headers.get('sec-fetch-site') === 'cross-site') return refuse(failure('FORBIDDEN').error);
  const branch = search.get('branch');
  // Like the screens: the filter is the branch (the report refuses one that is not the person's). The place's own branch does not narrow a report.
  const input: Record<string, string> = {};
  if (branch && search.get('report') !== 'chain') input.branchId = branch;
  for (const name of FIELDS) {
    const value = search.get(name);
    if (value) input[name] = value;
  }
  const result = await exportReport(input);
  if (!result.ok) return refuse(result.error);
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
