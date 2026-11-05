import { getPrisma } from '@/server/data/prisma';
import { parseCronEnv } from '@/server/env';
import { authorized } from '@/server/http/cron-auth';
import { createHttpRetailClient } from '@/server/retail/client';
import { retailConfig } from '@/server/retail/config';
import { runReconcile } from '@/server/retail/reconcile';

export const dynamic = 'force-dynamic';

/** At most 50 reads, one at a time, each answered in well under a second; the next hourly run picks up the rest. */
export const maxDuration = 60;

const NO_STORE = { 'cache-control': 'no-store' };

/**
 * The scheduler calls this every hour with `CRON_SECRET`: up to 50 linked shops not checked in the last day are
 * compared with what Retails has (`src/server/retail/reconcile.ts`). Without a configured secret it does nothing at
 * all; without RETAIL_URL the link is off and it answers `{ disabled: true }`.
 */
export async function GET(request: Request): Promise<Response> {
  const { secret } = parseCronEnv(process.env);
  if (!secret) return new Response('The scheduled jobs are not configured', { status: 503, headers: NO_STORE });
  if (!authorized(request.headers.get('authorization'), secret)) return new Response('Unauthorized', { status: 401, headers: NO_STORE });
  if (!retailConfig().enabled) return Response.json({ disabled: true }, { headers: NO_STORE });
  try {
    const run = await runReconcile(getPrisma(), createHttpRetailClient(), new Date());
    return Response.json(run, { headers: NO_STORE });
  } catch (error) {
    console.error(`Retail reconcile failed: ${error instanceof Error ? error.name : 'unknown error'}`);
    return Response.json({ error: 'The retail reconcile failed' }, { status: 500, headers: NO_STORE });
  }
}
