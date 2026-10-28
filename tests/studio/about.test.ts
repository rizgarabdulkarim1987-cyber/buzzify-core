import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteAboutOffer, reorderAboutOffers, saveAbout, saveAboutOffer, setMenuAboutEnabled } from '@/server/studio/actions/about';
import { menuAbout } from '@/server/studio/queries/about';
import { ask, codeOf, dataOf, person, prisma, resetWorld, restaurant, run, useTestDatabase, type Person } from '../pos/fixture';

vi.mock('next/headers', () => ({ headers: vi.fn(), cookies: vi.fn() }));

const globalForPrisma = globalThis as unknown as { __prisma?: unknown };

let a: { id: string };
let b: { id: string };
let menuId = '';
let otherMenuId = '';
let owner: Person;
let stranger: Person;
let photo = '';
let video = '';
let foreign = '';
let productId = '';
let categoryId = '';
let foreignProductId = '';
let foreignCategoryId = '';

async function menuOf(restaurantId: string, slug: string) {
  const menu = await prisma().menu.create({ data: { restaurantId, name: slug, slug, currency: 'IQD', locales: ['en', 'ar'], defaultLocale: 'en', timezone: 'Asia/Baghdad' } });
  await prisma().menuSlug.create({ data: { slug, menuId: menu.id } });
  return menu.id;
}

async function asset(restaurantId: string | null, label: string, kind: 'IMAGE' | 'VIDEO', variants: object) {
  return (
    await prisma().mediaAsset.create({
      data: { restaurantId, kind, storageKey: `k/${label}`, contentHash: `h-${label}`, mime: kind === 'VIDEO' ? 'video/mp4' : 'image/png', bytes: 10, storedBytes: 10, width: 100, height: 100, variants },
    })
  ).id;
}

async function dishIn(menu: string, slug: string) {
  const category = await prisma().category.create({ data: { menuId: menu, slug: `c-${slug}`, translations: { en: { name: 'Food' } } } });
  const product = await prisma().product.create({ data: { menuId: menu, categoryId: category.id, slug, basePrice: 1000, translations: { en: { name: slug } } } });
  return { product: product.id, category: category.id };
}

const page = (over: Record<string, unknown> = {}) => ({
  menuId,
  titles: { en: 'About us' },
  coverAssetId: photo,
  story: { en: [{ type: 'paragraph', text: 'Since 1990.' }] },
  galleryAssetIds: [photo],
  showHours: true,
  showContact: true,
  ...over,
});
const offer = (over: Record<string, unknown> = {}) => ({
  menuId,
  titles: { en: 'Lunch deal' },
  bodies: { en: 'Soup and a main' },
  label: { en: '-20%' },
  imageAssetId: photo,
  startsAt: null,
  endsAt: null,
  active: true,
  productId: null,
  categoryId: null,
  ...over,
});

beforeAll(() => {
  useTestDatabase();
});

beforeEach(async () => {
  await resetWorld();
  a = await restaurant('About A', 'none');
  b = await restaurant('About B', 'none');
  menuId = await menuOf(a.id, 'about-a');
  otherMenuId = await menuOf(b.id, 'about-b');
  owner = await person('about-owner', { membership: [a.id, 'OWNER'] });
  stranger = await person('about-stranger', { membership: [b.id, 'OWNER'] });
  photo = await asset(a.id, 'photo', 'IMAGE', { original: 'k/photo' });
  video = await asset(a.id, 'video', 'VIDEO', { original: 'k/video', poster: { webp: { '320': 'k/p' } } });
  foreign = await asset(b.id, 'foreign', 'IMAGE', { original: 'k/foreign' });
  const mine = await dishIn(menuId, 'soup');
  productId = mine.product;
  categoryId = mine.category;
  const theirs = await dishIn(otherMenuId, 'kebab');
  foreignProductId = theirs.product;
  foreignCategoryId = theirs.category;
});

afterAll(async () => {
  await resetWorld();
  await prisma().$disconnect();
  delete globalForPrisma.__prisma;
});

describe('saving the page', () => {
  it('saves the page and the owner sees it back', async () => {
    dataOf(await run(owner, saveAbout, page()));
    dataOf(await run(owner, setMenuAboutEnabled, { menuId, enabled: true }));
    const read = dataOf(await ask(owner, menuAbout, { menuId }));
    expect(read.enabled).toBe(true);
    expect(read.about).toMatchObject({ coverAssetId: photo, galleryAssetIds: [photo], titles: { en: 'About us' } });
    expect(read.about.story.en?.[0]).toMatchObject({ text: 'Since 1990.' });
  });

  it("refuses another restaurant's cover, gallery photo or offer target", async () => {
    expect(codeOf(await run(owner, saveAbout, page({ coverAssetId: foreign })))).toBe('NOT_FOUND');
    expect(codeOf(await run(owner, saveAbout, page({ galleryAssetIds: [photo, foreign] })))).toBe('NOT_FOUND');
    expect(codeOf(await run(owner, saveAboutOffer, offer({ imageAssetId: foreign })))).toBe('NOT_FOUND');
    expect(codeOf(await run(owner, saveAboutOffer, offer({ productId: foreignProductId })))).toBe('NOT_FOUND');
    expect(codeOf(await run(owner, saveAboutOffer, offer({ categoryId: foreignCategoryId })))).toBe('NOT_FOUND');
    expect(await prisma().aboutOffer.count()).toBe(0);
    expect(await prisma().menuAbout.count()).toBe(0);
  });

  it('refuses a video in the gallery or as the cover', async () => {
    expect(codeOf(await run(owner, saveAbout, page({ galleryAssetIds: [video] })))).toBe('NOT_FOUND');
    expect(codeOf(await run(owner, saveAbout, page({ coverAssetId: video })))).toBe('NOT_FOUND');
  });

  it('refuses invalid story blocks and a gallery of more than 24 photos', async () => {
    expect(codeOf(await run(owner, saveAbout, page({ story: { en: [{ type: 'html', text: '<b>x</b>' }] } })))).toBe('INVALID');
    expect(codeOf(await run(owner, saveAbout, page({ story: { en: [{ type: 'paragraph', text: 'x', links: [{ text: 'x', href: 'javascript:1' }] }] } })))).toBe('INVALID');
    expect(codeOf(await run(owner, saveAbout, page({ galleryAssetIds: Array.from({ length: 25 }, () => photo) })))).toBe('INVALID');
  });

  it('turning it on with nothing filled in is refused', async () => {
    expect(codeOf(await run(owner, setMenuAboutEnabled, { menuId, enabled: true }))).toBe('INVALID');
    dataOf(await run(owner, saveAbout, page({ coverAssetId: null, story: {}, galleryAssetIds: [] })));
    expect(codeOf(await run(owner, setMenuAboutEnabled, { menuId, enabled: true }))).toBe('INVALID');
    dataOf(await run(owner, saveAboutOffer, offer()));
    expect(codeOf(await run(owner, setMenuAboutEnabled, { menuId, enabled: true }))).toBe('OK');
  });

  it('needs the plan feature to be turned on', async () => {
    dataOf(await run(owner, saveAbout, page()));
    await prisma().restaurant.update({ where: { id: a.id }, data: { plan: 'BASIC' } });
    expect(codeOf(await run(owner, setMenuAboutEnabled, { menuId, enabled: true }))).toBe('UPGRADE_REQUIRED');
  });

  it('refuses a person of another restaurant', async () => {
    expect(codeOf(await run(stranger, saveAbout, page()))).not.toBe('OK');
  });
});

describe('offers', () => {
  it('refuses an offer that ends before it starts, a long label and two targets', async () => {
    expect(codeOf(await run(owner, saveAboutOffer, offer({ startsAt: '2026-11-02T00:00:00Z', endsAt: '2026-11-01T00:00:00Z' })))).toBe('INVALID');
    expect(codeOf(await run(owner, saveAboutOffer, offer({ label: { en: 'x'.repeat(41) } })))).toBe('INVALID');
    expect(codeOf(await run(owner, saveAboutOffer, offer({ productId, categoryId })))).toBe('INVALID');
    expect(await prisma().aboutOffer.count()).toBe(0);
  });

  it('keeps an offer that links to a product or a category of this menu', async () => {
    const saved = dataOf(await run(owner, saveAboutOffer, offer({ productId })));
    expect((await prisma().aboutOffer.findUniqueOrThrow({ where: { id: saved.offerId } })).productId).toBe(productId);
    const other = dataOf(await run(owner, saveAboutOffer, offer({ categoryId })));
    expect((await prisma().aboutOffer.findUniqueOrThrow({ where: { id: other.offerId } })).categoryId).toBe(categoryId);
  });

  it('adds, edits, orders and deletes offers', async () => {
    const first = dataOf(await run(owner, saveAboutOffer, offer())).offerId;
    const second = dataOf(await run(owner, saveAboutOffer, offer({ titles: { en: 'Dinner' } }))).offerId;
    dataOf(await run(owner, saveAboutOffer, offer({ offerId: first, label: {} })));
    dataOf(await run(owner, reorderAboutOffers, { menuId, ids: [second, first] }));
    const read = dataOf(await ask(owner, menuAbout, { menuId }));
    expect(read.offers.map((x) => x.id)).toEqual([second, first]);
    expect(codeOf(await run(owner, reorderAboutOffers, { menuId, ids: [first] }))).toBe('INVALID');
    dataOf(await run(owner, deleteAboutOffer, { menuId, offerId: first }));
    expect((await prisma().aboutOffer.findMany()).map((x) => x.id)).toEqual([second]);
  });

  it('will not edit or delete an offer of another menu through this one', async () => {
    const other = await prisma().aboutOffer.create({ data: { menuId: otherMenuId } });
    expect(codeOf(await run(owner, saveAboutOffer, offer({ offerId: other.id })))).toBe('NOT_FOUND');
    expect(codeOf(await run(owner, deleteAboutOffer, { menuId, offerId: other.id }))).toBe('NOT_FOUND');
    expect(await prisma().aboutOffer.count()).toBe(1);
  });
});
