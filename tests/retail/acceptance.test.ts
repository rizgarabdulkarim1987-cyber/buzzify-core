import { randomBytes } from 'node:crypto';
import { cookies, headers as nextHeaders } from 'next/headers';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { writeAiSettings } from '@/server/ai/settings';
import { createHttpRetailClient } from '@/server/retail/client';
import { runReconcile } from '@/server/retail/reconcile';
import { runSender } from '@/server/retail/sender';
import { deriveSyncState } from '@/server/retail/sync-state';
import * as appPlans from '@/server/studio/actions/app-plans';
import * as billing from '@/server/studio/actions/billing';
import * as restaurants from '@/server/studio/actions/restaurants';
import * as retail from '@/server/studio/actions/retail';
import { loadActor, type Actor } from '@/server/studio/auth/actor';
import { authFor } from '@/server/studio/auth/auth';
import { createPasswordUser } from '@/server/studio/auth/users';
import { runAction, type ActionDef } from '@/server/studio/framework/action';
import type { ActionResult } from '@/server/studio/framework/result';
import { acceptInvitation } from '@/server/studio/services/invitations';
import { cookieHeader, cookieStore } from '../helpers/auth';
import { devMail, linkIn } from '../helpers/mail';
import { GOOD, prisma, resetWorld, useTestDatabase } from '../pharmacy/fixture';
import { aiConfigSchema, coreProvisionInput, coreStateSchema, handoffNonce, identitySchema, signRequest } from './contract-oracle';
import { startFakeRetails, type FakeRetails } from './fake-retails';
import { linkOf, outboxOf, RETAIL_LIMITS, RETAIL_NAME, retailPlan } from './world';

vi.mock('next/headers', () => ({ headers: vi.fn(), cookies: vi.fn() }));
// `after()` needs a request scope. Here it keeps every task (the kicks to Retails, the mails) until the test runs them,
// so each step decides when Studio's immediate delivery happens instead of racing it.
const scheduled = vi.hoisted(() => ({ tasks: [] as (() => unknown)[] }));
vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: vi.fn((task: (() => unknown) | Promise<unknown>) => {
    scheduled.tasks.push(typeof task === 'function' ? task : () => task);
  }),
}));

/**
 * Studio and Retails end to end, with Retails replaced by a fake HTTP server (`fake-retails.ts`) that checks every
 * request with Retails' own code (the oracle) and keeps state as Retails does. Studio runs for real: its actions, the
 * outbox, the kick, the sender, the reconcile, the handoff routes, the ai-config and identities routes and the database.
 * Time only moves where the real code waits (backoff, the daily reconcile): `now` is passed in, nothing sleeps.
 */

const globalForPrisma = globalThis as unknown as { __prisma?: unknown };
const META = { ip: '203.0.113.7', userAgent: 'vitest' };
const SYNC = 'acceptance-sync-secret-shared-with-retails';
const CALLER = 'acceptance-caller-secret-shared-with-retails';
const HANDOFF = 'acceptance-handoff-secret-shared-with-retails';
const STUDIO = 'https://studio.example.test';
const ANTHROPIC_KEY = 'sk-ant-acceptance-saved-key-0123456789';
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const { address, mailTo, nextTest, quiet, clean } = devMail();

let fake: FakeRetails;
let logged: string[] = [];

const run = <I, O>(actor: Actor, def: ActionDef<I, O>, input: unknown) => runAction(prisma(), actor, def, input, META);
const dataOf = <T>(result: ActionResult<T>): T => {
  if (!result.ok) throw new Error(`expected success, got ${JSON.stringify(result.error)}`);
  return result.data;
};

/** Runs what `after()` was handed (the kick, a mail), in order, and waits for each. */
async function flush(): Promise<void> {
  while (scheduled.tasks.length > 0) await scheduled.tasks.shift()!();
}

/** One sync cron pass at `at` (real time by default), with the real HTTP client. */
const syncRun = (at = Date.now()) => runSender(prisma(), createHttpRetailClient(), new Date(at));

/** What the Studio's Retail screens would show. */
async function syncState(restaurantId: string) {
  return deriveSyncState(await linkOf(restaurantId), await outboxOf(restaurantId));
}

/** The sync calls the fake received since `from`, each checked: none refused by the oracle. */
function syncCallsSince(from: number) {
  const calls = fake.sync().slice(from);
  expect(calls.filter((call) => call.refused !== null).map((call) => `${call.method} ${call.path} ${call.refused}`)).toEqual([]);
  return calls;
}

/** The snapshot body of a sync call, parsed as Retails parses it. */
function stateOf(call: { path: string; body: string }) {
  if (call.path === '/api/core/v1/provision') return coreProvisionInput.parse(JSON.parse(call.body)).state;
  return coreStateSchema.parse(JSON.parse(call.body));
}

async function superAdmin(email: string): Promise<Actor> {
  const { userId } = await createPasswordUser(prisma(), { email, name: 'Root', password: GOOD, isSuperAdmin: true, isPlatformOwner: true });
  await prisma().user.update({ where: { id: userId }, data: { twoFactorEnabled: true } });
  return (await loadActor(prisma(), userId))!;
}

// ---- a browser talking to Studio's Route Handlers (as tests/retail/handoff-route.test.ts does) -------------------------

type Jar = Map<string, string>;

async function studioGet(pathWithQuery: string, jar: Jar): Promise<Response> {
  const url = new URL(pathWithQuery, STUDIO);
  const headers = new Headers({ 'x-forwarded-for': '203.0.113.21' });
  const cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
  if (cookie) headers.set('cookie', cookie);
  vi.mocked(nextHeaders).mockResolvedValue(headers as never);
  vi.mocked(cookies).mockResolvedValue(cookieStore(headers.get('cookie')) as never);
  const request = new Request(url, { headers });
  let response: Response;
  if (url.pathname === '/api/retail/v1/handoff') {
    response = await (await import('@/app/api/retail/v1/handoff/route')).GET(request);
  } else if (url.pathname.startsWith('/studio/retail/open/')) {
    const restaurantId = decodeURIComponent(url.pathname.slice('/studio/retail/open/'.length));
    response = await (await import('@/app/studio/retail/open/[restaurantId]/route')).GET(request, { params: Promise.resolve({ restaurantId }) });
  } else {
    throw new Error(`no route for ${url.pathname}`);
  }
  cookieHeader(response.headers.getSetCookie(), jar);
  return response;
}

/** A browser request to the fake Retails, keeping its cookies in their own jar. */
async function retailsGet(location: string, jar: Jar): Promise<Response> {
  const cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
  const response = await fetch(location, { redirect: 'manual', headers: cookie ? { cookie } : {} });
  cookieHeader(response.headers.getSetCookie(), jar);
  return response;
}

// ---- Retails calling Studio, signed as Retails signs (CORE_OUT_SECRET = RETAIL_CALLER_SECRET) -------------------------

async function retailsCalls(method: 'GET' | 'POST', path: string, payload?: unknown): Promise<Response> {
  const body = payload === undefined ? '' : JSON.stringify(payload);
  const headers: Record<string, string> = { ...signRequest(method, path, body, CALLER), accept: 'application/json', 'x-forwarded-for': '198.51.100.4' };
  if (body) headers['content-type'] = 'application/json';
  const request = new Request(`${STUDIO}${path}`, { method, headers, body: body || undefined });
  if (path === '/api/retail/v1/ai-config') return (await import('@/app/api/retail/v1/ai-config/route')).GET(request);
  if (path === '/api/retail/v1/identities') return (await import('@/app/api/retail/v1/identities/route')).POST(request);
  throw new Error(`no route for ${path}`);
}

beforeAll(async () => {
  useTestDatabase();
  fake = await startFakeRetails({ syncSecret: SYNC, handoffSecret: HANDOFF, studioOrigin: STUDIO });
});
afterAll(async () => {
  await quiet();
  await clean();
  await fake.close();
  await resetWorld();
  await prisma().$disconnect();
  delete globalForPrisma.__prisma;
});
beforeEach(async () => {
  nextTest();
  scheduled.tasks = [];
  await resetWorld();
  vi.stubEnv('RETAIL_URL', fake.origin);
  vi.stubEnv('RETAIL_SYNC_SECRET', SYNC);
  vi.stubEnv('RETAIL_CALLER_SECRET', CALLER);
  vi.stubEnv('RETAIL_CALLER_SECRET_PREVIOUS', '');
  vi.stubEnv('RETAIL_HANDOFF_SECRET', HANDOFF);
  vi.stubEnv('AI_SETTINGS_ENCRYPTION_KEY', randomBytes(32).toString('base64'));
  vi.stubEnv('ANTHROPIC_API_KEY', '');
  logged = [];
  for (const level of ['info', 'warn', 'error', 'log', 'debug'] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      logged.push(args.map(String).join(' '));
    });
  }
});
afterEach(async () => {
  vi.restoreAllMocks();
  // Not unstubAllEnvs: it would also drop the test database's DATABASE_URL.
  vi.stubEnv('RETAIL_URL', '');
  await clean();
});

describe('Studio and Retails, end to end against a fake Retails', () => {
  it('provisions, syncs, retries, resyncs, reconciles, signs the owner in and answers Retails', { timeout: 60_000 }, async () => {
    const root = await superAdmin('root@acceptance.example');
    const plan = await retailPlan('shop');
    await prisma().planPrice.create({ data: { applicationId: 'retail', planCode: 'shop', currency: 'IQD', period: 'MONTHLY', amountMinor: 1_000 } });
    const ownerEmail = address('owner');

    // 1. A Super Admin creates a RETAIL shop. Nothing goes to Retails: it has no owner who accepted yet.
    const { restaurantId } = dataOf(
      await run(root, restaurants.createRestaurant, {
        name: 'Acceptance Shop',
        type: 'OTHER',
        city: 'Erbil',
        sector: 'RETAIL',
        branches: [{ name: 'Main', city: 'Erbil' }, { name: 'Ankawa' }],
        currencies: ['IQD', 'USD'],
        ownerEmail,
      }),
    );
    await flush();
    expect(await syncRun()).toEqual({ sent: 0, waiting: 0, retried: 0, failed: 0 });
    // The reconcile never reads Retails for a shop that was never provisioned.
    expect(await runReconcile(prisma(), createHttpRetailClient(), new Date())).toMatchObject({ checked: 1, errors: 0 });
    expect(fake.received).toEqual([]);
    expect(await syncState(restaurantId)).toEqual({ kind: 'notProvisioned' });

    // 2. The owner accepts the emailed invitation. Still nothing is sent: there is no retail subscription yet.
    const [invite] = await mailTo(ownerEmail);
    const inviteUrl = linkIn(invite!.text);
    const owner = await acceptInvitation(prisma(), {
      token: inviteUrl.slice(inviteUrl.lastIndexOf('/') + 1),
      signedInUserId: null,
      name: 'Shop Owner',
      password: GOOD,
      now: new Date(),
    });
    expect((await linkOf(restaurantId)).stateVersion).toBe(1);
    await flush(); // the kick: it finds the shop not ready and leaves the row waiting
    expect(await syncRun()).toEqual({ sent: 0, waiting: 0, retried: 0, failed: 0 });
    expect(fake.received).toEqual([]);
    expect(await syncState(restaurantId)).toEqual({ kind: 'waitingSubscription' });

    // 3. The trial starts on the billing screen: the kick provisions the shop, and Retails accepts the body.
    dataOf(await run(root, billing.startTrial, { restaurantId, applicationId: 'retail', planCode: 'shop', trialDays: 14, period: 'MONTHLY', currency: 'IQD' }));
    await flush();
    let calls = syncCallsSince(0);
    expect(calls.map((call) => `${call.method} ${call.path} ${call.status}`)).toEqual(['POST /api/core/v1/provision 200']);
    const provision = coreProvisionInput.parse(JSON.parse(calls[0]!.body));
    expect(provision).toMatchObject({
      coreBusinessId: restaurantId,
      name: 'Acceptance Shop',
      activityType: 'MIXED',
      branches: [{ name: 'Main' }, { name: 'Ankawa' }],
      currencies: ['IQD', 'USD'],
    });
    expect(provision.state).toMatchObject({
      version: 2,
      status: 'ACTIVE',
      plan: { code: 'shop', name: RETAIL_NAME.en, maxBranches: 2, maxTerminals: 3, maxUsers: 5, storageMb: 500, aiMonthly: 100 },
      subscription: { status: 'TRIAL', graceDays: expect.any(Number) },
      aiIntake: false,
      owner: { coreUserId: owner.userId, email: ownerEmail, emailVerified: true, name: 'Shop Owner' },
    });
    const businessId = fake.businesses.get(restaurantId)!.businessId;
    expect(await linkOf(restaurantId)).toMatchObject({ retailBusinessId: businessId, stateVersion: 2, acceptedVersion: 2 });
    expect(await outboxOf(restaurantId)).toBeNull();
    expect(await syncState(restaurantId)).toEqual({ kind: 'synced', version: 2 });

    // 4. The plan's limits change: every shop on it gets the next version. A plan change has no kick (it can reach many
    //    shops): the next sync cron pass pushes it as state.
    dataOf(
      await run(root, appPlans.upsert, {
        applicationId: 'retail', code: 'shop', name: RETAIL_NAME, sortOrder: 0, active: true, limits: { ...RETAIL_LIMITS, terminals: 9 }, version: plan.version,
      }),
    );
    await flush();
    expect(fake.received).toHaveLength(1);
    expect(await outboxOf(restaurantId)).toMatchObject({ dueVersion: 3 });
    expect(await syncRun()).toMatchObject({ sent: 1 });
    calls = syncCallsSince(1);
    expect(calls.map((call) => `${call.method} ${call.path} ${call.status}`)).toEqual(['POST /api/core/v1/state 200']);
    expect(stateOf(calls[0]!)).toMatchObject({ coreBusinessId: restaurantId, version: 3, plan: { maxTerminals: 9 } });
    expect(fake.businesses.get(restaurantId)!.version).toBe(3);
    expect(await linkOf(restaurantId)).toMatchObject({ stateVersion: 3, acceptedVersion: 3 });

    // 5. The shop is suspended: Retails receives SUSPENDED.
    dataOf(await run(root, restaurants.setRestaurantStatus, { restaurantId, status: 'SUSPENDED' }));
    await flush();
    calls = syncCallsSince(2);
    expect(calls.map((call) => stateOf(call)).map((s) => [s.version, s.status])).toEqual([[4, 'SUSPENDED']]);
    expect(fake.businesses.get(restaurantId)!.state.status).toBe('SUSPENDED');

    // 6. Retails goes down; the shop is reactivated. The kick and the cron retry with backoff, without a sleep: the clock
    //    passed to the sender moves instead.
    fake.down = true;
    dataOf(await run(root, restaurants.setRestaurantStatus, { restaurantId, status: 'ACTIVE' }));
    await flush();
    const t0 = Date.now();
    expect(fake.received.at(-1)).toMatchObject({ path: '/api/core/v1/state', status: 503 });
    let row = (await outboxOf(restaurantId))!;
    expect(row).toMatchObject({ dueVersion: 5, attempts: 1, lastError: 'HTTP_503', failedAt: null });
    expect(await syncState(restaurantId)).toMatchObject({ kind: 'retrying', attempts: 1, code: 'HTTP_503' });
    // The first wait is a minute (±10 %): a pass 30 s later sends nothing.
    expect(row.nextAttemptAt.getTime() - t0).toBeGreaterThan(45_000);
    const before = fake.received.length;
    expect(await syncRun(t0 + 30_000)).toEqual({ sent: 0, waiting: 0, retried: 0, failed: 0 });
    expect(fake.received.length).toBe(before);
    // Due after the wait: tried, still down, and the next wait doubles.
    expect(await syncRun(t0 + 2 * MINUTE)).toMatchObject({ retried: 1 });
    row = (await outboxOf(restaurantId))!;
    expect(row).toMatchObject({ attempts: 2, lastError: 'HTTP_503' });
    const secondWait = row.nextAttemptAt.getTime() - (t0 + 2 * MINUTE);
    expect(secondWait).toBeGreaterThan(1.8 * MINUTE);
    expect(secondWait).toBeLessThan(2.2 * MINUTE);
    expect(await syncRun(t0 + 3 * MINUTE)).toEqual({ sent: 0, waiting: 0, retried: 0, failed: 0 });
    expect(fake.received.length).toBe(before + 1);

    // 7. Retails is back: the next due pass delivers version 5 and the row is gone.
    fake.down = false;
    expect(await syncRun(t0 + 5 * MINUTE)).toMatchObject({ sent: 1 });
    expect(stateOf(fake.sync().at(-1)!)).toMatchObject({ version: 5, status: 'ACTIVE' });
    expect(fake.businesses.get(restaurantId)!).toMatchObject({ version: 5, state: { status: 'ACTIVE' } });
    expect(await outboxOf(restaurantId)).toBeNull();
    expect(await syncState(restaurantId)).toEqual({ kind: 'synced', version: 5 });

    // 8. Resync: the same content at a higher version, which Retails applies (an equal version it would ignore).
    expect(dataOf(await run(root, retail.resync, { restaurantId }))).toEqual({ version: 6 });
    await flush();
    const resent = fake.sync().at(-1)!;
    expect(resent).toMatchObject({ path: '/api/core/v1/state', status: 200, refused: null });
    expect(stateOf(resent).version).toBe(6);
    expect(fake.businesses.get(restaurantId)!.version).toBe(6);
    expect(await linkOf(restaurantId)).toMatchObject({ stateVersion: 6, acceptedVersion: 6 });

    // 9. Retails is restored from an older backup (version 3). The daily reconcile reads it, sees Retails behind and
    //    queues the snapshot again; the next pass re-pushes it at a new version, which Retails applies.
    const restored = fake.businesses.get(restaurantId)!;
    restored.version = 3;
    restored.state = { ...restored.state, version: 3, status: 'SUSPENDED' };
    const tomorrow = Date.now() + 25 * HOUR;
    const readsBefore = fake.sync().length;
    expect(await runReconcile(prisma(), createHttpRetailClient(), new Date(tomorrow))).toEqual({ checked: 1, drifted: 1, errors: 0 });
    const read = fake.sync()[readsBefore]!;
    expect(read).toMatchObject({ method: 'GET', path: `/api/core/v1/state?coreBusinessId=${encodeURIComponent(restaurantId)}`, body: '', status: 200, refused: null });
    expect(await linkOf(restaurantId)).toMatchObject({ remoteVersion: 3, remoteStatus: 'SUSPENDED', aiUsageMonth: '2026-11', aiUsageHalfUnits: 6, stateVersion: 7 });
    expect(await outboxOf(restaurantId)).toMatchObject({ dueVersion: 7 });
    expect(await syncRun(tomorrow)).toMatchObject({ sent: 1 });
    expect(stateOf(fake.sync().at(-1)!)).toMatchObject({ version: 7, status: 'ACTIVE' });
    expect(fake.businesses.get(restaurantId)!).toMatchObject({ version: 7, state: { status: 'ACTIVE' } });
    expect(await linkOf(restaurantId)).toMatchObject({ acceptedVersion: 7 });
    expect(await outboxOf(restaurantId)).toBeNull();

    // Every sync call Studio made was signed and shaped as Retails requires.
    syncCallsSince(0);

    // 10. The owner opens Retails from Studio: open -> Retails' start -> Studio's handoff -> Retails' callback. Retails'
    //     own verifyHandoff accepts the token, and its nonce is the hash of the state in that browser's cookie.
    const studioJar: Jar = new Map();
    const signedIn = await authFor(prisma()).api.signInEmail({ body: { email: ownerEmail, password: GOOD }, returnHeaders: true });
    cookieHeader(signedIn.headers.getSetCookie(), studioJar);
    const retailsJar: Jar = new Map();
    const open = await studioGet(`/studio/retail/open/${restaurantId}`, studioJar);
    expect(open.status).toBe(302);
    expect(open.headers.get('location')).toBe(`${fake.origin}/api/core/v1/handoff/start`);
    const start = await retailsGet(open.headers.get('location')!, retailsJar);
    expect(start.status).toBe(302);
    const toStudio = new URL(start.headers.get('location')!);
    expect(toStudio.origin + toStudio.pathname).toBe(`${STUDIO}/api/retail/v1/handoff`);
    const handoff = await studioGet(toStudio.pathname + toStudio.search, studioJar);
    expect(handoff.status).toBe(302);
    const toCallback = handoff.headers.get('location')!;
    expect(toCallback.startsWith(`${fake.callbackUrl}?`)).toBe(true);
    const callback = await retailsGet(toCallback, retailsJar);
    expect(fake.received.at(-1)).toMatchObject({ path: expect.stringMatching(/^\/api\/core\/v1\/handoff\/callback\?/), refused: null });
    expect(callback.status).toBe(302);
    expect(callback.headers.get('location')).toBe('/retail/home');
    expect(fake.signIns).toHaveLength(1);
    expect(fake.signIns[0]).toMatchObject({
      aud: 'retail',
      coreUserId: owner.userId,
      email: ownerEmail,
      emailVerified: true,
      name: 'Shop Owner',
      coreBusinessId: restaurantId,
      nonce: handoffNonce(toStudio.searchParams.get('state')!),
    });
    // The same token cannot be redeemed twice: the state is spent.
    expect((await retailsGet(toCallback, retailsJar)).status).toBe(400);

    // 11. Retails asks Studio for the AI key, signed with CORE_OUT_SECRET: read as Retails reads it.
    await writeAiSettings(prisma(), { provider: 'anthropic', anthropic: { apiKey: ANTHROPIC_KEY, askModel: 'claude-acceptance-ask' }, openai: {} }, null);
    const ai = await retailsCalls('GET', '/api/retail/v1/ai-config');
    expect(ai.status).toBe(200);
    expect(aiConfigSchema.parse(await ai.json())).toEqual({ apiKey: ANTHROPIC_KEY, model: 'claude-acceptance-ask' });

    // 12. Retails asks for the Studio identity of a staff email it does not know, and of the owner.
    const staffEmail = address('staff');
    const staff = await retailsCalls('POST', '/api/retail/v1/identities', { email: staffEmail, name: 'New Staff' });
    expect(staff.status).toBe(200);
    const staffAnswer = identitySchema.parse(await staff.json());
    const staffUser = await prisma().user.findUniqueOrThrow({ where: { email: staffEmail } });
    expect(staffAnswer).toEqual({ coreUserId: staffUser.id, created: true, emailVerified: false });
    expect(staffUser).toMatchObject({ identityOnly: true, emailVerified: false });
    scheduled.tasks = []; // the set-password mail; identities-route.test.ts covers it

    const known = await retailsCalls('POST', '/api/retail/v1/identities', { email: ownerEmail.toUpperCase() });
    expect(identitySchema.parse(await known.json())).toEqual({ coreUserId: owner.userId, created: false, emailVerified: true });

    // A call signed with another secret is refused, and nothing Studio logged carries a secret, a key or a token.
    const forged = new Request(`${STUDIO}/api/retail/v1/ai-config`, { headers: signRequest('GET', '/api/retail/v1/ai-config', '', SYNC) });
    expect((await (await import('@/app/api/retail/v1/ai-config/route')).GET(forged)).status).toBe(401);
    const logs = logged.join('\n');
    for (const secret of [SYNC, CALLER, HANDOFF, ANTHROPIC_KEY, new URL(toCallback).searchParams.get('token')!]) expect(logs).not.toContain(secret);
  });
});
