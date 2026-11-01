import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET as shareCard } from '@/app/api/[tenant]/share-card/route';
import { DEFAULT_PALETTES } from '@/lib/brand';
import { CARD, renderDishCard } from '@/server/share/dish-card';
import { publishFixture } from '../helpers/db';
import { prisma, resetWorld, restaurant, useTestDatabase } from './fixture';

vi.mock('next/headers', () => ({ headers: vi.fn(), cookies: vi.fn() }));

const globalForPrisma = globalThis as unknown as { __prisma?: unknown };

let counter = 0;
let slug = '';
let ip = 0;

async function world(plan: 'BASIC' | 'PRO' = 'PRO') {
  slug = `card-${++counter}`;
  const id = (await restaurant(`Card ${counter}`, 'ACTIVE')).id;
  await prisma().restaurant.update({ where: { id }, data: { plan } });
  const menu = await prisma().menu.create({ data: { restaurantId: id, name: 'm', slug, currency: 'IQD', locales: ['en', 'ar'], defaultLocale: 'en', timezone: 'Asia/Baghdad' } });
  await prisma().menuSlug.create({ data: { slug, menuId: menu.id } });
  const category = await prisma().category.create({ data: { menuId: menu.id, slug: 'food', sortOrder: 1, translations: { en: { name: 'Food' }, ar: { name: 'طعام' } } } });
  await prisma().product.create({
    data: { menuId: menu.id, categoryId: category.id, slug: 'burger', sortOrder: 1, basePrice: 5000, translations: { en: { name: 'Burger' }, ar: { name: 'برغر لحم مشوي' } } },
  });
  await publishFixture(prisma(), menu.id);
}

const get = (query: string) =>
  shareCard(new Request(`http://localhost/api/${slug}/share-card?${query}`, { headers: { 'x-forwarded-for': `10.7.0.${++ip}` } }), { params: Promise.resolve({ tenant: slug }) });

beforeAll(() => {
  useTestDatabase();
});

beforeEach(async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  await resetWorld();
});

afterAll(async () => {
  await resetWorld();
  await prisma().$disconnect();
  delete globalForPrisma.__prisma;
});

describe('the dish card picture', () => {
  const input = { name: 'Burger', price: '5,000 IQD', restaurant: 'Atelier', palette: DEFAULT_PALETTES.dark, photo: null };

  it('is a portrait PNG of the card size, with or without a photo', async () => {
    const plain = await sharp(await renderDishCard(input)).metadata();
    expect([plain.format, plain.width, plain.height]).toEqual(['png', CARD.width, CARD.height]);
    const photo = await sharp({ create: { width: 400, height: 300, channels: 3, background: '#cc6633' } }).jpeg().toBuffer();
    const withPhoto = await sharp(await renderDishCard({ ...input, photo })).metadata();
    expect([withPhoto.width, withPhoto.height]).toEqual([CARD.width, CARD.height]);
  });

  it('draws Arabic names and very long names without failing', async () => {
    const arabic = await renderDishCard({ ...input, name: 'برغر لحم مشوي', price: '٥٬٠٠٠ د.ع', restaurant: 'أتيليه' });
    expect((await sharp(arabic).metadata()).height).toBe(CARD.height);
    const mixed = await renderDishCard({ ...input, name: 'فلات وايت Flat White', price: '٥٬٠٠٠ د.ع‏', restaurant: 'ATELIER' });
    expect((await sharp(mixed).metadata()).height).toBe(CARD.height);
    const long = await renderDishCard({ ...input, name: 'Extraordinarily-long-dishname-without-any-spaces-at-all-'.repeat(3) });
    expect((await sharp(long).metadata()).width).toBe(CARD.width);
  });
});

describe('the share card route', () => {
  it('serves a PNG for a dish, in the asked language', async () => {
    await world();
    for (const locale of ['en', 'ar']) {
      const response = await get(`slug=burger&locale=${locale}`);
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('image/png');
      expect((await sharp(Buffer.from(await response.arrayBuffer())).metadata()).width).toBe(CARD.width);
    }
  });

  it('answers 404 on a plan without the feature or a dish that does not exist, and 400 on a bad name', async () => {
    await world('BASIC');
    expect((await get('slug=burger&locale=en')).status).toBe(404);
    await world('PRO');
    expect((await get('slug=nothing&locale=en')).status).toBe(404);
    expect((await get('slug=BAD%20NAME')).status).toBe(400);
  });
});
