import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { countProductViews } from '@/server/data/product-views';
import { pruneProductViewMarks } from '@/server/http/rate-limit';
import { createMenuFixture, resetTestData, testPrisma } from '../helpers/db';

const prisma = testPrisma();
const NOW = new Date('2026-10-30T10:00:00Z');
const BROWSER = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1';

let x: Awaited<ReturnType<typeof createMenuFixture>>;
let other: Awaited<ReturnType<typeof createMenuFixture>>;

const view = (over: Partial<Parameters<typeof countProductViews>[1]> = {}) =>
  countProductViews(prisma, { menuId: x.menu.id, timeZone: 'Asia/Baghdad', guestKey: 'guest-a', ipHash: 'ip-a', userAgent: BROWSER, productIds: [x.product.id], now: NOW, ...over });
const total = async (productId = x.product.id) => (await prisma.productViewTotal.findFirst({ where: { productId } }))?.views ?? 0;

beforeEach(async () => {
  await resetTestData(prisma);
  x = await createMenuFixture(prisma, 'views-x');
  other = await createMenuFixture(prisma, 'views-y');
});

afterAll(async () => {
  await resetTestData(prisma);
  await prisma.$disconnect();
});

describe('countProductViews', () => {
  it('adds one view for a first opening', async () => {
    expect(await view()).toBe(1);
    expect(await total()).toBe(1);
  });

  it('counts a device once per dish per day, and again the next day', async () => {
    await view();
    expect(await view()).toBe(0);
    expect(await total()).toBe(1);
    expect(await view({ now: new Date('2026-10-31T10:00:00Z') })).toBe(1);
    expect(await total()).toBe(2);
  });

  it('counts one device once when two openings arrive together', async () => {
    await Promise.all([view(), view()]);
    expect(await total()).toBe(1);
  });

  it('counts at most three views per address and dish in a day, whatever the cookies', async () => {
    for (const key of ['g1', 'g2', 'g3', 'g4', 'g5']) await view({ guestKey: key });
    expect(await total()).toBe(3);
    expect(await prisma.productViewMark.count()).toBe(3);
  });

  it('keeps the address limit per dish', async () => {
    const second = await prisma.product.create({ data: { menuId: x.menu.id, categoryId: x.category.id, slug: 'second', basePrice: 100, translations: { en: { name: 'Second' } } } });
    for (const key of ['g1', 'g2', 'g3', 'g4']) await view({ guestKey: key });
    expect(await view({ guestKey: 'g5', productIds: [second.id] })).toBe(1);
  });

  it('does not count bots, crawlers, link previews or a missing user agent', async () => {
    for (const userAgent of ['Googlebot/2.1', 'WhatsApp/2.23', 'HeadlessChrome/120', null]) expect(await view({ userAgent })).toBe(0);
    expect(await total()).toBe(0);
  });

  it('does not count a dish of another menu, or one that does not exist', async () => {
    expect(await view({ productIds: [other.product.id, 'nope'] })).toBe(0);
    expect(await total(other.product.id)).toBe(0);
  });

  it('counts each different dish once in one call', async () => {
    const second = await prisma.product.create({ data: { menuId: x.menu.id, categoryId: x.category.id, slug: 'second', basePrice: 100, translations: { en: { name: 'Second' } } } });
    expect(await view({ productIds: [x.product.id, second.id, x.product.id] })).toBe(2);
  });
});

describe('pruneProductViewMarks', () => {
  it('removes old marks and keeps the totals', async () => {
    await view();
    await prisma.productViewMark.updateMany({ data: { createdAt: new Date(Date.now() - 4 * 86_400_000) } });
    expect(await pruneProductViewMarks(prisma, new Date(Date.now() - 3 * 86_400_000))).toBe(1);
    expect(await prisma.productViewMark.count()).toBe(0);
    expect(await total()).toBe(1);
  });
});
