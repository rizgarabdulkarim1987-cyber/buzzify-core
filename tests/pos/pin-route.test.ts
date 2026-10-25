import { cookies, headers } from 'next/headers';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST as registerRoute } from '@/app/api/pos/device/register/route';
import { POST } from '@/app/api/pos/pin/sign-in/route';
import { DEVICE_COOKIE } from '@/server/domain/pos/pin';
import { deviceCookieOptions, readDeviceToken } from '@/server/pos/device-cookie';
import { registerPosDevice, revokePosDevice, setOwnPosPin } from '@/server/studio/actions/pos-pin';
import { getAuth } from '@/server/studio/auth/auth';
import { cookieHeader, cookieStore } from '../helpers/auth';
import { dataOf, GOOD, person, prisma, resetWorld, restaurant, run, useTestDatabase, type Person } from './fixture';

vi.mock('next/headers', () => ({ headers: vi.fn(async () => new Headers()), cookies: vi.fn() }));

const ORIGIN = 'http://127.0.0.1:3100';
const globalForPrisma = globalThis as unknown as { __prisma?: unknown };

let a: { id: string };
let manager: Person;
let cashier: Person;
let kitchen: Person;
let deviceId: string;
let token: string;
let cashierStaff: string;
let kitchenStaff: string;

beforeAll(() => {
  useTestDatabase();
});

beforeEach(async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  await resetWorld();
  a = await restaurant('Pin Route A');
  manager = await person('manager', { staff: [a.id, 'MANAGER'] });
  cashier = await person('cashier', { staff: [a.id, 'CASHIER'] });
  kitchen = await person('kitchen', { staff: [a.id, 'KITCHEN'] });
  const registered = dataOf(await run(manager, registerPosDevice, { name: 'Front till' }));
  deviceId = registered.deviceId;
  token = registered.token;
  dataOf(await run(cashier, setOwnPosPin, { pin: '2580', password: GOOD }));
  dataOf(await run(kitchen, setOwnPosPin, { pin: '7391', password: GOOD }));
  cashierStaff = (await prisma().posStaff.findFirstOrThrow({ where: { userId: cashier.userId } })).id;
  kitchenStaff = (await prisma().posStaff.findFirstOrThrow({ where: { userId: kitchen.userId } })).id;
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await resetWorld();
  await prisma().$disconnect();
  delete globalForPrisma.__prisma;
});

async function passwordSession(who: Person): Promise<string> {
  const res = await getAuth().api.signInEmail({ body: { email: who.email, password: GOOD }, returnHeaders: true });
  return cookieHeader(res.headers.getSetCookie()).get('cookie') ?? '';
}

function send(body: unknown, options: { device?: string | null; session?: string; origin?: string | null; raw?: string } = {}): Promise<Response> {
  const all = new Headers({ 'content-type': 'application/json' });
  if (options.origin !== null) all.set('origin', options.origin ?? ORIGIN);
  const cookie = [options.device === null ? '' : `${DEVICE_COOKIE}=${options.device ?? token}`, options.session ?? ''].filter(Boolean).join('; ');
  if (cookie) all.set('cookie', cookie);
  vi.mocked(headers).mockResolvedValue(all as never);
  vi.mocked(cookies).mockResolvedValue(cookieStore(all.get('cookie')) as never);
  return POST(new Request(`${ORIGIN}/api/pos/pin/sign-in`, { method: 'POST', body: options.raw ?? JSON.stringify(body), headers: all }));
}

const codeOf = async (res: Response) => ((await res.json()) as { error?: { code?: string } }).error?.code;

describe('the PIN sign-in route', () => {
  it('signs the chosen person in on a registered device, with a session of their own and no caching', async () => {
    const res = await send({ staffId: cashierStaff, pin: '2580' });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ landing: 'tables' });
    const cookie = cookieHeader(res.headers.getSetCookie());
    const session = await getAuth().api.getSession({ headers: cookie });
    expect(session?.user.id).toBe(cashier.userId);
  });

  it('lands the kitchen on its screen', async () => {
    const res = await send({ staffId: kitchenStaff, pin: '7391' });
    expect(await res.json()).toEqual({ landing: 'kitchen' });
  });

  it('ends the session the request carried', async () => {
    const before = await passwordSession(manager);
    const old = await getAuth().api.getSession({ headers: new Headers({ cookie: before }) });
    expect(old?.user.id).toBe(manager.userId);
    const res = await send({ staffId: cashierStaff, pin: '2580' }, { session: before });
    expect(res.status).toBe(200);
    expect(await getAuth().api.getSession({ headers: new Headers({ cookie: before }) })).toBeNull();
  });

  it('refuses a request with no device cookie, an unknown one and a revoked one with 403 deviceUnknown', async () => {
    for (const device of [null, 'x'.repeat(43)]) {
      const res = await send({ staffId: cashierStaff, pin: '2580' }, { device });
      expect(res.status).toBe(403);
      expect(await codeOf(res)).toBe('deviceUnknown');
      expect(res.headers.getSetCookie().join(';')).not.toContain('session');
    }
    dataOf(await run(manager, revokePosDevice, { deviceId }));
    expect((await send({ staffId: cashierStaff, pin: '2580' })).status).toBe(403);
  });

  it('answers every wrong case with the same 401 pinRefused and no session cookie', async () => {
    for (const body of [
      { staffId: cashierStaff, pin: '9999' },
      { staffId: 'nobody', pin: '2580' },
      { staffId: (await prisma().posStaff.findFirstOrThrow({ where: { userId: manager.userId } })).id, pin: '2580' },
    ]) {
      const res = await send(body);
      expect(res.status).toBe(401);
      expect(await codeOf(res)).toBe('pinRefused');
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(res.headers.getSetCookie()).toEqual([]);
    }
  });

  it('answers 429 pinLocked with the time once five wrong PINs were tried', async () => {
    for (let i = 0; i < 5; i += 1) await send({ staffId: cashierStaff, pin: '1357' });
    const res = await send({ staffId: cashierStaff, pin: '2580' });
    expect(res.status).toBe(429);
    const body = (await res.json()) as { error: { code: string; retryAt: string } };
    expect(body.error.code).toBe('pinLocked');
    expect(new Date(body.error.retryAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('answers 429 deviceLimit after twenty failures on the device', async () => {
    const other = await person('cashier2', { staff: [a.id, 'CASHIER'] });
    dataOf(await run(other, setOwnPosPin, { pin: '4829', password: GOOD }));
    const otherStaff = (await prisma().posStaff.findFirstOrThrow({ where: { userId: other.userId } })).id;
    for (let i = 0; i < 20; i += 1) await send({ staffId: i % 2 === 0 ? cashierStaff : otherStaff, pin: i % 2 === 0 ? '1357' : '1358' });
    const res = await send({ staffId: otherStaff, pin: '4829' });
    expect(res.status).toBe(429);
    expect(await codeOf(res)).toBe('deviceLimit');
  });

  it('refuses a foreign Origin, a missing one with a non-JSON body, bad JSON and an oversized PIN', async () => {
    expect((await send({ staffId: cashierStaff, pin: '2580' }, { origin: 'https://evil.example' })).status).toBe(403);
    expect((await send({ staffId: cashierStaff, pin: '2580' }, { raw: 'not json' })).status).toBe(400);
    expect((await send({ staffId: cashierStaff, pin: '1'.repeat(40) })).status).toBe(400);
    expect((await send({ staffId: cashierStaff })).status).toBe(400);
  });

  it('refuses while the restaurant’s till is closed', async () => {
    await prisma().subscription.updateMany({ where: { restaurantId: a.id }, data: { status: 'CANCELLED' } });
    const res = await send({ staffId: cashierStaff, pin: '2580' });
    expect(res.status).toBe(403);
    expect(await codeOf(res)).toBe('tillClosed');
  });
});

describe('the device registration route', () => {
  async function register(who: Person, body: unknown, origin: string | null = ORIGIN): Promise<Response> {
    const all = new Headers({ 'content-type': 'application/json', cookie: await passwordSession(who) });
    if (origin !== null) all.set('origin', origin);
    vi.mocked(headers).mockResolvedValue(all as never);
    vi.mocked(cookies).mockResolvedValue(cookieStore(all.get('cookie')) as never);
    return registerRoute(new Request(`${ORIGIN}/api/pos/device/register`, { method: 'POST', body: JSON.stringify(body), headers: all }));
  }

  it('sets the device secret in an HttpOnly cookie and answers with the id only', async () => {
    const res = await register(manager, { name: 'Bar tablet' });
    const body = (await res.json()) as { ok: boolean; data: { deviceId: string } };
    expect(body.ok).toBe(true);
    expect(Object.keys(body.data)).toEqual(['deviceId']);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const cookie = res.headers.getSetCookie().find((c) => c.startsWith(`${DEVICE_COOKIE}=`)) ?? '';
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    const secret = cookie.split(';')[0]!.split('=')[1]!;
    expect(JSON.stringify(body)).not.toContain(secret);
    expect(await prisma().posSharedDevice.count({ where: { name: 'Bar tablet', revokedAt: null } })).toBe(1);
  });

  it('refuses a cashier, a foreign Origin and a blank name without a cookie', async () => {
    for (const res of [await register(cashier, { name: 'x' }), await register(manager, { name: 'x' }, 'https://evil.example'), await register(manager, { name: '  ' })]) {
      expect(res.headers.getSetCookie().some((c) => c.startsWith(`${DEVICE_COOKIE}=`))).toBe(false);
    }
    expect((await register(manager, { name: 'x' }, 'https://evil.example')).status).toBe(403);
    expect(await prisma().posSharedDevice.count({ where: { name: 'x' } })).toBe(0);
  });
});

describe('the device cookie', () => {
  it('is HttpOnly and Lax, and Secure outside development and test', () => {
    expect(deviceCookieOptions({ NODE_ENV: 'production' } as never)).toMatchObject({ httpOnly: true, sameSite: 'lax', path: '/', maxAge: 400 * 24 * 3600, secure: true });
    expect(deviceCookieOptions({ NODE_ENV: 'development' } as never).secure).toBe(false);
    expect(deviceCookieOptions({ NODE_ENV: 'test' } as never).secure).toBe(false);
  });

  it('reads its token from a Cookie header among others', () => {
    const h = new Headers({ cookie: `a=1; ${DEVICE_COOKIE}=abc_DEF-123; b=2` });
    expect(readDeviceToken(h)).toBe('abc_DEF-123');
    expect(readDeviceToken(new Headers())).toBeUndefined();
  });
});
