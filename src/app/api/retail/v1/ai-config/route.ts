import { readAnthropicConfig } from '@/server/ai/settings';
import { getPrisma } from '@/server/data/prisma';
import { admitRetailCall, retailJson, retailRefusal } from '@/server/retail/inbound';

export const dynamic = 'force-dynamic';

/**
 * `GET /api/retail/v1/ai-config`, signed by Buzzify Retail: the Anthropic key and model its intake uses,
 * `{ apiKey: string | null, model: string | null }` (`apiKey: null` is Retails' definitive "no key"). The key leaves the
 * Studio only here, in this answer: it is never logged, and a failure answers a code only (503, which Retails treats
 * as "try again later" and keeps its last key).
 */
export async function GET(request: Request): Promise<Response> {
  const prisma = getPrisma();
  try {
    const admitted = await admitRetailCall(prisma, request, new Date());
    if (!admitted.ok) return admitted.response;
    const { apiKey, model } = await readAnthropicConfig(prisma);
    return retailJson({ apiKey, model });
  } catch (error) {
    // The error's name only: a message could carry anything, the key included.
    console.error(`[retail.ai-config] ${error instanceof Error ? error.name : 'unknown error'}`);
    return retailRefusal(503, 'UNAVAILABLE');
  }
}
