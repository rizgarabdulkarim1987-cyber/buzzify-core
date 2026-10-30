import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { databaseUrl, TEST_DB } from '../../scripts/db-config';
import { createMenuFixture, resetTestData, testPrisma } from '../helpers/db';

process.env.DATABASE_URL = databaseUrl(TEST_DB);
const prisma = testPrisma();

type Handler = (request: Request, ctx: { params: Promise<{ tenant: string }> }) => Promise<Response>;
let POST: Handler;
let x: Awaited<ReturnType<typeof createMenuFixture>>;
let n = 0;

const SLUG = 'views-route';
const ctx = { params: Promise.resolve({ tenant: SLUG }) };
const send = (body: unknown, { cookie, address = `10.1.0.${++n}`, agent = 'Mozilla/5.0 (iPhone) Safari/604.1' }: { cookie?: string; address?: string; agent?: string } = {}) =>
  POST(
    new Request(`http://localhost/api/${SLUG}/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': address, 'user-agent': agent, ...(cookie ? { cookie } : {}) },
      body: JSON.stringify(body),
    }),
    ctx,
  );
const productView = (productId: string) => ({ anonymousSessionId: 'session-12345', events: [{ type: 'PRODUCT_VIEW', productId }] });

beforeEach(async () => {
  await resetTestData(prisma);
  x = await createMenuFixture(prisma, SLUG);
  POST ??= (await import('@/app/api/[tenant]/events/route')).POST;
});

afterAll(async () => {
  await resetTestData(prisma);
  await prisma.$disconnect();
});

describe('POST events: dish views', () => {
  it('counts a dish opening, hands the guest a signed key, and counts it once for that guest', async () => {
    const first = await send(productView(x.product.id), { address: '10.2.0.1' });
    expect(first.status).toBe(204);
    const cookie = (first.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
    expect(cookie).toMatch(/^bz_guest=/);
    expect((await prisma.productViewTotal.findFirstOrThrow({ where: { productId: x.product.id } })).views).toBe(1);

    const again = await send(productView(x.product.id), { cookie, address: '10.2.0.1' });
    expect(again.headers.get('set-cookie')).toBeNull();
    expect((await prisma.productViewTotal.findFirstOrThrow({ where: { productId: x.product.id } })).views).toBe(1);
  });

  it('clearing cookies does not raise the count past three from one address', async () => {
    for (let k = 0; k < 5; k++) await send(productView(x.product.id), { address: '10.2.0.9' });
    expect((await prisma.productViewTotal.findFirstOrThrow({ where: { productId: x.product.id } })).views).toBe(3);
  });

  it('cannot be inflated by writing a different X-Forwarded-For on every request', async () => {
    for (let k = 0; k < 5; k++) await send(productView(x.product.id), { address: `spoofed-${k}, 10.9.9.9` });
    expect((await prisma.productViewTotal.findFirstOrThrow({ where: { productId: x.product.id } })).views).toBe(3);
  });

  it('looks at no more than ten dishes in one request', async () => {
    const ids: string[] = [];
    for (let k = 0; k < 12; k++) ids.push((await prisma.product.create({ data: { menuId: x.menu.id, categoryId: x.category.id, slug: `many-${k}`, basePrice: 100, translations: { en: { name: `M${k}` } } } })).id);
    await send({ anonymousSessionId: 'session-12345', events: ids.map((productId) => ({ type: 'PRODUCT_VIEW', productId })) }, { address: '10.3.0.1' });
    expect(await prisma.productViewTotal.count()).toBe(10);
  });

  it('does not count a bot, and sets no cookie when no dish was opened', async () => {
    await send(productView(x.product.id), { agent: 'Googlebot/2.1' });
    expect(await prisma.productViewTotal.count()).toBe(0);
    const menuOnly = await send({ anonymousSessionId: 'session-12345', events: [{ type: 'MENU_VIEW' }] });
    expect(menuOnly.headers.get('set-cookie')).toBeNull();
  });
});
