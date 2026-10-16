import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { getPrisma } from '@/server/data/prisma';
import { getActor } from '@/server/studio/auth/actor';
import { requestMeta, runAction, type ActionDef } from './action';
import { SIGN_IN_PATH, TWO_FACTOR_SETUP_PATH } from './paths';
import { runPublicAction, type PublicActionDef } from './public';
import { runQuery, runQueryForPage, type QueryDef } from './query';
import { StudioError, type ActionResult } from './result';

export { SIGN_IN_PATH, TWO_FACTOR_SETUP_PATH };

/**
 * Runs an action for the current request: its signed-in actor, its address and its browser. Each export of the
 * Studio's Server Action files is a one-line call to this (or to `invokeQuery` or `invokePublic`), and `input` arrives
 * from the browser untyped: the definition's schema is what reads it.
 */
export async function invoke<I, O>(def: ActionDef<I, O>, raw: unknown): Promise<ActionResult<O>> {
  const [actor, requestHeaders] = await Promise.all([getActor(), headers()]);
  return runAction(getPrisma(), actor, def, raw, requestMeta(requestHeaders));
}

/**
 * Runs an action for a person who is not signed in (signing in, resetting a password): no actor, but the request's
 * address, browser and headers, which the public action's rate limits and Better Auth calls read. The Server Action file
 * forwards to this for the unauthenticated flows only.
 */
export async function invokePublic<I, O>(def: PublicActionDef<I, O>, raw: unknown): Promise<ActionResult<O>> {
  const requestHeaders = await headers();
  return runPublicAction(getPrisma(), def, raw, { ...requestMeta(requestHeaders), headers: requestHeaders });
}

/** Runs a query for the current request, for read-only Server Actions that client components call (Jump to, say). */
export async function invokeQuery<I, O>(def: QueryDef<I, O>, raw: unknown): Promise<ActionResult<O>> {
  return runQuery(getPrisma(), await getActor(), def, raw);
}

/**
 * Loads a page's data. Refusals become what a page shows: sign-in, two-factor setup, or the 404 page for something
 * that does not exist, that the actor may not see, or that the address cannot name (invalid input). Anything else
 * (a conflict, an unexpected error) is thrown for the error boundary.
 */
export async function query<I, O>(def: QueryDef<I, O>, raw: unknown): Promise<O> {
  const result = await runQueryForPage(getPrisma(), await getActor(), def, raw);
  if (result.ok) return result.data;
  const { code, message, fields } = result.error;
  if (code === 'UNAUTHENTICATED') redirect(SIGN_IN_PATH);
  if (code === 'TWO_FACTOR_REQUIRED') redirect(TWO_FACTOR_SETUP_PATH);
  if (code === 'NOT_FOUND' || code === 'FORBIDDEN' || code === 'INVALID') notFound();
  throw new StudioError(code, message, fields);
}
