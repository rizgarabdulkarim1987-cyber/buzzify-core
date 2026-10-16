import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { databaseUrl, TEST_DB } from '../../scripts/db-config';
import { createMenuFixture, resetTestData, seedAtelier, testPrisma } from '../helpers/db';

process.env.DATABASE_URL = databaseUrl(TEST_DB);
const prisma = testPrisma();

type RouteModule = { POST: (request: Request, ctx: { params: Promise<{ tenant: string }> }) => Promise<Response> };

let quote: RouteModule;
let suggestions: RouteModule;
let events: RouteModule;
let searchIndex: RouteModule;
let atelier: Awaited<ReturnType<typeof prisma.menu.findUniqueOrThrow>>;
let burgerId = '';
let friesId = '';
let otherTenantProductId = '';
let burgerSetId = '';
let cheeseOptionId = '';
let ipCounter = 0;

function post(route: RouteModule, tenant: string, body: unknown, init: { raw?: string; ip?: string } = {}) {
  ipCounter += 1;
  const request = new Request(`http://localhost/api/${tenant}/x`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': init.ip ?? `10.0.0.${ipCounter}` },
    body: init.raw ?? JSON.stringify(body),
  });
  return route.POST(request, { params: Promise.resolve({ tenant }) });
}

describe('public API', () => {
  beforeAll(async () => {
    await resetTestData(prisma);
    await seedAtelier(prisma);
    const other = await createMenuFixture(prisma, 'other-cafe');
    otherTenantProductId = other.product.id;
    atelier = await prisma.menu.findUniqueOrThrow({ where: { slug: 'atelier' } });
    const products = await prisma.product.findMany({ where: { menuId: atelier.id } });
    burgerId = products.find((p) => p.slug === 'atelier-burger')!.id;
    friesId = products.find((p) => p.slug === 'truffle-fries')!.id;
    const bundle = await prisma.bundle.findFirstOrThrow({ where: { menuId: atelier.id, slug: 'burger-set' } });
    burgerSetId = bundle.id;
    const cheese = await prisma.modifierOption.findFirstOrThrow({
      where: { menuId: atelier.id, group: { productId: burgerId } },
      orderBy: { sortOrder: 'asc' },
    });
    cheeseOptionId = cheese.id;
    quote = (await import('@/app/api/[tenant]/quote/route')) as RouteModule;
    suggestions = (await import('@/app/api/[tenant]/suggestions/route')) as RouteModule;
    events = (await import('@/app/api/[tenant]/events/route')) as RouteModule;
    searchIndex = (await import('@/app/api/[tenant]/search-index/route')) as RouteModule;
  });

  afterAll(async () => {
    await resetTestData(prisma);
    await prisma.$disconnect();
  });

  describe('quote', () => {
    it('prices from the database and ignores any client-supplied price', async () => {
      const response = await post(quote, 'atelier', {
        locale: 'en',
        cart: {
          lines: [{ productId: burgerId, variantId: null, optionIds: [cheeseOptionId], quantity: 2, price: 1, unitPrice: 1 }],
          bundles: [],
        },
        subtotal: 1,
      });
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.quote.subtotal).toBe(2000);
      expect(body.quote.lines[0].name).toBe('Atelier Burger');
      expect(body.quote.lines[0].optionNames).toEqual(['Premium cheese']);
    });

    it('flags a stale or foreign product instead of failing', async () => {
      const response = await post(quote, 'atelier', {
        locale: 'en',
        cart: {
          lines: [
            { productId: otherTenantProductId, variantId: null, optionIds: [], quantity: 1 },
            { productId: friesId, variantId: null, optionIds: [], quantity: 1 },
          ],
          bundles: [],
        },
      });
      expect(response.status).toBe(200);
      const { quote: result } = await response.json();
      expect(result.lines[0].issues[0].code).toBe('UNKNOWN_PRODUCT');
      expect(result.subtotal).toBe(550);
      expect(result.hasBlockingIssues).toBe(true);
    });

    it('prices a bundle at its bundle price', async () => {
      const response = await post(quote, 'atelier', {
        locale: 'en',
        cart: { lines: [], bundles: [{ bundleId: burgerSetId, quantity: 1 }] },
      });
      const { quote: result } = await response.json();
      expect(result.subtotal).toBe(1550);
      expect(result.bundles[0].savings).toBe(200);
    });

    it('returns 404 for an unknown tenant and for a malformed slug', async () => {
      expect((await post(quote, 'nope', { locale: 'en', cart: { lines: [], bundles: [] } })).status).toBe(404);
      expect((await post(quote, "x'--", { locale: 'en', cart: { lines: [], bundles: [] } })).status).toBe(404);
    });

    it('rejects invalid JSON, invalid shapes and oversized bodies', async () => {
      expect((await post(quote, 'atelier', null, { raw: '{not json' })).status).toBe(400);
      expect(
        (await post(quote, 'atelier', { locale: 'en', cart: { lines: [{ productId: burgerId, quantity: 99 }], bundles: [] } })).status,
      ).toBe(400);
      expect((await post(quote, 'atelier', { locale: 'xx', cart: { lines: [], bundles: [] } })).status).toBe(400);
      const huge = JSON.stringify({ locale: 'en', cart: { lines: [], bundles: [] }, pad: 'x'.repeat(40_000) });
      expect((await post(quote, 'atelier', null, { raw: huge })).status).toBe(413);
    });

    it('stops reading an oversized streamed body instead of buffering all of it', async () => {
      const counter = { pulled: 0 };
      const chunk = new Uint8Array(16 * 1024).fill(120);
      let sent = 0;
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (sent >= 200) {
            controller.close();
            return;
          }
          sent += 1;
          counter.pulled = sent;
          controller.enqueue(chunk);
        },
      });
      ipCounter += 1;
      const request = new Request('http://localhost/api/atelier/quote', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.0.1.${ipCounter}` },
        body,
        duplex: 'half',
      } as RequestInit);
      const response = await quote.POST(request, { params: Promise.resolve({ tenant: 'atelier' }) });
      expect(response.status).toBe(413);
      expect(counter.pulled).toBeLessThan(10);
    });

    it('rejects a declared content length above the cap without parsing the body', async () => {
      ipCounter += 1;
      const request = new Request('http://localhost/api/atelier/quote', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': '5000000',
          'x-forwarded-for': `10.0.2.${ipCounter}`,
        },
        body: '{}',
      });
      const response = await quote.POST(request, { params: Promise.resolve({ tenant: 'atelier' }) });
      expect(response.status).toBe(413);
    });

    it('rate limits a single client', async () => {
      const statuses: number[] = [];
      for (let i = 0; i < 62; i += 1) {
        const response = await post(quote, 'atelier', { locale: 'en', cart: { lines: [], bundles: [] } }, { ip: '203.0.113.9' });
        statuses.push(response.status);
      }
      expect(statuses.filter((s) => s === 200).length).toBe(60);
      expect(statuses.slice(60)).toEqual([429, 429]);
    });
  });

  describe('suggestions', () => {
    it('returns upgrades and pairings for a product', async () => {
      const response = await post(suggestions, 'atelier', {
        context: 'product',
        locale: 'en',
        product: { productId: burgerId, variantId: null, optionIds: [] },
        cart: { lines: [], bundles: [] },
        dismissedIds: [],
      });
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.upgrades.map((u: { title: string }) => u.title)).toContain('Premium cheese');
      expect(body.pairings[0].name).toBe('Truffle Fries');
      expect(body.pairings[0].price).toBe(550);
      expect(body.pairings[0].slug).toBe('truffle-fries');
    });

    it('finds a bundle opportunity from the cart', async () => {
      const products = await prisma.product.findMany({ where: { menuId: atelier.id } });
      const idOf = (slug: string) => products.find((p) => p.slug === slug)!.id;
      const response = await post(suggestions, 'atelier', {
        context: 'cart',
        locale: 'en',
        cart: {
          lines: ['atelier-burger', 'truffle-fries', 'sparkling-water'].map((slug) => ({
            productId: idOf(slug),
            variantId: null,
            optionIds: [],
            quantity: 1,
          })),
          bundles: [],
        },
        dismissedIds: [],
      });
      const body = await response.json();
      expect(body.bundles[0]).toMatchObject({ name: 'Burger set', savings: 200, times: 1 });
      expect(body.bundles[0].cartAfter.lines).toEqual([]);
      expect(body.bundles[0].cartAfter.bundles).toEqual([{ bundleId: burgerSetId, quantity: 1 }]);
    });

    it('works for the menu context with no cart', async () => {
      const response = await post(suggestions, 'atelier', { context: 'menu', locale: 'ar' });
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.signature?.productId).toBeTruthy();
    });
  });

  describe('search index', () => {
    it("returns every language's search text for this menu only", async () => {
      const response = await post(searchIndex, 'atelier', {});
      expect(response.status).toBe(200);
      const { keys } = (await response.json()) as { keys: Record<string, string> };
      expect(Object.keys(keys)).toContain(burgerId);
      expect(Object.keys(keys)).not.toContain(otherTenantProductId);
      // The burger is findable by its Arabic name, whichever language the page is in.
      expect(keys[burgerId]).toMatch(/[ء-ي]/);
    });

    it('returns 404 for an unknown tenant and 400 for a body that is not an object', async () => {
      expect((await post(searchIndex, 'nope-cafe', {})).status).toBe(404);
      expect((await post(searchIndex, 'atelier', [])).status).toBe(400);
    });
  });

  describe('events', () => {
    it('stores a batch and returns 204', async () => {
      const response = await post(events, 'atelier', {
        anonymousSessionId: 'session-abcdef12',
        tableNumber: 4,
        events: [{ type: 'MENU_VIEW' }, { type: 'PRODUCT_VIEW', productId: burgerId }],
      });
      expect(response.status).toBe(204);
      expect(await prisma.analyticsEvent.count({ where: { menuId: atelier.id } })).toBe(2);
    });

    it('rejects unknown event types and empty batches', async () => {
      const bad = await post(events, 'atelier', { anonymousSessionId: 'session-abcdef12', events: [{ type: 'HACK' }] });
      expect(bad.status).toBe(400);
      const empty = await post(events, 'atelier', { anonymousSessionId: 'session-abcdef12', events: [] });
      expect(empty.status).toBe(400);
    });
  });
});
