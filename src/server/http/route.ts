import type { z } from 'zod';
import { getPrisma } from '@/server/data/prisma';
import { getTenant } from '@/server/data/public-menu';
import type { TenantInfo } from '@/server/data/tenant';
import { clientIp } from './client-ip';
import { admitRequest, createRateLimiter } from './rate-limit';

const MAX_BODY_BYTES = 32 * 1024;
const limiters = new Map<string, ReturnType<typeof createRateLimiter>>();

/**
 * Reads a request body up to `limit` bytes. Returns null as soon as the declared length or the bytes read
 * exceed the limit, so an oversized body is never buffered in full.
 */
export async function readBodyWithLimit(request: Request, limit: number): Promise<string | null> {
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

/**
 * The tenant a public API call is for, once the call is under the per-address limit; otherwise the answer to send (an
 * unknown restaurant, or too many requests).
 */
async function admitTenant(
  request: Request,
  ctx: { params: Promise<{ tenant: string }> },
  options: { route: string; limit: number; windowMs?: number },
): Promise<{ tenant: TenantInfo } | { refusal: Response }> {
  const { tenant: slug } = await ctx.params;
  const tenant = await getTenant(slug);
  if (!tenant) return { refusal: problem(404, 'TENANT_NOT_FOUND', 'Unknown restaurant') };

  const ip = clientIp(request.headers) || 'unknown';
  const rule = { limit: options.limit, windowMs: options.windowMs ?? 60_000 };
  const verdict = await admitRequest(
    getPrisma(),
    limiterFor(options.route, rule.limit, rule.windowMs),
    `${options.route}:${tenant.id}:${ip}`,
    rule,
    new Date(),
  );
  if (!verdict.allowed) {
    return {
      refusal: problem(429, 'RATE_LIMITED', 'Too many requests', { 'Retry-After': String(Math.ceil(verdict.retryAfterMs / 1000)) }),
    };
  }
  return { tenant };
}

export async function handleTenantRequest<S extends z.ZodType>(
  request: Request,
  ctx: { params: Promise<{ tenant: string }> },
  options: { schema: S; route: string; limit: number; windowMs?: number },
  handler: (args: { tenant: TenantInfo; input: z.infer<S>; now: Date }) => Promise<Response>,
): Promise<Response> {
  const admitted = await admitTenant(request, ctx, options);
  if ('refusal' in admitted) return admitted.refusal;
  const { tenant } = admitted;

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

/**
 * A GET to a tenant's public API: the same lookup and the shared per-address limit as `handleTenantRequest`, with no body.
 */
export async function handleTenantGet(
  request: Request,
  ctx: { params: Promise<{ tenant: string }> },
  options: { route: string; limit: number; windowMs?: number },
  handler: (args: { tenant: TenantInfo; now: Date }) => Promise<Response>,
): Promise<Response> {
  const admitted = await admitTenant(request, ctx, options);
  if ('refusal' in admitted) return admitted.refusal;
  return handler({ tenant: admitted.tenant, now: new Date() });
}
