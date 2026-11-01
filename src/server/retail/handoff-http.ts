import type { PrismaClient } from '@/generated/prisma/client';
import { direction, type Locale } from '@/lib/locale';
import { getPrisma } from '@/server/data/prisma';
import { clientIp } from '@/server/http/client-ip';
import { actorFromHeaders, type Actor } from '@/server/studio/auth/actor';
import { addressKey, checkRateLimit, RATE_RULES } from '@/server/studio/auth/rate-limit';
import { SIGN_IN_PATH } from '@/server/studio/framework/paths';
import { getStudioTranslator } from '@/studio/messages';
import { retailConfig } from './config';
import {
  checkReturn,
  checkStateAndNonce,
  chooseBusiness,
  decodeResume,
  encodeResume,
  HANDOFF_COOKIE_MAX_AGE,
  isRestaurantId,
  issueHandoff,
  ownedRetailShops,
  PICK_COOKIE,
  RESUME_COOKIE,
} from './handoff';

/**
 * The three Route Handlers of the sign-in handoff (see `./handoff.ts`), in one place so the Studio's route files stay
 * one line and never touch the database client:
 *
 * - `GET /api/retail/v1/handoff?return=&state=&nonce=`: Retails sends the browser here. Link off: 404. Counted per
 *   address. A return other than the configured callback, or a bad state or nonce: 400, never a redirect. No session:
 *   the state and nonce are parked in `RESUME_COOKIE` and the browser signs in, then comes back through
 *   `/studio/retail/continue`. With a session: a 302 to the callback with the token (owner of the chosen shop, or staff
 *   with no business), or a page (several shops: the chooser; not provisioned: "being prepared"; refused: no token).
 * - `GET /studio/retail/continue`: the resume cookie, checked again, rebuilt into the handoff address.
 * - `GET /studio/retail/open/[restaurantId]`: an owner's "Open Retails". Sets `PICK_COOKIE` and goes to Retails' start
 *   (Retails makes the state), or back to the handoff the chooser was opened from.
 *
 * Every answer is `no-store` and `Referrer-Policy: no-referrer`, so neither a cache nor the next site sees the token.
 * Logs carry an error's name only.
 */

export const HANDOFF_PATH = '/api/retail/v1/handoff';
export const CONTINUE_PATH = '/studio/retail/continue';
export const CHOOSE_PATH = '/studio/retail/choose';
const RETAIL_START_PATH = '/api/core/v1/handoff/start';

const BASE_HEADERS = { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff' } as const;

function cookieLine(name: string, value: string, maxAge: number): string {
  const secure = process.env.NODE_ENV === 'production';
  return `${name}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
}
const setCookie = (name: string, value: string) => cookieLine(name, value, HANDOFF_COOKIE_MAX_AGE);
const clearCookie = (name: string) => cookieLine(name, '', 0);
const CLEAR_BOTH = () => [clearCookie(RESUME_COOKIE), clearCookie(PICK_COOKIE)];

function answer(status: number, body: string | null, contentType: string | null, cookies: string[], extra: Record<string, string> = {}): Response {
  const headers = new Headers({ ...BASE_HEADERS, ...extra });
  if (contentType) headers.set('content-type', contentType);
  for (const line of cookies) headers.append('set-cookie', line);
  return new Response(body, { status, headers });
}

const plain = (status: number, text: string, cookies: string[] = []) => answer(status, text, 'text/plain; charset=utf-8', cookies);
const notFound = () => plain(404, 'Not found');
const redirectTo = (location: string, cookies: string[] = []) => answer(302, null, null, cookies, { location });

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** A small page in the person's language: what happened and the way back to the Studio. No token is ever in it. */
function page(status: number, locale: Locale, key: 'preparing' | 'refused', cookies: string[]): Response {
  const t = getStudioTranslator(locale);
  const title = escapeHtml(t(`retail.handoff.${key}.title`));
  const body = escapeHtml(t(`retail.handoff.${key}.body`));
  const html = `<!doctype html><html lang="${locale}" dir="${direction(locale)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="referrer" content="no-referrer"><title>${title}</title></head><body style="font-family:system-ui,sans-serif;max-width:36rem;margin:4rem auto;padding:0 16px;line-height:1.5"><h1 style="font-size:1.375rem">${title}</h1><p>${body}</p><p><a href="/studio">${escapeHtml(t('retail.handoff.back'))}</a></p></body></html>`;
  return answer(status, html, 'text/html; charset=utf-8', cookies);
}

function readCookie(headers: Headers, name: string): string | null {
  const raw = headers.get('cookie');
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

/** The link must be on (else 404) and the address within its count (else 429); null when the request may go on. */
async function admit(prisma: PrismaClient, request: Request, now: Date): Promise<Response | null> {
  if (!retailConfig().enabled) return notFound();
  const ip = addressKey(clientIp(request.headers));
  const verdict = await checkRateLimit(prisma, `retail-handoff:ip:${ip}`, RATE_RULES['retail:ip'], now);
  if (!verdict.allowed) return answer(429, 'Too many requests', 'text/plain; charset=utf-8', [], { 'retry-after': String(verdict.retryAfterSec) });
  return null;
}

/** A session that may sign in elsewhere: not a till's PIN session, and a Super Admin only with two-factor on. */
const mayHandOff = (actor: Actor) => !actor.posRestaurantId && (!actor.isSuperAdmin || actor.twoFactorEnabled);

async function guarded(label: string, run: () => Promise<Response>): Promise<Response> {
  try {
    return await run();
  } catch (error) {
    // The error's name only: never a token, a state or a secret.
    console.error(`[retail.handoff.${label}] ${error instanceof Error ? error.name : 'unknown error'}`);
    return plain(503, 'Unavailable');
  }
}

export function handoffRoute(request: Request): Promise<Response> {
  return guarded('start', async () => {
    const prisma = getPrisma();
    const now = new Date();
    const refused = await admit(prisma, request, now);
    if (refused) return refused;
    const config = retailConfig();
    const callbackUrl = config.callbackUrl;
    void config.handoffSecret; // A misconfigured secret fails here (503), before anyone is sent to sign in.

    const query = new URL(request.url).searchParams;
    const state = query.get('state');
    const nonce = query.get('nonce');
    if (!checkReturn(query.get('return'), callbackUrl) || !checkStateAndNonce(state, nonce)) return plain(400, 'Bad request');
    const resume = { state: state!, nonce: nonce! };

    const actor = await actorFromHeaders(prisma, request.headers);
    if (!actor) return redirectTo(`${SIGN_IN_PATH}?next=${encodeURIComponent(CONTINUE_PATH)}`, [setCookie(RESUME_COOKIE, encodeResume(resume))]);
    if (!mayHandOff(actor)) return page(403, actor.locale, 'refused', CLEAR_BOTH());

    const choice = await chooseBusiness(prisma, actor, readCookie(request.headers, PICK_COOKIE));
    if (choice.kind === 'choose') return redirectTo(CHOOSE_PATH, [setCookie(RESUME_COOKIE, encodeResume(resume)), clearCookie(PICK_COOKIE)]);
    if (choice.kind === 'notReady') return page(200, actor.locale, 'preparing', CLEAR_BOTH());

    const token = await issueHandoff(prisma, actor, choice.kind === 'business' ? choice.restaurantId : null, resume.nonce, now);
    if (!token) return page(403, actor.locale, 'refused', CLEAR_BOTH());
    const target = new URL(callbackUrl);
    target.searchParams.set('token', token);
    target.searchParams.set('state', resume.state);
    return redirectTo(target.toString(), CLEAR_BOTH());
  });
}

export function continueRoute(request: Request): Promise<Response> {
  return guarded('continue', async () => {
    const prisma = getPrisma();
    const refused = await admit(prisma, request, new Date());
    if (refused) return refused;
    const callbackUrl = retailConfig().callbackUrl;
    const resume = decodeResume(readCookie(request.headers, RESUME_COOKIE));
    if (!resume) return plain(400, 'Bad request', [clearCookie(RESUME_COOKIE)]);
    const query = new URLSearchParams({ return: callbackUrl, state: resume.state, nonce: resume.nonce });
    return redirectTo(`${HANDOFF_PATH}?${query}`);
  });
}

export function openRoute(request: Request, restaurantId: string): Promise<Response> {
  return guarded('open', async () => {
    const prisma = getPrisma();
    const refused = await admit(prisma, request, new Date());
    if (refused) return refused;
    const baseUrl = retailConfig().baseUrl;
    if (!isRestaurantId(restaurantId)) return notFound();
    const actor = await actorFromHeaders(prisma, request.headers);
    if (!actor || !mayHandOff(actor)) return notFound();
    const owned = await ownedRetailShops(prisma, actor.userId);
    if (!owned.some((shop) => shop.id === restaurantId)) return notFound();

    const pick = setCookie(PICK_COOKIE, restaurantId);
    // From the chooser: the handoff Retails started is still waiting in the resume cookie.
    if (decodeResume(readCookie(request.headers, RESUME_COOKIE))) return redirectTo(CONTINUE_PATH, [pick]);
    return redirectTo(`${baseUrl}${RETAIL_START_PATH}`, [pick]);
  });
}
