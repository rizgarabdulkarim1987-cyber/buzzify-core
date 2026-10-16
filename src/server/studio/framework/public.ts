import { unstable_rethrow } from 'next/navigation';
import type { z } from 'zod';
import type { Prisma, PrismaClient } from '@/generated/prisma/client';
import { checkRateLimit, type RateRule } from '@/server/studio/auth/rate-limit';
import { clampMeta, type AuditEntry, type RequestMeta } from './action';
import { describeError, expectedFailure, failure, invalidInput, UNEXPECTED_MESSAGE, type ActionResult } from './result';

/** What a public action's handler receives, besides its parsed input. There is no actor: nobody is signed in yet. */
export interface PublicContext {
  prisma: PrismaClient;
  /** The request's address (the first `x-forwarded-for` entry), capped to what the audit log keeps. Empty when unknown. */
  ip: string;
  userAgent: string;
  /** The request's headers, with its cookies: what Better Auth reads a session or a two-factor challenge from. */
  headers: Headers;
  /**
   * Writes one audit row naming `actorId` as the person it happened to, with the request's address and browser. A public
   * action has no transaction to put it in: call it once the change has been made. Never put a password, token or code
   * in `changes`.
   */
  audit(actorId: string, entry: AuditEntry): Promise<void>;
}

/** One count against a limit: `key` names the subject (`signin:email:ann@example.com`), `rule` how many attempts fit. */
export interface RateCheck {
  key: string;
  rule: RateRule;
}

/** Where the request came from, and its headers. */
export interface PublicMeta extends RequestMeta {
  headers: Headers;
}

interface PublicFields<I, O> {
  name: string;
  input: z.ZodType<I>;
  /**
   * The limits this call counts against, from its parsed input and the request. Every check is counted on every call,
   * including the ones after the first that refuses, so a flood from one address cannot hide behind a limit on another
   * subject. The key is the typed value, never something looked up: a limit that depends on whether an account exists
   * would tell a caller whether it does.
   */
  rateLimit?(input: NoInfer<I>, ctx: Pick<PublicContext, 'prisma' | 'ip' | 'headers'>): RateCheck[] | Promise<RateCheck[]>;
  run(ctx: PublicContext, input: NoInfer<I>): Promise<O>;
}

export interface PublicActionDef<I, O> {
  readonly kind: 'public';
  readonly name: string;
  readonly input: z.ZodType<I>;
  readonly rateLimit: PublicFields<I, O>['rateLimit'] | undefined;
  readonly run: (ctx: PublicContext, input: I) => Promise<O>;
}

/**
 * Defines an action for a person who is not signed in: signing in, the second step of signing in, asking for a reset and
 * using its link. Everything else in the Studio is a `defineAction`. A public action does its own checks: Zod input, its
 * declared rate limits, and whatever its handler asks of Better Auth. Like the others it is run from a Server Action
 * (`invokePublic`) and never from a page.
 */
export function definePublicAction<I, O>(spec: PublicFields<I, O>): PublicActionDef<I, O> {
  if (typeof spec.name !== 'string' || spec.name === '') throw new Error('A Studio public action needs a name');
  const label = `Studio public action ${spec.name}`;
  if (typeof (spec.input as { safeParseAsync?: unknown } | null)?.safeParseAsync !== 'function') {
    throw new Error(`${label} needs a Zod input schema`);
  }
  if (typeof spec.run !== 'function') throw new Error(`${label} needs a run function`);
  if (spec.rateLimit !== undefined && typeof spec.rateLimit !== 'function') throw new Error(`${label} needs rateLimit to be a function`);
  return Object.freeze({ kind: 'public', name: spec.name, input: spec.input, rateLimit: spec.rateLimit, run: spec.run });
}

/**
 * Runs a public action: input, then the declared limits (a refused call answers `RATE_LIMITED`, with `fields.retryAfterSec`
 * for when to try again), then the handler. A `StudioError` it throws becomes the result; anything else is logged with
 * the action's name (never its input) and answered with a generic `INVALID`. Next's own interrupts pass through.
 * `now` is a parameter so tests control the clock.
 */
export async function runPublicAction<I, O>(
  prisma: PrismaClient,
  def: PublicActionDef<I, O>,
  raw: unknown,
  meta: PublicMeta,
  now: Date = new Date(),
): Promise<ActionResult<O>> {
  try {
    if (def.kind !== 'public') throw new Error(`Studio ${def.name} is not a public action`);
    const parsed = await def.input.safeParseAsync(raw);
    if (!parsed.success) return invalidInput(parsed.error);

    const { ip, userAgent } = clampMeta(meta);
    const { headers } = meta;

    if (def.rateLimit) {
      const checks = await def.rateLimit(parsed.data, { prisma, ip, headers });
      let retryAfterSec = 0;
      for (const { key, rule } of checks) {
        const verdict = await checkRateLimit(prisma, key, rule, now);
        if (!verdict.allowed) retryAfterSec = Math.max(retryAfterSec, verdict.retryAfterSec);
      }
      if (retryAfterSec > 0) return failure('RATE_LIMITED', undefined, { retryAfterSec: String(retryAfterSec) });
    }

    const data = await def.run(
      {
        prisma,
        ip,
        userAgent,
        headers,
        audit: async (actorId, entry) => {
          await prisma.auditLog.create({
            data: {
              actorId,
              restaurantId: null,
              menuId: null,
              action: entry.action,
              entityType: entry.entityType,
              entityId: entry.entityId,
              changes: (entry.changes ?? {}) as Prisma.InputJsonValue,
              ip,
              userAgent,
            },
          });
        },
      },
      parsed.data,
    );
    return { ok: true, data };
  } catch (error) {
    unstable_rethrow(error);
    const expected = expectedFailure(error);
    if (expected) return expected;
    console.error(`[studio] Public action ${def.name} failed with ${describeError(error)}`);
    return failure('INVALID', UNEXPECTED_MESSAGE);
  }
}
