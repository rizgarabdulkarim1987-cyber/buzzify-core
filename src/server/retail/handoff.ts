import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { PrismaClient } from '@/generated/prisma/client';
import { DEFAULT_RETAIL_ACTIVITY, type RetailActivity } from '@/server/domain/retail/activity';
import type { Actor } from '@/server/studio/auth/actor';
import { retailConfig } from './config';

/**
 * Signing in to Buzzify Retail with a Studio account (Retails' `src/server/core/handoff.ts`, "Studio contract").
 * Retails' `/api/core/v1/handoff/start` sends the browser to `/api/retail/v1/handoff?return=&state=&nonce=`; Studio
 * answers with a 302 to Retails' callback carrying a token signed with `RETAIL_HANDOFF_SECRET`:
 * `base64url(JSON claims).base64url(HMAC-SHA256(first part))`, valid 60 s, bound to that browser by `nonce` (which must be
 * `base64url(sha256(state))` and is copied into the token unchanged). The token goes only to the configured callback,
 * never to an address from the request. Nothing here logs.
 */

export type HandoffClaims = {
  aud: 'retail';
  iat: number;
  exp: number;
  nonce: string;
  jti: string;
  coreUserId: string;
  email: string;
  emailVerified: boolean;
  name: string;
  /** The shop the owner opens; absent for a person who owns no retail shop (staff), whose Retails memberships decide. */
  coreBusinessId?: string;
};

export const HANDOFF_TTL_SECONDS = 60;
/** The handoff a browser without a session was on, kept across sign-in: base64url(JSON { state, nonce }). */
export const RESUME_COOKIE = 'studio_retail_resume';
/** The shop an owner picked ("Open Retails" or the chooser): a restaurant id, honoured only for an owner of it. */
export const PICK_COOKIE = 'studio_retail_pick';
/**
 * Set when a handoff that came back to one Retails address was sent on to the address of the chosen shop's own product
 * (its start makes a new state there). The next handoff for that shop then gets its token whatever its return is, so a
 * Retails that names one return for every address never makes the browser go round.
 */
export const HOP_COOKIE = 'studio_retail_hop';
export const HANDOFF_COOKIE_MAX_AGE = 600;

const NAME_MAX = 200;
const B64URL = /^[A-Za-z0-9_-]+$/;
const STATE = /^[A-Za-z0-9_-]{16,256}$/;
const NONCE = /^[A-Za-z0-9_-]{43}$/;
/** A restaurant id as Studio makes them (cuid); anything else is no restaurant. */
const RESTAURANT_ID = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_RESUME_LENGTH = 1024;

const b64url = (b: Buffer) => b.toString('base64url');

export function signHandoff(claims: HandoffClaims, secret: string): string {
  const payload = b64url(Buffer.from(JSON.stringify(claims), 'utf8'));
  return `${payload}.${b64url(createHmac('sha256', secret).update(payload, 'utf8').digest())}`;
}

/**
 * The return address is a configured callback (`RETAIL_URL`'s or a Retail product address's), character for character:
 * no parsing, no normalising, no trimming.
 */
export function checkReturn(raw: string | null, callbackUrls: string | readonly string[]): boolean {
  const allowed = typeof callbackUrls === 'string' ? [callbackUrls] : callbackUrls;
  return typeof raw === 'string' && raw.length > 0 && allowed.includes(raw);
}

/** Retails' state (base64url, 16..256) and the nonce it derives from it, base64url(sha256(state)) (43 chars). */
export function checkStateAndNonce(state: string | null, nonce: string | null): boolean {
  if (typeof state !== 'string' || typeof nonce !== 'string' || !STATE.test(state) || !NONCE.test(nonce)) return false;
  const expected = createHash('sha256').update(state, 'utf8').digest('base64url');
  return timingSafeEqual(Buffer.from(nonce, 'utf8'), Buffer.from(expected, 'utf8'));
}

export function isRestaurantId(value: string | null | undefined): value is string {
  return typeof value === 'string' && RESTAURANT_ID.test(value);
}

export type Resume = {
  state: string;
  nonce: string;
  /** The return the handoff came with, when it was not `RETAIL_URL`'s (a Retail product's address); checked again on use. */
  return?: string;
};

/** The resume cookie's value for a handoff. */
export function encodeResume(resume: Resume): string {
  return b64url(Buffer.from(JSON.stringify({ state: resume.state, nonce: resume.nonce, ...(resume.return ? { return: resume.return } : {}) }), 'utf8'));
}

/** The handoff a resume cookie holds, checked again as on arrival; null for anything else. A cookie without `return` is RETAIL_URL's. */
export function decodeResume(raw: string | null | undefined): Resume | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_RESUME_LENGTH || !B64URL.test(raw)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const { state, nonce, return: back } = parsed as Record<string, unknown>;
  if (typeof state !== 'string' || typeof nonce !== 'string' || !checkStateAndNonce(state, nonce)) return null;
  if (back !== undefined && (typeof back !== 'string' || back.length === 0 || back.length > 512)) return null;
  return typeof back === 'string' ? { state, nonce, return: back } : { state, nonce };
}

/**
 * The retail shops `userId` is an OWNER of, oldest membership first, whether Retails has provisioned each, and which
 * Retail product each is (whose Retails address its owner is sent to).
 */
export async function ownedRetailShops(
  db: Pick<PrismaClient, 'membership'>,
  userId: string,
): Promise<Array<{ id: string; name: string; provisioned: boolean; activity: RetailActivity }>> {
  const rows = await db.membership.findMany({
    where: { userId, role: 'OWNER', restaurant: { sector: 'RETAIL' } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { restaurant: { select: { id: true, name: true, retailLink: { select: { retailBusinessId: true, activity: true } } } } },
  });
  return rows.map(({ restaurant }) => ({
    id: restaurant.id,
    name: restaurant.name,
    provisioned: Boolean(restaurant.retailLink?.retailBusinessId),
    activity: restaurant.retailLink?.activity ?? DEFAULT_RETAIL_ACTIVITY,
  }));
}

export type Choice =
  | { kind: 'business'; restaurantId: string; activity: RetailActivity }
  | { kind: 'choose' }
  | { kind: 'none' }
  | { kind: 'notReady'; restaurantId: string };

/**
 * Which shop the token names: the picked one when the actor owns that retail shop (any other pick is ignored), else the
 * actor's only retail shop, else the chooser (several) or none (staff). Read from the database, never from the pick alone.
 */
export async function chooseBusiness(prisma: PrismaClient, actor: Actor, pick: string | null): Promise<Choice> {
  const shops = await ownedRetailShops(prisma, actor.userId);
  const chosen = (isRestaurantId(pick) ? shops.find((shop) => shop.id === pick) : undefined) ?? (shops.length === 1 ? shops[0] : undefined);
  if (!chosen) return shops.length === 0 ? { kind: 'none' } : { kind: 'choose' };
  return chosen.provisioned ? { kind: 'business', restaurantId: chosen.id, activity: chosen.activity } : { kind: 'notReady', restaurantId: chosen.id };
}

/**
 * The signed token for `actor`, naming `restaurantId` (null: staff, no business). The person is read again here, not
 * taken from the session: deactivated or unverified (an admin changed the address) gets no token at all (null).
 * Throws RetailConfigError when the handoff secret is missing or invalid.
 */
export async function issueHandoff(prisma: PrismaClient, actor: Actor, restaurantId: string | null, nonce: string, now: Date): Promise<string | null> {
  const secret = retailConfig().handoffSecret;
  const user = await prisma.user.findUnique({ where: { id: actor.userId }, select: { id: true, email: true, name: true, emailVerified: true, deactivatedAt: true } });
  if (!user || user.deactivatedAt || !user.emailVerified) return null;
  const iat = Math.floor(now.getTime() / 1000);
  const claims: HandoffClaims = {
    aud: 'retail',
    iat,
    exp: iat + HANDOFF_TTL_SECONDS,
    nonce,
    jti: randomUUID(),
    coreUserId: user.id,
    email: user.email,
    emailVerified: user.emailVerified && !user.deactivatedAt,
    name: user.name.slice(0, NAME_MAX),
    ...(restaurantId ? { coreBusinessId: restaurantId } : {}),
  };
  return signHandoff(claims, secret);
}
