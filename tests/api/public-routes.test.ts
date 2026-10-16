import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { databaseUrl, TEST_DB } from '../../scripts/db-config';
import { createMenuFixture, publishFixture, resetTestData, seedAtelier, testPrisma } from '../helpers/db';

process.env.DATABASE_URL = databaseUrl(TEST_DB);
const prisma = testPrisma();

type Handler<P> = (request: Request, ctx: { params: Promise<P> }) => Promise<Response>;
let menuEntry: Handler<{ tenant: string }>;
let tableEntry: Handler<{ tenant: string; table: string }>;

function enter(slug: string, { search = '', language }: { search?: string; language?: string } = {}) {
  const request = new Request(`http://localhost/${slug}${search}`, {
    headers: language ? { 'accept-language': language } : {},
  });
  return menuEntry(request, { params: Promise.resolve({ tenant: slug }) });
}

function enterTable(slug: string, table: string, { search = '', language }: { search?: string; language?: string } = {}) {
  const request = new Request(`http://localhost/${slug}/t/${table}${search}`, {
    headers: language ? { 'accept-language': language } : {},
  });
  return tableEntry(request, { params: Promise.resolve({ tenant: slug, table }) });
}

beforeAll(async () => {
  await resetTestData(prisma);
  await seedAtelier(prisma);

  // A menu that was renamed: `old-name` is a historical slug of the menu now called `new-name`.
  const renamed = await createMenuFixture(prisma, 'old-name');
  await prisma.menu.update({ where: { id: renamed.menu.id }, data: { slug: 'new-name' } });
  await prisma.menuSlug.create({ data: { slug: 'new-name', menuId: renamed.menu.id } });

  const paused = await createMenuFixture(prisma, 'paused-cafe');
  await prisma.menu.update({ where: { id: paused.menu.id }, data: { status: 'SUSPENDED' } });

  await createMenuFixture(prisma, 'unpublished-cafe', { publish: false });

  // Offers Arabic and English only, and opens in Arabic.
  const gulf = await createMenuFixture(prisma, 'gulf-cafe', { publish: false });
  await prisma.menu.update({ where: { id: gulf.menu.id }, data: { locales: ['ar', 'en'], defaultLocale: 'ar' } });
  await publishFixture(prisma, gulf.menu.id);

  menuEntry = (await import('@/app/[tenant]/route')).GET;
  tableEntry = (await import('@/app/[tenant]/t/[table]/route')).GET;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('GET /{slug}', () => {
  it('sends a visitor with no language preference to the menu in its default language', async () => {
    const response = await enter('atelier');
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('/atelier/en');
  });

  it('negotiates the language from Accept-Language and says the answer depends on it', async () => {
    const response = await enter('atelier', { language: 'ar-IQ,ar;q=0.9,en;q=0.5' });
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('/atelier/ar');
    expect(response.headers.get('vary')?.toLowerCase()).toContain('accept-language');
  });

  it('maps Kurdish to Sorani', async () => {
    expect((await enter('atelier', { language: 'ku-IQ' })).headers.get('location')).toBe('/atelier/ckb');
  });

  it('keeps the query string', async () => {
    const response = await enter('atelier', { search: '?utm_source=qr&x=1' });
    expect(response.headers.get('location')).toBe('/atelier/en?utm_source=qr&x=1');
  });

  it('only offers languages the menu has, and falls back to its default language', async () => {
    expect((await enter('gulf-cafe', { language: 'ckb' })).headers.get('location')).toBe('/gulf-cafe/ar');
    expect((await enter('gulf-cafe', { language: 'en' })).headers.get('location')).toBe('/gulf-cafe/en');
    expect((await enter('gulf-cafe')).headers.get('location')).toBe('/gulf-cafe/ar');
  });

  it('sends a former slug straight to the current one', async () => {
    const response = await enter('old-name', { search: '?x=1', language: 'ar' });
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('/new-name/ar?x=1');
  });

  it('keeps a suspended menu on its own URL, where the neutral page is shown', async () => {
    const response = await enter('paused-cafe', { language: 'ar' });
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('/paused-cafe/ar');
  });

  it('answers 404 for an unknown, unpublished or malformed slug', async () => {
    for (const slug of ['nope', 'unpublished-cafe', 'Atelier', '..', 'a b', 'x'.repeat(60)]) {
      expect((await enter(slug)).status, slug).toBe(404);
    }
  });
});

describe('GET /{slug}/t/{table}', () => {
  it('sends the QR link to the table page in the visitor’s language', async () => {
    const response = await enterTable('atelier', '04', { language: 'ar' });
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('/atelier/ar/t/04');
    expect((await enterTable('atelier', '04')).headers.get('location')).toBe('/atelier/en/t/04');
  });

  it('keeps the query string and follows a former slug', async () => {
    const response = await enterTable('old-name', '7', { search: '?src=qr' });
    expect(response.headers.get('location')).toBe('/new-name/en/t/7?src=qr');
  });

  it('answers 404 when the menu is missing', async () => {
    expect((await enterTable('nope', '04')).status).toBe(404);
    expect((await enterTable('unpublished-cafe', '04')).status).toBe(404);
  });

  it('encodes the table so it cannot change the destination', async () => {
    const response = await enterTable('atelier', '../../studio?x#', {});
    expect(response.status).toBe(307);
    const location = response.headers.get('location') ?? '';
    expect(location.startsWith('/atelier/en/t/')).toBe(true);
    expect(new URL(location, 'http://localhost').pathname.split('/')).toHaveLength(5);
  });
});
