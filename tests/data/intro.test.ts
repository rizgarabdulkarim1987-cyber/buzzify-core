import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { expireMenu } from '@/server/data/cache';
import { loadIntro } from '@/server/data/intro';
import { resolvePublicMenu } from '@/server/data/public-menu';
import { databaseUrl, TEST_DB } from '../../scripts/db-config';
import { createMenuFixture, resetTestData, testPrisma } from '../helpers/db';

process.env.DATABASE_URL = databaseUrl(TEST_DB);
const prisma = testPrisma();

type Fixture = Awaited<ReturnType<typeof createMenuFixture>>;
let x: Fixture;
let ownPhoto = '';
let sharedPhoto = '';
let video = '';
const DAY = 86_400_000;

async function tenant() {
  expireMenu(['intro-x'], x.menu.id);
  const result = await resolvePublicMenu('intro-x');
  if (result.kind !== 'live') throw new Error('the fixture menu is not live');
  return result.tenant;
}

const asset = (restaurantId: string | null, label: string, kind: 'IMAGE' | 'VIDEO' = 'IMAGE') =>
  prisma.mediaAsset
    .create({
      data: {
        restaurantId,
        kind,
        storageKey: `k/${label}`,
        contentHash: `h-${label}`,
        mime: kind === 'VIDEO' ? 'video/mp4' : 'image/png',
        bytes: 10,
        storedBytes: 10,
        width: 800,
        height: 600,
        variants: kind === 'VIDEO' ? { original: `k/${label}`, poster: { webp: { '640': `k/${label}-p` } } } : { original: `k/${label}` },
      },
    })
    .then((row) => row.id);

const advert = (over: Record<string, unknown> = {}) =>
  prisma.platformAdvert.create({ data: { imageAssetId: sharedPhoto, alts: { en: 'Sale', ar: 'تخفيض' }, href: 'https://example.com', restaurantIds: [], menuIds: [], ...over } });

beforeEach(async () => {
  await resetTestData(prisma);
  x = await createMenuFixture(prisma, 'intro-x');
  await prisma.restaurant.update({ where: { id: x.restaurant.id }, data: { plan: 'PREMIUM' } });
  await prisma.menu.update({ where: { id: x.menu.id }, data: { introEnabled: true } });
  ownPhoto = await asset(x.restaurant.id, 'own');
  sharedPhoto = await asset(null, 'shared');
  video = await asset(x.restaurant.id, 'video', 'VIDEO');
});

afterAll(async () => {
  await resetTestData(prisma);
  await prisma.$disconnect();
});

describe('loadIntro', () => {
  it('is null when the menu switched the intro off, and shows on every plan', async () => {
    expect(await loadIntro(await tenant(), 'en', new Date())).not.toBeNull();
    await prisma.menu.update({ where: { id: x.menu.id }, data: { introEnabled: false } });
    expect(await loadIntro(await tenant(), 'en', new Date())).toBeNull();
    await prisma.menu.update({ where: { id: x.menu.id }, data: { introEnabled: true } });
    await prisma.restaurant.update({ where: { id: x.restaurant.id }, data: { plan: 'BASIC' } });
    expect(await loadIntro(await tenant(), 'en', new Date())).not.toBeNull();
  });

  it('is off for one restaurant when the Super Admin switches the feature off', async () => {
    await prisma.restaurant.update({ where: { id: x.restaurant.id }, data: { plan: 'BASIC', planExtras: { features: { 'menu.intro': false } } } });
    expect(await loadIntro(await tenant(), 'en', new Date())).toBeNull();
  });

  it('carries the languages of the menu with its default first', async () => {
    const view = await loadIntro(await tenant(), 'en', new Date());
    expect(view?.defaultLocale).toBe('en');
    expect(view?.locales).toEqual(['en', 'ar', 'ckb']);
  });

  it('falls back from the menu background to the platform default, then to none', async () => {
    expect((await loadIntro(await tenant(), 'en', new Date()))?.background).toBeNull();
    await prisma.platformIntro.create({ data: { id: 'singleton', backgroundAssetId: sharedPhoto } });
    expect((await loadIntro(await tenant(), 'en', new Date()))?.background).toMatchObject({ kind: 'image', width: 800, height: 600 });
    await prisma.menuIntro.create({ data: { menuId: x.menu.id, backgroundAssetId: video } });
    expect((await loadIntro(await tenant(), 'en', new Date()))?.background).toMatchObject({ kind: 'video' });
    await prisma.menuIntro.update({ where: { menuId: x.menu.id }, data: { backgroundAssetId: ownPhoto } });
    expect((await loadIntro(await tenant(), 'en', new Date()))?.background).toMatchObject({ kind: 'image' });
  });

  it('ignores a background that is another restaurant picture', async () => {
    const other = await prisma.restaurant.create({ data: { name: 'Other' } });
    const foreign = await asset(other.id, 'foreign');
    await prisma.menuIntro.create({ data: { menuId: x.menu.id, backgroundAssetId: foreign } });
    expect((await loadIntro(await tenant(), 'en', new Date()))?.background).toBeNull();
  });

  it('drops adverts outside their window, inactive ones, and one whose asset belongs to another restaurant', async () => {
    const other = await prisma.restaurant.create({ data: { name: 'Other' } });
    const foreign = await asset(other.id, 'foreign');
    const now = new Date();
    await advert({ sortOrder: 0 });
    await advert({ endsAt: new Date(now.getTime() - DAY) });
    await advert({ startsAt: new Date(now.getTime() + DAY) });
    await advert({ active: false });
    await advert({ imageAssetId: foreign });
    expect((await loadIntro(await tenant(), 'en', now))?.adverts).toHaveLength(1);
  });

  it('shows an advert by its restaurants and menus: none listed means all, otherwise either', async () => {
    const other = await prisma.restaurant.create({ data: { name: 'Other' } });
    await advert({ restaurantIds: [other.id] });
    expect((await loadIntro(await tenant(), 'en', new Date()))?.adverts).toHaveLength(0);
    await advert({ menuIds: [x.menu.id] });
    await advert({ restaurantIds: [x.restaurant.id] });
    await advert({});
    expect((await loadIntro(await tenant(), 'en', new Date()))?.adverts).toHaveLength(3);
  });

  it('gives each advert its alt text in the guest language, else the default, and drops an unsafe link', async () => {
    await advert({});
    await advert({ href: 'javascript:alert(1)', alts: { en: 'Plain' }, sortOrder: 1 });
    const ar = (await loadIntro(await tenant(), 'ar', new Date()))?.adverts;
    expect(ar?.[0]).toMatchObject({ alt: 'تخفيض', linked: true });
    expect(ar?.[1]).toMatchObject({ alt: 'Plain', linked: false });
  });

  it('omits a contact that is empty or unsafe, and all of them when showContact is off', async () => {
    await prisma.restaurant.update({
      where: { id: x.restaurant.id },
      data: { phone: '+9647501234567', whatsapp: '', mapUrl: 'javascript:1', socialLinks: { instagram: 'https://instagram.com/x', facebook: 'http://insecure.example', tiktok: '' } },
    });
    const view = await loadIntro(await tenant(), 'en', new Date());
    expect(view?.contacts).toEqual([
      { kind: 'instagram', href: 'https://instagram.com/x' },
      { kind: 'phone', href: 'tel:+9647501234567' },
    ]);
    await prisma.menuIntro.create({ data: { menuId: x.menu.id, showContact: false } });
    expect((await loadIntro(await tenant(), 'en', new Date()))?.contacts).toEqual([]);
  });

  it('carries the overlay and the logo switch of the menu, with defaults when nothing is saved', async () => {
    expect(await loadIntro(await tenant(), 'en', new Date())).toMatchObject({ overlay: 50, showLogo: true });
    await prisma.menuIntro.create({ data: { menuId: x.menu.id, overlay: 20, showLogo: false } });
    expect(await loadIntro(await tenant(), 'en', new Date())).toMatchObject({ overlay: 20, showLogo: false, logo: null });
  });
});
