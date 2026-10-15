import type { z } from 'zod';
import { getTenant, type TenantInfo } from '@/server/data/tenant';
import { createRateLimiter } from './rate-limit';

const MAX_BODY_BYTES = 32 * 1024;
const limiters = new Map<string, ReturnType<typeof createRateLimiter>>();

/**
 * Reads a request body up to `limit` bytes. Returns null as soon as the declared length or the bytes read
 * exceed the limit, so an oversized body is never buffered in full.
 */
async function readBodyWithLimit(request: Request, limit: number): Promise<string | null> {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > limit) return null;
  if (!request.body) return '';

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function limiterFor(route: string, limit: number, windowMs: number) {
  const key = `${route}:${limit}:${windowMs}`;
  let limiter = limiters.get(key);
  if (!limiter) {
    limiter = createRateLimiter({ limit, windowMs });
    limiters.set(key, limiter);
  }
  return limiter;
}

export function problem(status: number, code: string, message: string, headers?: HeadersInit): Response {
  return Response.json({ error: { code, message } }, { status, headers });
}

export async function handleTenantRequest<S extends z.ZodType>(
  request: Request,
  ctx: { params: Promise<{ tenant: string }> },
  options: { schema: S; route: string; limit: number; windowMs?: number },
  handler: (args: { tenant: TenantInfo; input: z.infer<S>; now: Date }) => Promise<Response>,
): Promise<Response> {
  const { tenant: slug } = await ctx.params;
  const tenant = await getTenant(slug);
  if (!tenant) return problem(404, 'TENANT_NOT_FOUND', 'Unknown restaurant');

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const verdict = limiterFor(options.route, options.limit, options.windowMs ?? 60_000).check(
    `${tenant.id}:${ip}`,
    Date.now(),
  );
  if (!verdict.allowed) {
    return problem(429, 'RATE_LIMITED', 'Too many requests', {
      'Retry-After': String(Math.ceil(verdict.retryAfterMs / 1000)),
    });
  }

  const text = await readBodyWithLimit(request, MAX_BODY_BYTES);
  if (text === null) return problem(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large');

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return problem(400, 'BAD_JSON', 'Request body must be valid JSON');
  }

  const parsed = options.schema.safeParse(json);
  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
    return problem(400, 'INVALID_REQUEST', message);
  }
  return handler({ tenant, input: parsed.data, now: new Date() });
}
