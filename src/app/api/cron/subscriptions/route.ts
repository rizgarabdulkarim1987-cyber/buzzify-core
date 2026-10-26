import { getPrisma } from '@/server/data/prisma';
import { parseCronEnv } from '@/server/env';
import { authorized } from '@/server/http/cron-auth';
import { sweepSubscriptions } from '@/server/studio/services/billing-sweep';

export const dynamic = 'force-dynamic';

/** The sweep is one short transaction per due subscription; a minute is plenty, and the next run picks up the rest. */
export const maxDuration = 60;

const NO_STORE = { 'cache-control': 'no-store' };

/**
 * The scheduler calls this with `CRON_SECRET`: subscriptions whose date has passed move to GRACE or EXPIRED.
 * Without a configured secret it does nothing at all.
 */
export async function GET(request: Request): Promise<Response> {
  // Read on each call: a secret set or rotated in the platform applies to the next run.
  const { secret } = parseCronEnv(process.env);
  if (!secret) return new Response('The scheduled jobs are not configured', { status: 503, headers: NO_STORE });
  if (!authorized(request.headers.get('authorization'), secret)) return new Response('Unauthorized', { status: 401, headers: NO_STORE });
  try {
    const sweep = await sweepSubscriptions(getPrisma(), new Date());
    // Some rows failing is not a failed run (the next one looks again), but it is logged once so it can be alerted on.
    if (sweep.failed > 0) console.error(`Subscription sweep: ${sweep.failed} subscription(s) failed, ${sweep.graced} graced, ${sweep.expired} expired`);
    return Response.json(sweep, { headers: NO_STORE });
  } catch (error) {
    // A sweep that cannot even read its candidates is a failed run: say so with a non-2xx the scheduler can see.
    console.error(`Subscription sweep failed: ${error instanceof Error ? error.name : 'unknown error'}`);
    return Response.json({ error: 'The subscription sweep failed' }, { status: 500, headers: NO_STORE });
  }
}
