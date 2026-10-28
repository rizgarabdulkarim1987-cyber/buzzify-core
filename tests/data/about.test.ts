import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { Locale } from '@/lib/locale';
import { loadAbout } from '@/server/data/about';
import { expireMenu } from '@/server/data/cache';
import { resolvePublicMenu } from '@/server/data/public-menu';
import { databaseUrl, TEST_DB } from '../../scripts/db-config';
import { createMenuFixture, resetTestData, testPrisma } from '../helpers/db';

process.env.DATABASE_URL = databaseUrl(TEST_DB);
const prisma = testPrisma();

type Fixture = Awaited<ReturnType<typeof createMenuFixture>>;
let x: Fixture;
let photo = '';

/** The route the guest page would get, with the cached gate dropped first so a change in this test is seen. */
async function route(locale: Locale = 'en') {
  expireMenu(['about-x'], x.menu.id);
  const result = await resolvePublicMenu('about-x');
  if (result.kind !== 'live') throw new Error('the fixture menu is not live');
  return { tenant: result.tenant, locale };
}

const para = (text: string) => ({ type: 'paragraph', text });

beforeEach(async () => {
  await resetTestData(prisma);
  x = await createMenuFixture(prisma, 'about-x');
  await prisma.restaurant.update({ where: { id: x.restaurant.id }, data: { plan: 'PREMIUM' } });
  await prisma.menu.update({ where: { id: x.menu.id }, data: { aboutEnabled: true } });
  photo = (
    await prisma.mediaAsset.create({
      data: { restaurantId: x.restaurant.id, kind: 'IMAGE', storageKey: 'k/photo', contentHash: 'h-photo', mime: 'image/png', bytes: 10, storedBytes: 10, width: 800, height: 600, variants: { original: 'k/photo' } },
    })
  ).id;
});

afterAll(async () => {
  await resetTestData(prisma);
  await prisma.$disconnect();
});

describe('loadAbout', () => {
  it('returns null when the tab is off or nothing is filled in', async () => {
    expect(await loadAbout(await route())).toBeNull();
    await prisma.menuAbout.create({ data: { menuId: x.menu.id, story: { en: [para('Hello')] } } });
    expect(await loadAbout(await route())).not.toBeNull();
    await prisma.menu.update({ where: { id: x.menu.id }, data: { aboutEnabled: false } });
    expect(await loadAbout(await route())).toBeNull();
  });

  it('is off when the plan does not hold the feature', async () => {
    await prisma.menuAbout.create({ data: { menuId: x.menu.id, story: { en: [para('Hello')] } } });
    await prisma.restaurant.update({ where: { id: x.restaurant.id }, data: { plan: 'BASIC' } });
    expect(await loadAbout(await route())).toBeNull();
  });

  it('resolves missing languages from the default, never blank', async () => {
    await prisma.menuAbout.create({
      data: { menuId: x.menu.id, titles: { en: 'Our home' }, story: { en: [para('English story')], ckb: [para('چیرۆک')] } },
    });
    await prisma.aboutOffer.create({ data: { menuId: x.menu.id, titles: { en: 'Lunch' }, bodies: { en: 'Soup' } } });
    const ar = await loadAbout(await route('ar'));
    expect(ar?.title).toBe('Our home');
    expect(ar?.story).toEqual([para('English story')]);
    expect(ar?.offers[0]).toMatchObject({ title: 'Lunch', body: 'Soup' });
    const ckb = await loadAbout(await route('ckb'));
    expect(ckb?.story).toEqual([para('چیرۆک')]);
  });

  it('shows the default title when the restaurant set none', async () => {
    await prisma.menuAbout.create({ data: { menuId: x.menu.id, story: { en: [para('Hello')] } } });
    expect((await loadAbout(await route()))?.title).toBe('Explore');
    expect((await loadAbout(await route('ar')))?.title).toBe('استكشف');
  });

  it('drops expired and not-yet-started offers and the inactive one', async () => {
    const day = 86_400_000;
    const now = Date.now();
    const make = (title: string, over: object = {}) => prisma.aboutOffer.create({ data: { menuId: x.menu.id, titles: { en: title }, ...over } });
    await make('live', { endsAt: new Date(now + day) });
    await make('expired', { endsAt: new Date(now - day) });
    await make('future', { startsAt: new Date(now + day) });
    await make('off', { active: false });
    const view = await loadAbout(await route());
    expect(view?.offers.map((o) => o.title)).toEqual(['live']);
    expect(view?.offers[0]?.until?.getTime()).toBe(now + day);
  });

  it('links an offer to a dish of the menu, and drops the link when the dish is hidden or gone', async () => {
    const offer = await prisma.aboutOffer.create({ data: { menuId: x.menu.id, titles: { en: 'Coffee deal' }, productId: x.product.id } });
    const linked = await loadAbout(await route());
    expect(linked?.offers[0]?.link).toEqual({ kind: 'product', slug: x.product.slug });
    await prisma.product.update({ where: { id: x.product.id }, data: { isHidden: true } });
    expect((await loadAbout(await route()))?.offers[0]).toMatchObject({ title: 'Coffee deal', link: null });
    await prisma.product.update({ where: { id: x.product.id }, data: { isHidden: false } });
    await prisma.aboutOffer.update({ where: { id: offer.id }, data: { productId: 'gone', categoryId: null } });
    expect((await loadAbout(await route()))?.offers[0]).toMatchObject({ link: null });
    await prisma.aboutOffer.update({ where: { id: offer.id }, data: { productId: null, categoryId: x.category.id } });
    expect((await loadAbout(await route()))?.offers[0]?.link).toEqual({ kind: 'category', slug: x.category.slug });
  });

  it('reads hours and contact from the restaurant, and honours the page switches', async () => {
    await prisma.restaurant.update({
      where: { id: x.restaurant.id },
      data: { address: 'Main St', city: 'Erbil', phone: '+9647501234567', workingHours: { mon: [['18:00', '02:00']] } },
    });
    await prisma.menuAbout.create({ data: { menuId: x.menu.id, story: { en: [para('Hello')] } } });
    const view = await loadAbout(await route());
    expect(view?.hours?.[0]).toEqual({ day: 'mon', ranges: [{ open: '18:00', close: '02:00', overnight: true }] });
    expect(view?.address).toBe('Main St, Erbil');
    expect(view?.contacts.phone).toBe('+9647501234567');
    await prisma.menuAbout.update({ where: { menuId: x.menu.id }, data: { showHours: false, showContact: false } });
    const hidden = await loadAbout(await route());
    expect(hidden?.hours).toBeNull();
    expect(hidden?.address).toBeNull();
    expect(hidden?.contacts).toEqual({});
  });

  it('carries the menu time zone and today in that zone, for the hours table', async () => {
    await prisma.menuAbout.create({ data: { menuId: x.menu.id, story: { en: [para('Hello')] } } });
    const view = await loadAbout(await route());
    expect(view?.timeZone).toBe('Asia/Baghdad');
    expect(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']).toContain(view?.today);
  });

  it('shows hours as nothing, never NaN, when the week is empty', async () => {
    await prisma.menuAbout.create({ data: { menuId: x.menu.id, story: { en: [para('Hello')] } } });
    expect((await loadAbout(await route()))?.hours).toBeNull();
  });

  it('resolves the cover and gallery and skips a gallery id that is not a picture of this restaurant', async () => {
    const foreignRestaurant = await prisma.restaurant.create({ data: { name: 'Other' } });
    const foreign = await prisma.mediaAsset.create({
      data: { restaurantId: foreignRestaurant.id, kind: 'IMAGE', storageKey: 'k/foreign', contentHash: 'h-foreign', mime: 'image/png', bytes: 10, storedBytes: 10, width: 10, height: 10, variants: { original: 'k/foreign' } },
    });
    const video = await prisma.mediaAsset.create({
      data: { restaurantId: x.restaurant.id, kind: 'VIDEO', storageKey: 'k/video', contentHash: 'h-video', mime: 'video/mp4', bytes: 10, storedBytes: 10, width: 10, height: 10, variants: { original: 'k/video' } },
    });
    await prisma.menuAbout.create({ data: { menuId: x.menu.id, coverAssetId: photo, galleryAssetIds: [photo, foreign.id, video.id] } });
    const view = await loadAbout(await route());
    expect(view?.cover).toMatchObject({ kind: 'image', width: 800, height: 600, assetId: photo });
    expect(view?.gallery).toHaveLength(1);
  });

  it('puts the restaurant title in the tenant extras, so the header needs no extra query', async () => {
    await prisma.menuAbout.create({ data: { menuId: x.menu.id, titles: { ar: 'عنّا' }, story: { en: [para('Hello')] } } });
    const tenant = (await route()).tenant;
    expect(tenant.extras.aboutTitle).toEqual({ en: '', ar: 'عنّا', ckb: '' });
  });
});
