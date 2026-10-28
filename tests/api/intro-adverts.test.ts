import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { expireMenu } from '@/server/data/cache';
import { databaseUrl, TEST_DB } from '../../scripts/db-config';
import { createMenuFixture, resetTestData, testPrisma } from '../helpers/db';

process.env.DATABASE_URL = databaseUrl(TEST_DB);
const prisma = testPrisma();

type Handler = (request: Request, ctx: { params: Promise<{ tenant: string; id?: string }> }) => Promise<Response>;
let VIEW: Handler;
let CLICK: Handler;
let x: Awaited<ReturnType<typeof createMenuFixture>>;
let sharedPhoto = '';
let n = 0;
const DAY = 86_400_000;
const SLUG = 'ad-x';

const ip = () => `10.1.${Math.floor(++n / 250)}.${n % 250}`;
const view = (advertId: unknown, extra: Record<string, unknown> = {}) =>
  VIEW(
    new Request(`http://localhost/api/${SLUG}/intro/view`, { method: 'POST', headers: { 'x-forwarded-for': ip() }, body: JSON.stringify({ advertId, ...extra }) }),
    { params: Promise.resolve({ tenant: SLUG }) },
  );
const click = (id: string, search = '') =>
  CLICK(new Request(`http://localhost/${SLUG}/intro/ad/${id}${search}`, { headers: { 'x-forwarded-for': ip() } }), { params: Promise.resolve({ tenant: SLUG, id }) });

const advert = (over: Record<string, unknown> = {}) =>
  prisma.platformAdvert.create({ data: { imageAssetId: sharedPhoto, alts: { en: 'Sale' }, href: 'https://example.com/sale', restaurantIds: [], menuIds: [], ...over } });
const rows = () => prisma.platformAdvertDaily.findMany();

beforeEach(async () => {
  await resetTestData(prisma);
  x = await createMenuFixture(prisma, SLUG);
  await prisma.restaurant.update({ where: { id: x.restaurant.id }, data: { plan: 'PREMIUM' } });
  await prisma.menu.update({ where: { id: x.menu.id }, data: { introEnabled: true } });
  expireMenu([SLUG], x.menu.id);
  sharedPhoto = (
    await prisma.mediaAsset.create({
      data: { restaurantId: null, kind: 'IMAGE', storageKey: 'k/ad', contentHash: 'h-ad', mime: 'image/png', bytes: 10, storedBytes: 10, width: 800, height: 600, variants: { original: 'k/ad' } },
    })
  ).id;
  VIEW ??= (await import('@/app/api/[tenant]/intro/view/route')).POST as Handler;
  CLICK ??= (await import('@/app/[tenant]/intro/ad/[id]/route')).GET as Handler;
});

afterAll(async () => {
  await resetTestData(prisma);
  await prisma.$disconnect();
});

describe('counting views', () => {
  it('adds one view for the advert, the menu and the day, with no person in the row', async () => {
    const ad = await advert();
    expect((await view(ad.id)).status).toBe(204);
    expect((await view(ad.id)).status).toBe(204);
    const [row, ...rest] = await rows();
    expect(rest).toEqual([]);
    expect(row).toMatchObject({ advertId: ad.id, menuId: x.menu.id, restaurantId: x.restaurant.id, views: 2, clicks: 0 });
    expect(row?.day).toBe(new Date().toISOString().slice(0, 10));
    expect(Object.keys(row ?? {}).sort()).toEqual(['advertId', 'clicks', 'day', 'id', 'menuId', 'restaurantId', 'views']);
  });

  it('ignores an unknown advert, an inactive one, one outside its window and one for other menus', async () => {
    const other = await prisma.restaurant.create({ data: { name: 'Other' } });
    for (const id of [
      'ghost',
      (await advert({ active: false })).id,
      (await advert({ endsAt: new Date(Date.now() - DAY) })).id,
      (await advert({ startsAt: new Date(Date.now() + DAY) })).id,
      (await advert({ restaurantIds: [other.id] })).id,
    ]) {
      expect((await view(id)).status, id).toBe(204);
    }
    expect(await rows()).toEqual([]);
  });

  it('counts an advert listed for this menu or its restaurant', async () => {
    await view((await advert({ menuIds: [x.menu.id] })).id);
    await view((await advert({ restaurantIds: [x.restaurant.id] })).id);
    expect(await prisma.platformAdvertDaily.count()).toBe(2);
  });

  it('counts nothing when the intro is off', async () => {
    const ad = await advert();
    await prisma.menu.update({ where: { id: x.menu.id }, data: { introEnabled: false } });
    expireMenu([SLUG], x.menu.id);
    expect((await view(ad.id)).status).toBe(204);
    expect(await rows()).toEqual([]);
  });

  it('rejects a body with anything but an advert id', async () => {
    expect((await view(5)).status).toBe(400);
    expect((await view('a', { restaurantId: 'x' })).status).toBe(400);
  });

  it('counts two views at once as two', async () => {
    const ad = await advert();
    await Promise.all([view(ad.id), view(ad.id), view(ad.id)]);
    expect((await rows())[0]?.views).toBe(3);
  });
});

describe('counting clicks', () => {
  it('counts the click and sends the visitor to the address saved on the advert, never one from the query', async () => {
    const ad = await advert();
    const response = await click(ad.id, '?to=https://evil.example&href=//evil.example');
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('https://example.com/sale');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect((await rows())[0]).toMatchObject({ clicks: 1, views: 0 });
  });

  it('follows a path on the menu', async () => {
    const ad = await advert({ href: '/ad-x/en/p/espresso' });
    expect((await click(ad.id)).headers.get('location')).toBe('/ad-x/en/p/espresso');
  });

  it('answers 404 for an advert that is unknown, inactive, has no safe address, or is not for this menu, and counts nothing', async () => {
    const other = await prisma.restaurant.create({ data: { name: 'Other' } });
    for (const id of [
      'ghost',
      (await advert({ active: false })).id,
      (await advert({ href: '' })).id,
      (await advert({ href: 'javascript:alert(1)' })).id,
      (await advert({ restaurantIds: [other.id] })).id,
    ]) {
      expect((await click(id)).status, id).toBe(404);
    }
    expect(await rows()).toEqual([]);
  });
});
