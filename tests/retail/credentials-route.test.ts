import { randomBytes } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { HANDOFF_TTL_SECONDS } from '@/server/retail/handoff';
import { pruneSpentSignatures, RETAIL_REPLAY_WINDOW_SEC } from '@/server/retail/inbound';
import { authFor } from '@/server/studio/auth/auth';
import { RATE_RULES } from '@/server/studio/auth/rate-limit';
import { cookieHeader, totpFromUri } from '../helpers/auth';
import { GOOD, person, prisma, resetWorld, useTestDatabase, type Person } from '../pharmacy/fixture';
import { handoffNonce, mac, verifyHandoff } from './contract-oracle';
import { retailShop } from './world';

vi.mock('next/headers', () => ({ headers: vi.fn(), cookies: vi.fn() }));

/**
 * Buzzify Retail's own sign-in form, checked by Studio: `POST /api/retail/v1/credentials` (email and password),
 * `/credentials/two-factor` (the code) and `/credentials/choose` (an owner of several shops). Signed like every Retails
 * call; the same limits and the same Better Auth check as the Studio's sign-in; the answer is a handoff token judged by
 * Retails' own verifyHandoff (the oracle).
 */

const globalForPrisma = globalThis as unknown as { __prisma?: unknown };
const CALLER = 'the-caller-secret-shared-with-retails';
const HANDOFF_SECRET = 'the-handoff-secret-shared-with-retails';
const STUDIO = 'https://studio.example.test';
const RETAILS_EGRESS = '198.51.100.7';
const BROWSER_IP = '203.0.113.44';
const STATE = 'c3RhdGUtZnJvbS1yZXRhaWxzLW93bi1mb3JtLTMyLWJ5dGVz';
const NONCE = handoffNonce(STATE);
/** Retails makes a fresh state, so a fresh nonce, for every call: no two of its signed bodies are the same. */
const fresh = () => handoffNonce(randomBytes(32).toString('base64url'));

function enableRetail() {
  vi.stubEnv('RETAIL_URL', 'https://retail.test');
  vi.stubEnv('RETAIL_SYNC_SECRET', 'the-sync-secret-shared-with-retails');
  vi.stubEnv('RETAIL_CALLER_SECRET', CALLER);
  vi.stubEnv('RETAIL_CALLER_SECRET_PREVIOUS', '');
  vi.stubEnv('RETAIL_HANDOFF_SECRET', HANDOFF_SECRET);
}

let logged: string[] = [];
function silence() {
  logged = [];
  for (const level of ['info', 'warn', 'error', 'log', 'debug'] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      logged.push(args.map(String).join(' '));
    });
  }
}

type Path = '/api/retail/v1/credentials' | '/api/retail/v1/credentials/two-factor' | '/api/retail/v1/credentials/choose';

async function route(path: Path) {
  if (path === '/api/retail/v1/credentials') return (await import('@/app/api/retail/v1/credentials/route')).POST;
  if (path === '/api/retail/v1/credentials/two-factor') return (await import('@/app/api/retail/v1/credentials/two-factor/route')).POST;
  return (await import('@/app/api/retail/v1/credentials/choose/route')).POST;
}

function signed(path: Path, payload: unknown, sign: { secret?: string; ageSec?: number; none?: boolean } = {}) {
  const body = JSON.stringify(payload);
  const timestamp = String(Math.floor(Date.now() / 1000) - (sign.ageSec ?? 0));
  const headers: Record<string, string> = { 'content-type': 'application/json', 'x-forwarded-for': RETAILS_EGRESS };
  if (!sign.none) {
    headers['x-bz-timestamp'] = timestamp;
    headers['x-bz-signature'] = mac('POST', path, timestamp, body, sign.secret ?? CALLER);
  }
  return { body, headers };
}

/** Sends exactly these bytes with exactly these headers (a replay sends them twice). */
async function sendRaw(path: Path, call: { body: string; headers: Record<string, string> }): Promise<Response> {
  return (await route(path))(new Request(`${STUDIO}${path}`, { method: 'POST', body: call.body, headers: call.headers }));
}

async function send(
  path: Path,
  payload: unknown,
  sign: { secret?: string; ageSec?: number; none?: boolean } = {},
): Promise<Response> {
  return sendRaw(path, signed(path, payload, sign));
}

const credentials = (email: string, password: string, over: Record<string, unknown> = {}) =>
  send('/api/retail/v1/credentials', { email, password, clientIp: BROWSER_IP, nonce: fresh(), userAgent: 'Retails test', ...over });

const provision = (restaurantId: string) =>
  prisma().retailLink.update({ where: { restaurantId }, data: { retailBusinessId: `rt-${restaurantId}` } });

function claimsOf(token: string) {
  const verdict = verifyHandoff(token, [HANDOFF_SECRET]);
  if (!verdict.ok) throw new Error(`oracle refused: ${verdict.reason}`);
  return verdict.claims;
}

/** Turns two-factor on for `who` (a real TOTP secret and ten recovery codes), as the Studio's account page does. */
async function enrolTwoFactor(who: Person): Promise<{ totpURI: string; backupCodes: string[] }> {
  const auth = authFor(prisma());
  const signedIn = await auth.api.signInEmail({ body: { email: who.email, password: GOOD }, returnHeaders: true });
  const session = cookieHeader(signedIn.headers.getSetCookie());
  const enabled = await auth.api.enableTwoFactor({ body: { password: GOOD }, headers: session });
  if (enabled.method !== 'totp') throw new Error('unexpected two-factor method');
  await auth.api.verifyTOTP({ body: { code: totpFromUri(enabled.totpURI) }, headers: session });
  await prisma().session.deleteMany({ where: { userId: who.userId } });
  return { totpURI: enabled.totpURI, backupCodes: enabled.backupCodes };
}

beforeAll(() => useTestDatabase());
afterAll(async () => {
  await resetWorld();
  await prisma().$disconnect();
  delete globalForPrisma.__prisma;
});
beforeEach(async () => {
  await resetWorld();
  enableRetail();
  silence();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.stubEnv('RETAIL_URL', '');
});

describe('POST /api/retail/v1/credentials: the signature', () => {
  it('refuses an unsigned call, a wrong secret and an old timestamp, before anything is counted or checked', async () => {
    const shop = await retailShop('Sig Shop');
    const payload = { email: shop.owner!.email, password: GOOD, clientIp: BROWSER_IP, nonce: NONCE };
    for (const sign of [{ none: true }, { secret: 'not-the-caller-secret-at-all' }, { ageSec: 600 }]) {
      const response = await send('/api/retail/v1/credentials', payload, sign);
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ code: 'UNAUTHORIZED' });
    }
    // Nothing an unsigned caller sent was counted against the person or the address.
    expect(await prisma().authRateLimit.count({ where: { key: { startsWith: 'signin:' } } })).toBe(0);
  });

  it('answers a signed request once: the very same bytes sent again are refused, and nothing is counted twice', async () => {
    const shop = await retailShop('Replay Shop');
    await provision(shop.id);
    const call = signed('/api/retail/v1/credentials', { email: shop.owner!.email, password: GOOD, clientIp: BROWSER_IP, nonce: fresh() });
    const first = await sendRaw('/api/retail/v1/credentials', call);
    expect((await first.json()).status).toBe('ok');
    const replayed = await sendRaw('/api/retail/v1/credentials', call);
    expect(replayed.status).toBe(401);
    expect(await replayed.json()).toEqual({ code: 'UNAUTHORIZED' });
    expect(await prisma().authRateLimit.findUnique({ where: { key: `signin:email:${shop.owner!.email}` } })).toMatchObject({ count: 1 });
    // Only a hash of the signature is kept, never the signature or anything from the body.
    const marks = await prisma().authRateLimit.findMany({ where: { key: { startsWith: 'retail-sig:' } } });
    expect(marks).toHaveLength(1);
    expect(marks[0]!.key).toMatch(/^retail-sig:[0-9a-f]{64}$/);
    expect(marks[0]!.key).not.toContain(call.headers['x-bz-signature']!);

    // The same holds for the code and the chooser.
    const pick = signed('/api/retail/v1/credentials/choose', { challenge: 'pk.x', shopId: 's', clientIp: BROWSER_IP, nonce: fresh() });
    expect((await sendRaw('/api/retail/v1/credentials/choose', pick)).status).toBe(200);
    expect((await sendRaw('/api/retail/v1/credentials/choose', pick)).status).toBe(401);
    const code = signed('/api/retail/v1/credentials/two-factor', { challenge: 'tf.x', code: '123456', clientIp: BROWSER_IP, nonce: fresh() });
    expect((await sendRaw('/api/retail/v1/credentials/two-factor', code)).status).toBe(200);
    expect((await sendRaw('/api/retail/v1/credentials/two-factor', code)).status).toBe(401);

    // The cron job drops marks once their signatures are too old to be accepted anyway.
    const later = new Date(Date.now() + RETAIL_REPLAY_WINDOW_SEC * 1000 + 1000);
    expect(await pruneSpentSignatures(prisma(), new Date(later.getTime() - RETAIL_REPLAY_WINDOW_SEC * 1000))).toBe(3);
    expect(await prisma().authRateLimit.count({ where: { key: { startsWith: 'signin:' } } })).toBeGreaterThan(0);
  });

  it("counts Retails' calls in a bucket of their own, apart from the ai-config and identity calls' retail:ip", async () => {
    const shop = await retailShop('Bucket Shop');
    await provision(shop.id);
    // retail:ip used up by the other calls: the sign-in form still works.
    await prisma().authRateLimit.create({ data: { key: `retail:ip:${RETAILS_EGRESS}`, windowStart: new Date(), count: RATE_RULES['retail:ip'].max } });
    expect((await (await credentials(shop.owner!.email, GOOD)).json()).status).toBe('ok');
    expect(await prisma().authRateLimit.findUnique({ where: { key: `retail:ip:${RETAILS_EGRESS}` } })).toMatchObject({ count: RATE_RULES['retail:ip'].max });
    expect(await prisma().authRateLimit.findUnique({ where: { key: `retail-signin:ip:${RETAILS_EGRESS}` } })).toMatchObject({ count: 1 });

    // Its own bucket used up: the sign-in form waits, and retail:ip is not touched.
    await prisma().authRateLimit.update({ where: { key: `retail-signin:ip:${RETAILS_EGRESS}` }, data: { count: RATE_RULES['retail-signin:ip'].max } });
    const refused = await credentials(shop.owner!.email, GOOD);
    expect(refused.status).toBe(429);
    expect(await prisma().authRateLimit.findUnique({ where: { key: `retail:ip:${RETAILS_EGRESS}` } })).toMatchObject({ count: RATE_RULES['retail:ip'].max });
  });

  it('is 503 while the link is off, and 400 for a malformed body', async () => {
    vi.stubEnv('RETAIL_URL', '');
    expect((await credentials('a@ph-test.example', GOOD)).status).toBe(503);
    enableRetail();
    expect((await credentials('a@ph-test.example', GOOD, { nonce: 'short' })).status).toBe(400);
    expect((await credentials('a@ph-test.example', GOOD, { clientIp: 'not an address' })).status).toBe(400);
    // No address, no sign-in: browsers Retails cannot tell apart never share one count.
    expect((await credentials('a@ph-test.example', GOOD, { clientIp: '' })).status).toBe(400);
    expect((await send('/api/retail/v1/credentials', { email: 'a@ph-test.example' })).status).toBe(400);
  });
});

describe('POST /api/retail/v1/credentials: the password', () => {
  it("an owner's right password gets a handoff token for the shop, bound to the call's nonce, and leaves no Studio session", async () => {
    const shop = await retailShop('Own Form Shop');
    await provision(shop.id);
    const response = await credentials(`  ${shop.owner!.email.toUpperCase()} `, GOOD, { nonce: NONCE });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.getSetCookie()).toEqual([]);
    const answer = await response.json();
    expect(Object.keys(answer).sort()).toEqual(['handoffToken', 'status']);
    expect(answer.status).toBe('ok');
    const claims = claimsOf(answer.handoffToken);
    expect(claims).toMatchObject({ aud: 'retail', nonce: NONCE, coreUserId: shop.owner!.userId, emailVerified: true, coreBusinessId: shop.id });
    expect(claims.exp - claims.iat).toBe(HANDOFF_TTL_SECONDS);
    expect(await prisma().session.count({ where: { userId: shop.owner!.userId } })).toBe(0);

    // A fresh jti every time (Retails spends each once).
    const again = await (await credentials(shop.owner!.email, GOOD)).json();
    expect(claimsOf(again.handoffToken).jti).not.toBe(claims.jti);
    // Neither the password nor the token is in any log line.
    expect(logged.join('\n')).not.toContain(GOOD);
    expect(logged.join('\n')).not.toContain(answer.handoffToken);
  });

  it('answers a wrong password, an unknown email and a deactivated account the same way', async () => {
    const shop = await retailShop('Same Answer Shop');
    await provision(shop.id);
    const gone = await person('gone', { deactivated: true });
    const answers = await Promise.all([
      credentials(shop.owner!.email, `${GOOD}!`),
      credentials('nobody@ph-test.example', GOOD),
      credentials(gone.email, GOOD),
    ]);
    for (const response of answers) {
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ status: 'invalid' });
    }
  });

  it('answers an email no account can have and an over-long password as a wrong password, not as a failure', async () => {
    for (const response of [
      await credentials('not an email address', GOOD),
      await credentials('a@ph-test.example', 'x'.repeat(1025)),
      await credentials('a@ph-test.example', 'x'.repeat(4096)),
    ]) {
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ status: 'invalid' });
    }
  });

  it('counts the same per-email and per-address limits as the Studio sign-in, the right password included', async () => {
    const shop = await retailShop('Limit Shop');
    await provision(shop.id);
    const email = shop.owner!.email;
    for (let i = 0; i < RATE_RULES['signin:email'].max; i++) expect((await (await credentials(email, `wrong ${i}`)).json()).status).toBe('invalid');
    const refused = await credentials(email, GOOD);
    expect(refused.status).toBe(429);
    expect(await refused.json()).toEqual({ code: 'RATE_LIMITED' });
    expect(Number(refused.headers.get('retry-after'))).toBeGreaterThan(0);
    // The very keys the Studio's own sign-in counts: one budget for both doors.
    expect(await prisma().authRateLimit.findUnique({ where: { key: `signin:email:${email}` } })).toMatchObject({ count: 6 });

    // Per address: the browser's address Retails forwarded, not Retails' own.
    await prisma().authRateLimit.deleteMany();
    for (let i = 0; i < RATE_RULES['signin:ip'].max; i++) await credentials(`spray-${i}@ph-test.example`, GOOD);
    expect((await credentials(email, GOOD)).status).toBe(429);
    const elsewhere = await credentials(email, GOOD, { clientIp: '192.0.2.200' });
    expect((await elsewhere.json()).status).toBe('ok');
  });

  it('gives no token to whom the handoff gives none', async () => {
    const unready = await retailShop('Unready Shop');
    const admin = await person('admin', { superAdmin: true });
    await prisma().user.update({ where: { id: admin.userId }, data: { twoFactorEnabled: false } });
    const unverified = await person('unverified');
    await prisma().user.update({ where: { id: unverified.userId }, data: { emailVerified: false } });
    const staff = await person('staff');

    expect(await (await credentials(unready.owner!.email, GOOD)).json()).toEqual({ status: 'preparing' });
    expect(await (await credentials(admin.email, GOOD)).json()).toEqual({ status: 'unavailable' });
    expect(await (await credentials(unverified.email, GOOD)).json()).toEqual({ status: 'unavailable' });
    // Someone who owns no shop gets a token naming none: Retails' own memberships decide.
    const forStaff = await (await credentials(staff.email, GOOD)).json();
    expect(forStaff.status).toBe('ok');
    expect(claimsOf(forStaff.handoffToken).coreBusinessId).toBeUndefined();
  });
});

describe('POST /api/retail/v1/credentials: super admins and platform owners', () => {
  it('turns them away after the right password, in the words every refusal uses, before any code is asked', async () => {
    // Two-factor on (the fixture's super admin has it), so the handoff's own rule alone would let them through.
    const admin = await person('root', { superAdmin: true });
    const owner = await person('platform', { superAdmin: true });
    await prisma().user.update({ where: { id: owner.userId }, data: { isPlatformOwner: true, twoFactorEnabled: false } });

    for (const who of [admin, owner]) {
      const response = await credentials(who.email, GOOD);
      expect(response.status).toBe(200);
      expect(response.headers.getSetCookie()).toEqual([]);
      expect(await response.json()).toEqual({ status: 'unavailable' });
      expect(await prisma().session.count({ where: { userId: who.userId } })).toBe(0);
    }
    // A wrong password is still just wrong: the refusal says nothing to someone without the password.
    expect(await (await credentials(admin.email, `${GOOD}!`)).json()).toEqual({ status: 'invalid' });
  });
});

describe('POST /api/retail/v1/credentials/two-factor', () => {
  it('asks for the code, refuses a wrong one, gives the token for the right one, and the challenge works once', async () => {
    const shop = await retailShop('Two Step Shop');
    await provision(shop.id);
    const { totpURI } = await enrolTwoFactor(shop.owner!);

    const first = await (await credentials(shop.owner!.email, GOOD)).json();
    expect(Object.keys(first).sort()).toEqual(['challenge', 'status']);
    expect(first.status).toBe('needs_2fa');
    expect(JSON.stringify(first)).not.toContain('handoffToken');

    const step = (code: string, challenge = first.challenge, nonce = fresh()) =>
      send('/api/retail/v1/credentials/two-factor', { challenge, code, clientIp: BROWSER_IP, nonce });
    expect(await (await step('000000')).json()).toEqual({ status: 'invalid_code' });
    expect(await (await step('not a code')).json()).toEqual({ status: 'invalid_code' });

    const right = await step(totpFromUri(totpURI), first.challenge, NONCE);
    expect(right.headers.getSetCookie()).toEqual([]);
    const answer = await right.json();
    expect(answer.status).toBe('ok');
    expect(claimsOf(answer.handoffToken)).toMatchObject({ coreUserId: shop.owner!.userId, coreBusinessId: shop.id, nonce: NONCE });
    expect(await prisma().session.count({ where: { userId: shop.owner!.userId } })).toBe(0);

    expect(await (await step(totpFromUri(totpURI))).json()).toEqual({ status: 'expired' });
    expect(await (await step('123456', 'tf.bm90LWEtY2hhbGxlbmdl')).json()).toEqual({ status: 'expired' });
    expect(await (await step('123456', 'anything else')).json()).toEqual({ status: 'expired' });
  });

  it('takes a recovery code, once, and notes its use', async () => {
    const shop = await retailShop('Recovery Shop');
    await provision(shop.id);
    const { backupCodes } = await enrolTwoFactor(shop.owner!);
    const code = backupCodes[0]!;

    const challenge = (await (await credentials(shop.owner!.email, GOOD)).json()).challenge;
    const answer = await (await send('/api/retail/v1/credentials/two-factor', { challenge, code, clientIp: BROWSER_IP, nonce: NONCE })).json();
    expect(answer.status).toBe('ok');
    expect(await prisma().auditLog.count({ where: { actorId: shop.owner!.userId, action: 'account.recovery_code_used' } })).toBe(1);

    const again = (await (await credentials(shop.owner!.email, GOOD)).json()).challenge;
    const reused = await (await send('/api/retail/v1/credentials/two-factor', { challenge: again, code, clientIp: BROWSER_IP, nonce: NONCE })).json();
    expect(reused).toEqual({ status: 'invalid_code' });
    expect(logged.join('\n')).not.toContain(code);
  });

  it('counts the per-person code limit of the Studio sign-in', async () => {
    const shop = await retailShop('Code Limit Shop');
    await provision(shop.id);
    await enrolTwoFactor(shop.owner!);
    let status = 0;
    for (let i = 0; i <= RATE_RULES['totp:user'].max; i++) {
      const challenge = (await (await credentials(shop.owner!.email, GOOD, { clientIp: `192.0.2.${i + 1}` })).json()).challenge;
      await prisma().authRateLimit.deleteMany({ where: { key: { startsWith: 'signin:' } } });
      status = (await send('/api/retail/v1/credentials/two-factor', { challenge, code: '000000', clientIp: BROWSER_IP, nonce: NONCE })).status;
    }
    expect(status).toBe(429);
  });
});

describe('POST /api/retail/v1/credentials/choose', () => {
  it('lets an owner of several shops pick one, once', async () => {
    const a = await retailShop('Shop A');
    const b = await retailShop('Shop B', { owner: false });
    await provision(a.id);
    await provision(b.id);
    await prisma().membership.create({ data: { userId: a.owner!.userId, restaurantId: b.id, role: 'OWNER' } });

    const first = await (await credentials(a.owner!.email, GOOD)).json();
    expect(first.status).toBe('choose');
    expect(first.shops.map((s: { id: string }) => s.id).sort()).toEqual([a.id, b.id].sort());
    expect(first.shops.every((s: { ready: boolean }) => s.ready)).toBe(true);

    const pick = (challenge: string, shopId: string) =>
      send('/api/retail/v1/credentials/choose', { challenge, shopId, clientIp: BROWSER_IP, nonce: fresh() });
    const picked = await (await pick(first.challenge, b.id)).json();
    expect(picked.status).toBe('ok');
    expect(claimsOf(picked.handoffToken)).toMatchObject({ coreUserId: a.owner!.userId, coreBusinessId: b.id });
    expect(await (await pick(first.challenge, b.id)).json()).toEqual({ status: 'expired' });

    // A shop that is not theirs is no pick: the chooser again, with a new challenge.
    const other = await retailShop('Not Theirs');
    const second = await (await credentials(a.owner!.email, GOOD)).json();
    const notTheirs = await (await pick(second.challenge, other.id)).json();
    expect(notTheirs.status).toBe('choose');
    expect(notTheirs.challenge).not.toBe(second.challenge);
  });
});
