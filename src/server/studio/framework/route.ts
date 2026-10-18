import { unstable_rethrow } from 'next/navigation';
import { getPrisma } from '@/server/data/prisma';
import { readBodyWithLimit } from '@/server/http/route';
import { actorFromHeaders } from '@/server/studio/auth/actor';
import { requestMeta, runAction, type ActionDef } from './action';
import { runQuery, type QueryDef } from './query';
import { describeError, expectedFailure, failure, UNEXPECTED_MESSAGE, type ActionResult, type ErrorCode } from './result';

const STATUS: Record<ErrorCode, number> = {
  UNAUTHENTICATED: 401,
  TWO_FACTOR_REQUIRED: 403,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  INVALID: 400,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  // Allowed for the person but not on this restaurant's plan: a refusal, like a permission, not a missing payment.
  UPGRADE_REQUIRED: 403,
};

/** The same limit Next puts on a Server Action's body. */
const MAX_BODY_BYTES = 1024 * 1024;

export type RouteParams = Record<string, string | string[] | undefined>;

export interface StudioRouteOptions {
  /** The one method the handler answers. A route that runs an action must be POST. */
  method: 'GET' | 'POST';
  /**
   * Builds the definition's raw input. By default: the query string for GET (a repeated key becomes a list) or the JSON
   * object in the body for POST, with the route's parameters on top.
   */
  parse?: (request: Request, params: RouteParams) => unknown;
}

/** A failure answered before the definition runs: a body that cannot be read. */
class RequestError extends Error {}

function respond(result: ActionResult<unknown>, status?: number, extra?: Record<string, string>): Response {
  const headers = { 'cache-control': 'no-store', ...extra };
  if (result.ok) return Response.json({ data: result.data }, { status: 200, headers });
  return Response.json({ error: result.error }, { status: status ?? STATUS[result.error.code], headers });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Whether a POST comes from the Studio's own pages. Browsers send `Origin` with every cross-origin POST, and it must
 * name the host the request was made to (as Next checks for Server Actions). A request without one is served only when
 * its body is JSON: a cross-site form can post text or form data without an `Origin` in some browsers and after some
 * redirects, but it cannot send `application/json` without a preflight the Studio never answers.
 */
function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (origin === null) {
    const type = request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
    return type === 'application/json';
  }
  if (!URL.canParse(origin)) return false;
  const host =
    request.headers.get('x-forwarded-host')?.split(',')[0]?.trim() || request.headers.get('host') || new URL(request.url).host;
  return new URL(origin).host === host;
}

async function defaultInput(request: Request, method: 'GET' | 'POST', params: RouteParams): Promise<unknown> {
  if (method === 'GET') {
    const search = new URL(request.url).searchParams;
    const query: Record<string, string | string[]> = {};
    for (const key of new Set(search.keys())) {
      const values = search.getAll(key);
      query[key] = values.length === 1 ? (values[0] as string) : values;
    }
    return { ...query, ...params };
  }
  const text = await readBodyWithLimit(request, MAX_BODY_BYTES);
  if (text === null) throw new RequestError('The request body is too large');
  if (text.trim() === '') return { ...params };
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new RequestError('The request body must be JSON');
  }
  if (!isRecord(body)) throw new RequestError('The request body must be a JSON object');
  return { ...body, ...params };
}

/**
 * A Studio route handler (`src/app/api/studio/**\/route.ts`): `export const GET = studioRoute(def, { method: 'GET' })`.
 * It reads the actor from the request's session cookie, runs the definition through `runQuery` or `runAction` (so the
 * checks, the transaction and the audit are the framework's), and answers `{ data }` or `{ error }` as JSON with the
 * error's status, never cached.
 */
export function studioRoute<I, O>(
  def: ActionDef<I, O> | QueryDef<I, O>,
  options: StudioRouteOptions,
): (request: Request, context: { params: Promise<unknown> }) => Promise<Response> {
  if (def.kind === 'action' && options.method !== 'POST') {
    throw new Error(`Studio ${def.name} changes data, so its route must be POST`);
  }
  return async function handle(request, context) {
    if (request.method !== options.method) {
      return respond(failure('INVALID', 'Method not allowed'), 405, { allow: options.method });
    }
    if (options.method === 'POST' && !sameOrigin(request)) {
      return respond(failure('FORBIDDEN', 'Cross-origin requests are refused'));
    }
    try {
      const prisma = getPrisma();
      const actor = await actorFromHeaders(prisma, request.headers);
      // Nothing is read from a request without a session; the definition refuses it the same way.
      if (!actor) return respond(failure('UNAUTHENTICATED'));
      const resolved: unknown = await context?.params;
      const params = (isRecord(resolved) ? resolved : {}) as RouteParams;
      const raw = options.parse ? await options.parse(request, params) : await defaultInput(request, options.method, params);
      const result =
        def.kind === 'action'
          ? await runAction(prisma, actor, def, raw, requestMeta(request.headers))
          : await runQuery(prisma, actor, def, raw);
      return respond(result);
    } catch (error) {
      unstable_rethrow(error);
      if (error instanceof RequestError) return respond(failure('INVALID', error.message));
      const expected = expectedFailure(error);
      if (expected) return respond(expected);
      console.error(`[studio] Route for ${def.name} failed with ${describeError(error)}`);
      return respond(failure('INVALID', UNEXPECTED_MESSAGE));
    }
  };
}
