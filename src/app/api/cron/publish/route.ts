import { getPrisma } from '@/server/data/prisma';
import { parseCronEnv } from '@/server/env';
import { authorized } from '@/server/http/cron-auth';
import { prunePublicRateLimits, pruneWheelSpins } from '@/server/http/rate-limit';
import { activateDueRevisions } from '@/server/publish/revisions';

/** One run makes up to 100 revisions live; a minute is plenty, and the next run picks up the rest. */
export const maxDuration = 60;

const NO_STORE = { 'cache-control': 'no-store' };

/**
 * Scheduled publishing (spec 10.6): the platform's scheduler calls this every minute with `CRON_SECRET`, and every
 * revision whose time has come goes live. Without a configured secret it does nothing at all.
 */
export async function GET(request: Request) {
  // Read on each call (it is one variable): a secret set or rotated in the platform applies to the next run.
  const { secret } = parseCronEnv(process.env);
  if (!secret) return new Response('Scheduled publishing is not configured', { status: 503, headers: NO_STORE });
  if (!authorized(request.headers.get('authorization'), secret)) return new Response('Unauthorized', { status: 401, headers: NO_STORE });
  const now = new Date();
  const result = await activateDueRevisions(getPrisma(), now);
  // Housekeeping on the same clock: the public API's rate counts whose window is a day old count nothing any more.
  await prunePublicRateLimits(getPrisma(), new Date(now.getTime() - 86_400_000));
  await pruneWheelSpins(getPrisma(), new Date(now.getTime() - 3 * 86_400_000));
  return Response.json(result, { headers: NO_STORE });
}
