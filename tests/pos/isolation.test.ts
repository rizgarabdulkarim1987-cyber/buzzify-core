import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '@/generated/prisma/client';
import { getCatalog, getTenant } from '@/server/data/public-menu';
import { overview } from '@/server/studio/queries/overview';
import { databaseUrl, TEST_DB } from '../../scripts/db-config';
import { seedAtelier } from '../helpers/db';
import { ask, dataOf, person, resetWorld, useTestDatabase, type Person } from './fixture';

vi.mock('next/headers', () => ({ headers: vi.fn(), cookies: vi.fn() }));

/**
 * A restaurant that only has the menu must be untouched by the cashier: the guests' pages, the quote route and the
 * Studio's own reads never query a till table. The application's client is swapped for one that logs every statement.
 */

const globalForPrisma = globalThis as unknown as { __prisma?: PrismaClient };

type RouteModule = { POST: (request: Request, ctx: { params: Promise<{ tenant: string }> }) => Promise<Response> };

const statements: string[] = [];
let client: PrismaClient;
let owner: Person;

beforeAll(async () => {
  useTestDatabase();
  const logged = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl(TEST_DB) }), log: [{ emit: 'event', level: 'query' }] });
  logged.$on('query', (event) => {
    statements.push(event.query);
  });
  client = logged as unknown as PrismaClient;
  globalForPrisma.__prisma = client;
  await resetWorld();
  const { restaurant } = await seedAtelier(client);
  owner = await person('menu-owner', { membership: [restaurant.id, 'OWNER'] });
});

afterAll(async () => {
  await resetWorld();
  await client.$disconnect();
  delete globalForPrisma.__prisma;
});

describe('a menu-only restaurant', () => {
  it('reads no till table for the public menu, the quote route or the Studio overview', async () => {
    statements.length = 0;

    const tenant = await getTenant('atelier');
    expect(tenant).not.toBeNull();
    await getCatalog(tenant!);

    const quote = (await import('@/app/api/[tenant]/quote/route')) as RouteModule;
    const product = await client.product.findFirstOrThrow({ where: { menu: { slug: 'atelier' } } });
    statements.length = 0;
    const response = await quote.POST(
      new Request('http://localhost/api/atelier/quote', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.1.1.1' },
        body: JSON.stringify({ lines: [{ productId: product.id, quantity: 1 }] }),
      }),
      { params: Promise.resolve({ tenant: 'atelier' }) },
    );
    expect(response.status).toBeLessThan(500);

    dataOf(await ask(owner, overview, {}));

    expect(statements.length).toBeGreaterThan(0);
    expect(statements.filter((sql) => /"Pos[A-Za-z]*"/.test(sql))).toEqual([]);
  });

  it('answers the QR availability and order routes closed without reading a till table', async () => {
    const availability = (await import('@/app/api/[tenant]/qr-order/availability/route')) as unknown as {
      GET: (request: Request, ctx: { params: Promise<{ tenant: string }> }) => Promise<Response>;
    };
    const order = (await import('@/app/api/[tenant]/qr-order/route')) as unknown as RouteModule;
    const product = await client.product.findFirstOrThrow({ where: { menu: { slug: 'atelier' } } });
    const ctx = { params: Promise.resolve({ tenant: 'atelier' }) };
    statements.length = 0;

    const open = await availability.GET(new Request('http://localhost/api/atelier/qr-order/availability?table=1', { headers: { 'x-forwarded-for': '10.1.2.1' } }), ctx);
    expect(await open.json()).toEqual({ available: false });

    const posted = await order.POST(
      new Request('http://localhost/api/atelier/qr-order', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.1.2.2' },
        body: JSON.stringify({ table: 1, locale: 'en', cart: { lines: [{ productId: product.id, quantity: 1 }], bundles: [] } }),
      }),
      ctx,
    );
    expect(posted.status).toBe(404);

    expect(statements.length).toBeGreaterThan(0);
    expect(statements.filter((sql) => /"Pos[A-Za-z]*"/.test(sql))).toEqual([]);
  });
});
