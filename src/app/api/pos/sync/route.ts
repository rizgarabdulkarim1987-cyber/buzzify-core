import { unstable_rethrow } from 'next/navigation';
import { syncRequestSchema } from '@/lib/pos-sync/op-schema';
import { getPrisma } from '@/server/data/prisma';
import { readBodyWithLimit } from '@/server/http/route';
import { applyOperations } from '@/server/pos/sync';
import { actorFromHeaders } from '@/server/studio/auth/actor';
import { requestMeta } from '@/server/studio/framework/action';
import { sameOrigin } from '@/server/studio/framework/route';

/**
 * A till device replays what it queued offline: one to 25 operations, applied in order through the till's own actions.
 * A Route Handler rather than a Server Action: action ids change with every build, and a device holding an old page must
 * still be able to send what it has taken.
 */

const MAX_BODY_BYTES = 256 * 1024;
const NO_STORE = { 'cache-control': 'no-store' };

const refuse = (status: number, code: string) => Response.json({ error: { code } }, { status, headers: NO_STORE });

export async function POST(request: Request): Promise<Response> {
  if (!sameOrigin(request)) return refuse(403, 'FORBIDDEN');
  if (request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !== 'application/json') return refuse(415, 'INVALID');
  try {
    const prisma = getPrisma();
    const actor = await actorFromHeaders(prisma, request.headers);
    if (!actor) return refuse(401, 'UNAUTHENTICATED');
    const text = await readBodyWithLimit(request, MAX_BODY_BYTES);
    if (text === null) return refuse(413, 'INVALID');
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return refuse(400, 'INVALID');
    }
    const parsed = syncRequestSchema.safeParse(body);
    if (!parsed.success) return refuse(400, 'INVALID');
    const answers = await applyOperations({ prisma, actor, meta: requestMeta(request.headers) }, parsed.data.deviceId, parsed.data.operations);
    if (answers === null) return refuse(403, 'FORBIDDEN');
    return Response.json({ serverTime: new Date().toISOString(), answers }, { headers: NO_STORE });
  } catch (error) {
    unstable_rethrow(error);
    console.error(`[pos] The sync route failed with ${error instanceof Error ? error.name : 'an unknown error'}`);
    return refuse(500, 'INVALID');
  }
}
