import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { expireMenu } from '@/server/data/cache';
import { pruneWheelSpins } from '@/server/http/rate-limit';
import { databaseUrl, TEST_DB } from '../../scripts/db-config';
import { createMenuFixture, publishFixture, resetTestData, testPrisma } from '../helpers/db';

process.env.DATABASE_URL = databaseUrl(TEST_DB);
const prisma = testPrisma();

type Handler = (request: Request, ctx: { params: Promise<{ tenant: string }> }) => Promise<Response>;
let GET: Handler;
let POST: Handler;
let x: Awaited<ReturnType<typeof createMenuFixture>>;
let productIds: string[] = [];
let sliceIds: string[] = [];
let n = 0;

const SLUG = 'wheel-x';
const ctx = { params: Promise.resolve({ tenant: SLUG }) };
const image = { kind: 'image', url: '/m/dish.webp', alt: 'Dish', width: 400, height: 300 };

/** A fresh address per call unless one is given, so the per-address request limit never gets in the way. */
const ip = () => `10.0.${Math.floor(++n / 250)}.${n % 250}`;
const call = (method: 'GET' | 'POST', { address = ip(), cookie }: { address?: string; cookie?: string } = {}) =>
  (method === 'GET' ? GET : POST)(
    new Request(`http://localhost/api/${SLUG}/wheel`, {
      method,
      headers: { 'x-forwarded-for': address, ...(cookie ? { cookie } : {}), ...(method === 'POST' ? { 'content-type': 'application/json' } : {}) },
      ...(method === 'POST' ? { body: '{}' } : {}),
    }),
    ctx,
  );
const cookieOf = (response: Response) => (response.headers.get('set-cookie') ?? '').split(';')[0] ?? '';

async function refresh() {
  expireMenu([SLUG], x.menu.id);
}

beforeEach(async () => {
  await resetTestData(prisma);
  x = await createMenuFixture(prisma, SLUG, { publish: false });
  await prisma.restaurant.update({ where: { id: x.restaurant.id }, data: { plan: 'PREMIUM' } });
  await prisma.menu.update({ where: { id: x.menu.id }, data: { aboutEnabled: true, wheelEnabled: true } });
  productIds = [];
  for (let k = 0; k < 5; k++) {
    productIds.push((await prisma.product.create({ data: { menuId: x.menu.id, categoryId: x.category.id, slug: `dish-${k}`, basePrice: 100, translations: { en: { name: `Dish ${k}` } }, media: [image] as never } })).id);
  }
  const wheel = await prisma.menuWheel.create({ data: { menuId: x.menu.id, spinsPerDay: 1 } });
  sliceIds = [];
  for (const [index, productId] of productIds.entries()) {
    sliceIds.push((await prisma.wheelSlice.create({ data: { wheelId: wheel.id, menuId: x.menu.id, productId, weight: 1, sortOrder: index, label: index === 0 ? { en: '10% off' } : {} } })).id);
  }
  await publishFixture(prisma, x.menu.id);
  await refresh();
  GET ??= (await import('@/app/api/[tenant]/wheel/route')).GET;
  POST ??= (await import('@/app/api/[tenant]/wheel/route')).POST;
});

afterAll(async () => {
  await resetTestData(prisma);
  await prisma.$disconnect();
});

describe('GET wheel', () => {
  it('shows the slices without weights, and the spins left', async () => {
    const response = await call('GET');
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = await response.json();
    expect(body.available).toBe(true);
    expect(body.spinsLeft).toBe(1);
    expect(body.slices).toHaveLength(5);
    expect(body.slices[0]).toMatchObject({ productId: productIds[0], name: 'Dish 0', label: '10% off', photo: { url: '/m/dish.webp' } });
    expect(JSON.stringify(body)).not.toContain('weight');
  });

  it('is not available when the wheel is off, outside its dates, or the plan lacks it', async () => {
    await prisma.menu.update({ where: { id: x.menu.id }, data: { wheelEnabled: false } });
    await refresh();
    expect((await (await call('GET')).json()).available).toBe(false);
    await prisma.menu.update({ where: { id: x.menu.id }, data: { wheelEnabled: true } });
    await prisma.menuWheel.update({ where: { menuId: x.menu.id }, data: { endsAt: new Date(Date.now() - 1000) } });
    await refresh();
    expect((await (await call('GET')).json()).available).toBe(false);
    await prisma.menuWheel.update({ where: { menuId: x.menu.id }, data: { endsAt: null } });
    await prisma.restaurant.update({ where: { id: x.restaurant.id }, data: { plan: 'BASIC' } });
    await refresh();
    const off = await (await call('GET')).json();
    expect(off.available).toBe(false);
    expect(off.slices).toEqual([]);
  });

  it('is not available when the Explore page itself is off, even with the wheel switched on', async () => {
    await prisma.menu.update({ where: { id: x.menu.id }, data: { aboutEnabled: false } });
    await refresh();
    expect((await (await call('GET')).json()).available).toBe(false);
    expect((await call('POST')).status).toBe(409);
  });

  it('is available again for one restaurant when the Super Admin grants the feature on a plan without it', async () => {
    await prisma.restaurant.update({ where: { id: x.restaurant.id }, data: { plan: 'BASIC', planExtras: { features: { 'menu.about': true, 'menu.wheel': true } } } });
    await refresh();
    expect((await (await call('GET')).json()).available).toBe(true);
  });

  it('drops a hidden dish, and is not available with fewer than 4 left', async () => {
    await prisma.product.update({ where: { id: productIds[0] as string }, data: { isHidden: true } });
    await refresh();
    expect((await (await call('GET')).json()).slices).toHaveLength(4);
    await prisma.product.update({ where: { id: productIds[1] as string }, data: { isHidden: true } });
    await refresh();
    expect((await (await call('GET')).json()).available).toBe(false);
  });
});

describe('POST wheel', () => {
  it('returns a winner from the slices, sets the guest cookie, and counts the spin', async () => {
    const response = await call('POST');
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const cookie = response.headers.get('set-cookie') ?? '';
    expect(cookie).toMatch(/^bz_guest=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    const body = await response.json();
    expect(productIds).toContain(body.winnerProductId);
    expect(body.spinsLeft).toBe(0);
    expect(await prisma.wheelSpin.count()).toBe(1);
  });

  it('refuses the second spin of a guest at the limit, and reports it as used in GET', async () => {
    const first = await call('POST', { address: '10.9.9.1' });
    const cookie = cookieOf(first);
    const second = await call('POST', { address: '10.9.9.1', cookie });
    expect(second.status).toBe(409);
    expect((await second.json()).error.code).toBe('SPINS_USED');
    expect((await (await call('GET', { address: '10.9.9.1', cookie })).json()).spinsLeft).toBe(0);
    expect(await prisma.wheelSpin.count()).toBe(1);
  });

  it('lets a guest spin as often as spinsPerDay says', async () => {
    await prisma.menuWheel.update({ where: { menuId: x.menu.id }, data: { spinsPerDay: 2 } });
    await refresh();
    const first = await call('POST', { address: '10.9.9.2' });
    const cookie = cookieOf(first);
    expect((await first.json()).spinsLeft).toBe(1);
    expect((await call('POST', { address: '10.9.9.2', cookie })).status).toBe(200);
    expect((await call('POST', { address: '10.9.9.2', cookie })).status).toBe(409);
  });

  it('a new cookie does not get a new spin forever: an address stops at three times the limit', async () => {
    for (let k = 0; k < 3; k++) expect((await call('POST', { address: '10.9.9.3' })).status).toBe(200);
    const blocked = await call('POST', { address: '10.9.9.3' });
    expect(blocked.status).toBe(409);
    expect((await blocked.json()).error.code).toBe('SPINS_USED');
  });

  it('treats a forged cookie as a new guest and replaces it', async () => {
    const response = await call('POST', { cookie: 'bz_guest=forged.value' });
    expect(response.status).toBe(200);
    expect(response.headers.get('set-cookie')).toMatch(/^bz_guest=/);
    expect(cookieOf(response)).not.toContain('forged');
  });

  it('two spins at once at the limit give one winner', async () => {
    const first = await call('POST', { address: '10.9.9.4' });
    const cookie = cookieOf(first);
    await prisma.wheelSpin.deleteMany();
    const results = await Promise.all([call('POST', { address: '10.9.9.4', cookie }), call('POST', { address: '10.9.9.4', cookie })]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await prisma.wheelSpin.count()).toBe(1);
  });

  it('is NOT_AVAILABLE when the wheel is off', async () => {
    await prisma.menu.update({ where: { id: x.menu.id }, data: { wheelEnabled: false } });
    await refresh();
    const response = await call('POST');
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe('NOT_AVAILABLE');
    expect(await prisma.wheelSpin.count()).toBe(0);
  });

  it('never lands on a dish that is hidden or sold out', async () => {
    for (const id of productIds.slice(0, 2)) await prisma.product.update({ where: { id }, data: { isAvailable: false } });
    await prisma.product.update({ where: { id: productIds[2] as string }, data: { isHidden: true } });
    await prisma.product.update({ where: { id: productIds[3] as string }, data: { isHidden: false } });
    await refresh();
    // Two usable dishes are fewer than four: not available.
    expect((await call('POST')).status).toBe(409);
    await prisma.product.update({ where: { id: productIds[0] as string }, data: { isAvailable: true } });
    await prisma.product.update({ where: { id: productIds[2] as string }, data: { isHidden: false } });
    await refresh();
    const seen = new Set<string>();
    for (let k = 0; k < 12; k++) seen.add((await (await call('POST')).json()).winnerProductId);
    expect(seen.has(productIds[1] as string)).toBe(false);
  });

  it('caps one address at three times the daily spins even when the requests arrive together without cookies', async () => {
    const address = ip();
    const answers = await Promise.all(Array.from({ length: 10 }, () => call('POST', { address })));
    expect(answers.filter((answer) => answer.status === 200).length).toBeLessThanOrEqual(3);
    expect(await prisma.wheelSpin.count()).toBeLessThanOrEqual(3);
  });

  it('rejects a body with extra fields', async () => {
    const response = await POST(
      new Request(`http://localhost/api/${SLUG}/wheel`, { method: 'POST', headers: { 'x-forwarded-for': ip() }, body: JSON.stringify({ winner: 'x' }) }),
      ctx,
    );
    expect(response.status).toBe(400);
  });
});

describe('pruneWheelSpins', () => {
  it('deletes spins older than the cut-off and keeps newer ones', async () => {
    const day = 86_400_000;
    const make = (guestKey: string, age: number) => prisma.wheelSpin.create({ data: { menuId: x.menu.id, guestKey, ipHash: 'h', day: '2026-10-29', slot: 0, createdAt: new Date(Date.now() - age) } });
    await make('old', 4 * day);
    await make('new', day);
    expect(await pruneWheelSpins(prisma, new Date(Date.now() - 3 * day))).toBe(1);
    expect((await prisma.wheelSpin.findMany()).map((row) => row.guestKey)).toEqual(['new']);
  });
});
