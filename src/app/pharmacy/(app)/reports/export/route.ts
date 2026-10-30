import { currentPhPlaceInput, getPhAccess } from '@/server/pharmacy/actor';
import { failure, type StudioFailure } from '@/server/studio/framework/result';
import { invokeQuery } from '@/server/studio/framework/invoke';
import { report as reportExport } from '@/server/pharmacy/queries/exports';

/**
 * A report (or the chain dashboard) as a file: `GET ?report=&format=csv|xlsx&from=&to=&groupBy=&currency=&status=&branch=` with the
 * SAME filters as the screen (`exportParams`). It runs `ph.exports.report` for the person's chosen place; a `branch` narrows the
 * file to that branch when it is one of theirs (the place's own branch does not narrow it, like the screens). The answer is the file's bytes with the
 * name the server chose, or a JSON `{ error }` the button says in words. Open while the pharmacy is read-only (the query allows it).
 */

export const runtime = 'nodejs';

const STATUS: Record<string, number> = { UNAUTHENTICATED: 401, FORBIDDEN: 403, NOT_FOUND: 404, INVALID: 400, CONFLICT: 409 };
const FIELDS = ['report', 'format', 'from', 'to', 'groupBy', 'currency', 'status'] as const;

const refuse = (error: StudioFailure) => Response.json({ error }, { status: STATUS[error.code] ?? 400, headers: { 'cache-control': 'no-store' } });

export async function GET(request: Request): Promise<Response> {
  const search = new URL(request.url).searchParams;
  const [{ actor, gate, place }, placeInput] = await Promise.all([getPhAccess(), currentPhPlaceInput()]);
  if (!actor || !gate || !place || !placeInput) return refuse(failure('FORBIDDEN').error);
  const branch = search.get('branch');
  // Like the screens: the filter is the branch, and it must be one of the person's. The place's own branch does not narrow a report.
  if (branch && !actor.branchIds.includes(branch)) return refuse(failure('FORBIDDEN').error);
  const input: Record<string, string> = { restaurantId: placeInput.restaurantId };
  if (branch && search.get('report') !== 'chain') input.branchId = branch;
  for (const name of FIELDS) {
    const value = search.get(name);
    if (value) input[name] = value;
  }
  const result = await invokeQuery(reportExport, input, { phAccess: { actor, gate } });
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
