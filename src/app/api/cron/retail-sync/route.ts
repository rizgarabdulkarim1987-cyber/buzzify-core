import { getPrisma } from '@/server/data/prisma';
import { parseCronEnv } from '@/server/env';
import { authorized } from '@/server/http/cron-auth';
import { createHttpRetailClient } from '@/server/retail/client';
import { retailConfig } from '@/server/retail/config';
import { runSender } from '@/server/retail/sender';

export const dynamic = 'force-dynamic';

/** At most 40 deliveries, four at a time, each with a 5 s timeout: inside a minute even when Retails is slow. */
export const maxDuration = 60;

const NO_STORE = { 'cache-control': 'no-store' };

/**
 * The scheduler calls this every minute with `CRON_SECRET`: what is queued for Buzzify Retail is delivered, with
 * retries and backoff (`src/server/retail/sender.ts`). Without a configured secret it does nothing at all; without
 * RETAIL_URL the link is off and it answers `{ disabled: true }`.
 */
export async function GET(request: Request): Promise<Response> {
  const { secret } = parseCronEnv(process.env);
  if (!secret) return new Response('The scheduled jobs are not configured', { status: 503, headers: NO_STORE });
  if (!authorized(request.headers.get('authorization'), secret)) return new Response('Unauthorized', { status: 401, headers: NO_STORE });
  if (!retailConfig().enabled) return Response.json({ disabled: true }, { headers: NO_STORE });
  try {
    const run = await runSender(getPrisma(), createHttpRetailClient(), new Date());
    return Response.json(run, { headers: NO_STORE });
  } catch (error) {
    // A run that cannot even claim its rows is a failed run: a non-2xx the scheduler can see. The error's name only.
    console.error(`Retail sync failed: ${error instanceof Error ? error.name : 'unknown error'}`);
    return Response.json({ error: 'The retail sync failed' }, { status: 500, headers: NO_STORE });
  }
}
