import { randomUUID } from 'node:crypto';
import { cookies, headers } from 'next/headers';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET as snapshotGet } from '@/app/api/pos/sync/snapshot/route';
import { POST as discardPost } from '@/app/api/pos/sync/discard/route';
import { POST as syncPost } from '@/app/api/pos/sync/route';
import { createPosArea, createPosTables } from '@/server/studio/actions/pos';
import { getAuth } from '@/server/studio/auth/auth';
import { cookieHeader, cookieStore } from '../helpers/auth';
import { dataOf, GOOD, person, prisma, resetWorld, restaurant, run, useTestDatabase, type Person } from './fixture';

vi.mock('next/headers', () => ({ headers: vi.fn(async () => new Headers()), cookies: vi.fn() }));

const ORIGIN = 'http://127.0.0.1:3100';
const globalForPrisma = globalThis as unknown as { __prisma?: unknown };
const device = randomUUID();
const noParams = { params: Promise.resolve({}) };

let a: { id: string };
let manager: Person;
let scope: string;
let tableId: string;
let cashierSession: Headers;
let outsiderSession: Headers;

beforeAll(() => {
  useTestDatabase();
});

async function signIn(who: Person): Promise<Headers> {
  const res = await getAuth().api.signInEmail({ body: { email: who.email, password: GOOD }, returnHeaders: true });
  return cookieHeader(res.headers.getSetCookie());
}

beforeEach(async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  await resetWorld();
  a = await restaurant('Routes A');
  manager = await person('manager', { staff: [a.id, 'MANAGER'] });
  const cashier = await person('cashier', { staff: [a.id, 'CASHIER'] });
  scope = `${a.id}:${cashier.userId}`;
  const outsider = await person('outsider');
  const areaId = dataOf(await run(manager, createPosArea, { name: 'Hall' })).areaId;
  await run(manager, createPosTables, { areaId, from: 1, to: 2 });
  tableId = (await prisma().posTable.findFirstOrThrow({ where: { restaurantId: a.id }, orderBy: { number: 'asc' } })).id;
  cashierSession = await signIn(cashier);
  outsiderSession = await signIn(outsider);
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await resetWorld();
  await prisma().$disconnect();
  delete globalForPrisma.__prisma;
});

function sent(session: Headers | null, extra: Record<string, string> = {}): Headers {
  const all = new Headers({ 'content-type': 'application/json', origin: ORIGIN, ...extra });
  const cookie = session?.get('cookie');
  if (cookie) all.set('cookie', cookie);
  vi.mocked(headers).mockResolvedValue(all as never);
  vi.mocked(cookies).mockResolvedValue(cookieStore(all.get('cookie')) as never);
  return all;
}

const post = (handler: (request: Request, context: { params: Promise<unknown> }) => Promise<Response>, body: string, session: Headers | null, extra: Record<string, string> = {}) =>
  handler(new Request(`${ORIGIN}/api/pos/sync`, { method: 'POST', body, headers: sent(session, extra) }), noParams);

const openOp = () => ({ operationId: randomUUID(), deviceId: device, clientAt: '2026-10-25T08:00:00.000Z', kind: 'openOrder', payload: { tableId } });
const batch = (operations: unknown[]) => JSON.stringify({ scope, deviceId: device, operations });

describe('POST /api/pos/sync', () => {
  it('replays an operation and answers it, never cached', async () => {
    const res = await post(syncPost, batch([openOp()]), cashierSession);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = (await res.json()) as { serverTime: string; answers: { status: string; replayed: boolean }[] };
    expect(body.answers).toMatchObject([{ status: 'done', replayed: false }]);
    expect(Number.isNaN(Date.parse(body.serverTime))).toBe(false);
  });

  it('sending the same body twice answers the stored result the second time', async () => {
    const body = batch([openOp()]);
    await post(syncPost, body, cashierSession);
    const again = (await (await post(syncPost, body, cashierSession)).json()) as { answers: { replayed: boolean }[] };
    expect(again.answers[0]?.replayed).toBe(true);
    expect(await prisma().posOrder.count({ where: { restaurantId: a.id } })).toBe(1);
  });

  it('refuses without a session, from another origin, with other content, too big, or malformed', async () => {
    expect((await post(syncPost, batch([openOp()]), null)).status).toBe(401);
    expect((await post(syncPost, batch([openOp()]), cashierSession, { origin: 'https://evil.example' })).status).toBe(403);
    expect((await post(syncPost, batch([openOp()]), cashierSession, { 'content-type': 'text/plain' })).status).toBe(415);
    expect((await post(syncPost, 'x'.repeat(300 * 1024), cashierSession)).status).toBe(413);
    expect((await post(syncPost, '{nope', cashierSession)).status).toBe(400);
    expect((await post(syncPost, batch([]), cashierSession)).status).toBe(400);
    expect((await post(syncPost, batch(Array.from({ length: 26 }, openOp)), cashierSession)).status).toBe(400);
    expect(await prisma().posOrder.count()).toBe(0);
  });

  it('refuses a batch queued by someone else than the person now signed in, and applies none of it', async () => {
    const other = JSON.stringify({ scope: `${a.id}:someone-else`, deviceId: device, operations: [openOp()] });
    expect((await post(syncPost, other, cashierSession)).status).toBe(409);
    expect(await prisma().posOrder.count()).toBe(0);
  });

  it('answers 403 to a signed-in person who has no till', async () => {
    expect((await post(syncPost, batch([openOp()]), outsiderSession)).status).toBe(403);
  });
});

describe('GET /api/pos/sync/snapshot', () => {
  const get = (session: Headers | null) => snapshotGet(new Request(`${ORIGIN}/api/pos/sync/snapshot`, { headers: sent(session) }), noParams);

  it('answers the cashier with the floor and no cache', async () => {
    const res = await get(cashierSession);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const { data } = (await res.json()) as { data: { areas: { tables: unknown[] }[]; user: { can: { pay: boolean } } } };
    expect(data.areas[0]?.tables).toHaveLength(2);
    expect(data.user.can.pay).toBe(true);
  });

  it('answers 401 without a session and 403 or 404 to a person with no till', async () => {
    expect((await get(null)).status).toBe(401);
    expect([403, 404]).toContain((await get(outsiderSession)).status);
  });
});

describe('POST /api/pos/sync/discard', () => {
  const body = (extra: object = {}) =>
    JSON.stringify({ operationId: randomUUID(), deviceId: device, kind: 'addLine', clientAt: '2026-10-25T08:00:00.000Z', summary: { lines: 2 }, reason: '', ...extra });

  it('records the discard in the audit log', async () => {
    const res = await post(discardPost, body({ reason: 'customer left' }), cashierSession);
    expect(res.status).toBe(200);
    const row = await prisma().auditLog.findFirstOrThrow({ where: { action: 'pos.sync.discard' } });
    expect(row).toMatchObject({ restaurantId: a.id, entityType: 'PosSyncOperation' });
  });

  it('wants a reason for cash, and refuses an operation the server already applied', async () => {
    expect((await post(discardPost, body({ kind: 'payCash', summary: { amount: 5000 } }), cashierSession)).status).toBe(400);
    const op = openOp();
    await post(syncPost, batch([op]), cashierSession);
    const applied = await post(discardPost, body({ operationId: op.operationId, kind: 'openOrder' }), cashierSession);
    expect(applied.status).toBe(409);
  });
});
