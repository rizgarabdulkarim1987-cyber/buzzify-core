import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { isAPIError } from 'better-auth/api';
import { z } from 'zod';
import type { PrismaClient } from '@/generated/prisma/client';
import { getPrisma } from '@/server/data/prisma';
import { loadActor } from '@/server/studio/auth/actor';
import { serverAuthFor } from '@/server/studio/auth/auth';
import { authErrorCode } from '@/server/studio/auth/errors';
import { isRecoveryCode, signInCodeField } from '@/server/studio/auth/fields';
import { MAX_PASSWORD_LENGTH } from '@/server/studio/auth/password-policy';
import { addressKey, checkRateLimit, RATE_RULES, type RateRule } from '@/server/studio/auth/rate-limit';
import { pendingTwoFactor } from '@/server/studio/auth/two-factor';
import { normalizeEmail } from '@/server/studio/auth/users';
import { retailConfig } from './config';
import { chooseBusiness, isNonce, issueHandoff, mayHandOff, ownedRetailShops } from './handoff';
import { admitRetailCall, rateLimited, retailJson, retailRefusal } from './inbound';

/**
 * Buzzify Retail's own sign-in form (its `/login`), checked here: Retails' server collects the email and password and
 * asks Studio, server to server, signed like every `/api/retail/v1/*` call (`admitRetailCall`). Identity stays in
 * Studio: the password is checked by the same Better Auth call the Studio's own sign-in makes, under the same limits,
 * and a right one ends in the same handoff token the browser handoff gives (`issueHandoff`), bound to a nonce Retails
 * made for this one call, so Retails redeems it through its usual callback code, once.
 *
 * - `POST /api/retail/v1/credentials` `{ email, password, clientIp, nonce, userAgent? }`
 * - `POST /api/retail/v1/credentials/two-factor` `{ challenge, code, clientIp, nonce, userAgent? }`
 * - `POST /api/retail/v1/credentials/choose` `{ challenge, shopId, clientIp, nonce }`
 *
 * Each answers 200 with one `status`:
 * - `ok` `{ handoffToken }`: a 60 s token for Retails' callback code;
 * - `needs_2fa` `{ challenge }`: the account has two-factor; send a six-digit code or a recovery code with it;
 * - `choose` `{ challenge, shops: [{ id, name, ready }] }`: an owner of several shops picks the one to open;
 * - `invalid`: wrong email or password, unknown or deactivated account (one answer, whichever it was);
 * - `invalid_code`: the code was wrong (the challenge still stands, up to Better Auth's five attempts);
 * - `expired`: the challenge has run out, was used, or never existed: start again;
 * - `preparing`: the owner's shop is not ready in Retails yet;
 * - `unavailable`: the person may not sign in to Retails (the handoff's own rule, `mayHandOff` and `issueHandoff`).
 * A limit answers 429 `RATE_LIMITED` with `retry-after`. 401 unsigned, 400 malformed, 503 off or misconfigured.
 *
 * `clientIp` is the browser's address as Retails saw it. It is trusted only because the call is signed, and it keys the
 * same per-address limit the Studio's sign-in uses (`signin:ip:`), beside the per-email one (`signin:email:`); both count
 * every attempt, the right password included, exactly as the Studio's sign-in does. The second step counts
 * `totp:user:` like the Studio's.
 *
 * Better Auth's session for the check is ended at once: Studio keeps no session for a sign-in made in Retails, and the
 * Studio cookie never leaves this handler (`serverAuthFor` has no Next cookie plugin). Nothing here logs; a failure logs
 * the error's name only, never the email, the password, a code, a challenge or a token.
 */

/** The browser's address as Retails saw it: an IPv4 or IPv6 address, or empty when Retails had none. */
const clientIpField = z.string().max(64).regex(/^[0-9A-Fa-f:.]*$/);
const nonceField = z.string().refine(isNonce);
const userAgentField = z.string().max(512).optional();
const challengeField = z.string().min(1).max(1024);

export const passwordInput = z.object({
  // Only a bound on size: whatever else is typed is for Better Auth to call not an account, as on the Studio's sign-in.
  email: z.string().min(1).max(254),
  password: z.string().min(1).max(1024),
  clientIp: clientIpField,
  nonce: nonceField,
  userAgent: userAgentField,
});

export const twoFactorInput = z.object({
  challenge: challengeField,
  // Checked by `signInCodeField` in the handler: a malformed code is a wrong code, not a malformed call.
  code: z.string().max(64),
  clientIp: clientIpField,
  nonce: nonceField,
  userAgent: userAgentField,
});

export const chooseInput = z.object({
  challenge: challengeField,
  shopId: z.string().min(1).max(64),
  clientIp: clientIpField,
  nonce: nonceField,
});

export type CredentialsAnswer =
  | { status: 'ok'; handoffToken: string }
  | { status: 'needs_2fa'; challenge: string }
  | { status: 'choose'; challenge: string; shops: Array<{ id: string; name: string; ready: boolean }> }
  | { status: 'invalid' | 'invalid_code' | 'expired' | 'preparing' | 'unavailable' };

type Step = CredentialsAnswer | { status: 'limited'; retryAfterSec: number };

/** How long an owner has to pick a shop after the password (and code) were right. */
export const PICK_TTL_MS = 5 * 60_000;
const TWO_FACTOR_PREFIX = 'tf.';
const PICK_PREFIX = 'pk.';
const PICK_SECRET = /^[A-Za-z0-9_-]{43}$/;

/** Counts every check (a refused one does not stop the others) and says how long the longest refusal lasts, or 0. */
async function limit(prisma: PrismaClient, checks: Array<[string, RateRule]>, now: Date): Promise<number> {
  let retryAfterSec = 0;
  for (const [key, rule] of checks) {
    const verdict = await checkRateLimit(prisma, key, rule, now);
    if (!verdict.allowed) retryAfterSec = Math.max(retryAfterSec, verdict.retryAfterSec);
  }
  return retryAfterSec;
}

/** What Better Auth is shown: the browser's address and agent as Retails saw them, and a challenge cookie when there is one. */
function authHeaders(clientIp: string, userAgent: string | undefined, cookie?: string): Headers {
  const headers = new Headers();
  if (clientIp) headers.set('x-forwarded-for', clientIp);
  if (userAgent) headers.set('user-agent', userAgent);
  if (cookie) headers.set('cookie', cookie);
  return headers;
}

async function twoFactorCookieName(prisma: PrismaClient): Promise<string> {
  return (await serverAuthFor(prisma).$context).createAuthCookie('two_factor').name;
}

/** The signed challenge value Better Auth set in its two-factor cookie, decoded; null when it set none. */
function cookieValue(setCookies: string[], name: string): string | null {
  for (const line of setCookies) {
    const [pair = ''] = line.split(';');
    const eq = pair.indexOf('=');
    if (eq > 0 && pair.slice(0, eq).trim() === name) {
      const raw = pair.slice(eq + 1).trim();
      try {
        return raw ? decodeURIComponent(raw) : null;
      } catch {
        return null;
      }
    }
  }
  return null;
}

const encodeTwoFactor = (signed: string) => `${TWO_FACTOR_PREFIX}${Buffer.from(signed, 'utf8').toString('base64url')}`;

function decodeTwoFactor(challenge: string): string | null {
  if (!challenge.startsWith(TWO_FACTOR_PREFIX)) return null;
  const body = challenge.slice(TWO_FACTOR_PREFIX.length);
  if (!/^[A-Za-z0-9_-]+$/.test(body)) return null;
  const signed = Buffer.from(body, 'base64url').toString('utf8');
  return /^[\x21-\x7e]{1,512}$/.test(signed) ? signed : null;
}

const pickIdentifier = (secret: string) => `retail-pick:${createHash('sha256').update(secret, 'utf8').digest('hex')}`;

/** A one-time pick for `userId`, valid PICK_TTL_MS. Only its hash is stored. */
async function createPick(prisma: PrismaClient, userId: string, now: Date): Promise<string> {
  const secret = randomBytes(32).toString('base64url');
  await prisma.verification.create({
    data: { id: randomUUID(), identifier: pickIdentifier(secret), value: userId, expiresAt: new Date(now.getTime() + PICK_TTL_MS) },
  });
  return `${PICK_PREFIX}${secret}`;
}

/** Spends a pick: the person it was made for, or null when it is unknown, ran out or was already spent. */
async function spendPick(prisma: PrismaClient, challenge: string, now: Date): Promise<string | null> {
  if (!challenge.startsWith(PICK_PREFIX)) return null;
  const secret = challenge.slice(PICK_PREFIX.length);
  if (!PICK_SECRET.test(secret)) return null;
  const identifier = pickIdentifier(secret);
  const row = await prisma.verification.findFirst({ where: { identifier }, select: { id: true, value: true, expiresAt: true } });
  if (!row) return null;
  // Deleted whatever happens next; only the call that deletes it may use it.
  const { count } = await prisma.verification.deleteMany({ where: { id: row.id } });
  if (count !== 1 || row.expiresAt <= now) return null;
  return row.value;
}

/** Studio keeps no session for a sign-in made in Retails. */
async function endSession(prisma: PrismaClient, token: unknown): Promise<void> {
  if (typeof token === 'string' && token !== '') await prisma.session.deleteMany({ where: { token } });
}

/** After the password (and the code): the handoff's own rules, then a token, a chooser, or why not. */
async function finish(prisma: PrismaClient, userId: string, pick: string | null, nonce: string, now: Date): Promise<CredentialsAnswer> {
  const actor = await loadActor(prisma, userId);
  if (!actor || !mayHandOff(actor)) return { status: 'unavailable' };
  const choice = await chooseBusiness(prisma, actor, pick);
  if (choice.kind === 'choose') {
    const shops = (await ownedRetailShops(prisma, userId)).map((shop) => ({ id: shop.id, name: shop.name, ready: shop.provisioned }));
    return { status: 'choose', challenge: await createPick(prisma, userId, now), shops };
  }
  if (choice.kind === 'notReady') return { status: 'preparing' };
  const token = await issueHandoff(prisma, actor, choice.kind === 'business' ? choice.restaurantId : null, nonce, now);
  return token ? { status: 'ok', handoffToken: token } : { status: 'unavailable' };
}

export async function passwordStep(prisma: PrismaClient, input: z.infer<typeof passwordInput>, now: Date): Promise<Step> {
  const email = normalizeEmail(input.email);
  const retryAfterSec = await limit(
    prisma,
    [
      [`signin:ip:${addressKey(input.clientIp)}`, RATE_RULES['signin:ip']],
      [`signin:email:${email}`, RATE_RULES['signin:email']],
    ],
    now,
  );
  if (retryAfterSec > 0) return { status: 'limited', retryAfterSec };
  // No account can have a longer one; Better Auth would refuse it with an error of its own. A wrong password like any other.
  if (input.password.length > MAX_PASSWORD_LENGTH) return { status: 'invalid' };

  const auth = serverAuthFor(prisma);
  const attempt = await auth.api
    .signInEmail({ body: { email, password: input.password }, headers: authHeaders(input.clientIp, input.userAgent), returnHeaders: true })
    .then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error }),
    );
  if (!attempt.ok) {
    const { error } = attempt;
    // 401 is a wrong password or an unknown email; 403 a deactivated account. Nobody learns which.
    if (isAPIError(error) && (error.statusCode === 401 || error.statusCode === 403)) return { status: 'invalid' };
    throw error;
  }
  const result = attempt.value;
  const response = result.response as { twoFactorRedirect?: boolean; token?: unknown; user?: { id?: unknown } };
  if (response.twoFactorRedirect) {
    const signed = cookieValue(result.headers.getSetCookie(), await twoFactorCookieName(prisma));
    if (!signed) throw new Error('two-factor challenge missing');
    return { status: 'needs_2fa', challenge: encodeTwoFactor(signed) };
  }
  await endSession(prisma, response.token);
  if (typeof response.user?.id !== 'string') throw new Error('sign-in answered without a user');
  return finish(prisma, response.user.id, null, input.nonce, now);
}

export async function twoFactorStep(prisma: PrismaClient, input: z.infer<typeof twoFactorInput>, now: Date): Promise<Step> {
  const signed = decodeTwoFactor(input.challenge);
  if (!signed) return { status: 'expired' };
  const headers = authHeaders(input.clientIp, input.userAgent, `${await twoFactorCookieName(prisma)}=${encodeURIComponent(signed)}`);
  const challenge = await pendingTwoFactor(prisma, headers);
  if (!challenge) return { status: 'expired' };

  const retryAfterSec = await limit(prisma, [[`totp:user:${challenge.userId}`, RATE_RULES['totp:user']]], now);
  if (retryAfterSec > 0) return { status: 'limited', retryAfterSec };

  const code = signInCodeField.safeParse(input.code);
  if (!code.success) return { status: 'invalid_code' };
  const recovery = isRecoveryCode(code.data);
  const auth = serverAuthFor(prisma);
  let verified: { token?: unknown };
  try {
    // With the challenge cookie alone, so the challenge is all Better Auth can use.
    verified = recovery
      ? await auth.api.verifyBackupCode({ body: { code: code.data }, headers: challenge.headers })
      : await auth.api.verifyTOTP({ body: { code: code.data }, headers: challenge.headers });
  } catch (error) {
    switch (authErrorCode(error)) {
      case 'INVALID_CODE':
      case 'INVALID_BACKUP_CODE':
        return { status: 'invalid_code' };
      case 'INVALID_TWO_FACTOR_COOKIE':
      case 'TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE':
        return { status: 'expired' };
      case 'ACCOUNT_TEMPORARILY_LOCKED':
        return { status: 'limited', retryAfterSec: RATE_RULES['totp:user'].windowSec };
    }
    throw error;
  }
  await endSession(prisma, verified.token);
  // A recovery code is gone for good once used: the person may want to know it was (as on the Studio's sign-in).
  if (recovery) {
    await prisma.auditLog.create({
      data: {
        actorId: challenge.userId,
        action: 'account.recovery_code_used',
        entityType: 'User',
        entityId: challenge.userId,
        changes: { via: 'retail' },
        ip: input.clientIp.slice(0, 64),
        userAgent: (input.userAgent ?? '').slice(0, 512),
      },
    });
  }
  return finish(prisma, challenge.userId, null, input.nonce, now);
}

export async function chooseStep(prisma: PrismaClient, input: z.infer<typeof chooseInput>, now: Date): Promise<Step> {
  const userId = await spendPick(prisma, input.challenge, now);
  if (!userId) return { status: 'expired' };
  return finish(prisma, userId, input.shopId, input.nonce, now);
}

/**
 * One of the three Route Handlers: signed (`admitRetailCall`), then the handoff secret (a misconfigured one fails here,
 * 503, before any password is checked), then the input, then the step.
 */
export async function credentialsRoute<S extends z.ZodType>(
  request: Request,
  label: string,
  schema: S,
  step: (prisma: PrismaClient, input: z.infer<S>, now: Date) => Promise<Step>,
): Promise<Response> {
  const prisma = getPrisma();
  try {
    const now = new Date();
    const admitted = await admitRetailCall(prisma, request, now);
    if (!admitted.ok) return admitted.response;
    void retailConfig().handoffSecret;

    let json: unknown;
    try {
      json = JSON.parse(admitted.body);
    } catch {
      return retailRefusal(400, 'INVALID_INPUT');
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) return retailRefusal(400, 'INVALID_INPUT');

    const answer = await step(prisma, parsed.data, now);
    if (answer.status === 'limited') return rateLimited(answer.retryAfterSec);
    return retailJson(answer);
  } catch (error) {
    // The error's name only: never the email, the password, a code, a challenge or a token.
    console.error(`[retail.credentials.${label}] ${error instanceof Error ? error.name : 'unknown error'}`);
    return retailRefusal(503, 'UNAVAILABLE');
  }
}
