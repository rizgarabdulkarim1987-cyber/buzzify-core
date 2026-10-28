import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteIntroAdvert, reorderIntroAdverts, saveIntroAdvert, saveMenuIntro, setMenuIntroEnabled } from '@/server/studio/actions/intro';
import { menuIntro } from '@/server/studio/queries/intro';
import { ask, codeOf, dataOf, person, prisma, resetWorld, restaurant, run, useTestDatabase, type Person } from '../pos/fixture';

vi.mock('next/headers', () => ({ headers: vi.fn(), cookies: vi.fn() }));

const globalForPrisma = globalThis as unknown as { __prisma?: unknown };

let a: { id: string };
let b: { id: string };
let menuId = '';
let owner: Person;
let stranger: Person;
let photo = '';
let video = '';
let posterless = '';
let foreign = '';

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

const advert = (over: Record<string, unknown> = {}) => ({ menuId, imageAssetId: photo, alts: { en: 'Event' }, href: 'https://example.com/event', startsAt: null, endsAt: null, active: true, ...over });
const intro = (over: Record<string, unknown> = {}) => ({ menuId, backgroundAssetId: photo, overlay: 40, showLogo: true, showContact: true, ...over });

beforeAll(() => {
  useTestDatabase();
});

beforeEach(async () => {
  await resetWorld();
  a = await restaurant('Intro A', 'none');
  b = await restaurant('Intro B', 'none');
  menuId = await menuOf(a.id, 'intro-a');
  await menuOf(b.id, 'intro-b');
  owner = await person('intro-owner', { membership: [a.id, 'OWNER'] });
  stranger = await person('intro-stranger', { membership: [b.id, 'OWNER'] });
  photo = await asset(a.id, 'photo', 'IMAGE', { original: 'k/photo' });
  video = await asset(a.id, 'video', 'VIDEO', { original: 'k/video', poster: { webp: { '320': 'k/p' } } });
  posterless = await asset(a.id, 'noposter', 'VIDEO', { original: 'k/np' });
  foreign = await asset(b.id, 'foreign', 'IMAGE', { original: 'k/foreign' });
});

afterAll(async () => {
  await resetWorld();
  await prisma().$disconnect();
  delete globalForPrisma.__prisma;
});

describe('saving the intro', () => {
  it('saves the intro, turns it on, and the owner reads it back', async () => {
    dataOf(await run(owner, saveMenuIntro, intro()));
    dataOf(await run(owner, setMenuIntroEnabled, { menuId, enabled: true }));
    const read = dataOf(await ask(owner, menuIntro, { menuId }));
    expect(read.enabled).toBe(true);
    expect(read.intro).toMatchObject({ backgroundAssetId: photo, overlay: 40 });
  });

  it('accepts a video that has a poster and refuses one without', async () => {
    expect(codeOf(await run(owner, saveMenuIntro, intro({ backgroundAssetId: video })))).toBe('OK');
    expect(codeOf(await run(owner, saveMenuIntro, intro({ backgroundAssetId: posterless })))).toBe('INVALID');
  });

  it("refuses another restaurant's asset as background or advert", async () => {
    expect(codeOf(await run(owner, saveMenuIntro, intro({ backgroundAssetId: foreign })))).toBe('NOT_FOUND');
    expect(codeOf(await run(owner, saveIntroAdvert, advert({ imageAssetId: foreign })))).toBe('NOT_FOUND');
    expect(await prisma().introAdvert.count()).toBe(0);
  });

  it('refuses an overlay outside 0 to 100', async () => {
    for (const overlay of [-1, 101, 50.5]) expect(codeOf(await run(owner, saveMenuIntro, intro({ overlay }))), String(overlay)).toBe('INVALID');
  });

  it('needs the plan feature to be turned on', async () => {
    await prisma().restaurant.update({ where: { id: a.id }, data: { plan: 'BASIC' } });
    expect(codeOf(await run(owner, setMenuIntroEnabled, { menuId, enabled: true }))).toBe('UPGRADE_REQUIRED');
  });

  it("refuses a person of another restaurant", async () => {
    expect(codeOf(await run(stranger, saveMenuIntro, intro()))).not.toBe('OK');
  });
});

describe('adverts', () => {
  it('refuses a link that is not https or a path, a picture that is a video, and an end before the start', async () => {
    expect(codeOf(await run(owner, saveIntroAdvert, advert({ href: 'javascript:alert(1)' })))).toBe('INVALID');
    expect(codeOf(await run(owner, saveIntroAdvert, advert({ href: 'http://example.com' })))).toBe('INVALID');
    expect(codeOf(await run(owner, saveIntroAdvert, advert({ imageAssetId: video })))).toBe('NOT_FOUND'); // a video is not a kind an advert may use
    expect(codeOf(await run(owner, saveIntroAdvert, advert({ startsAt: '2026-11-02T00:00:00Z', endsAt: '2026-11-01T00:00:00Z' })))).toBe('INVALID');
    expect(await prisma().introAdvert.count()).toBe(0);
  });

  it('adds, edits, orders and deletes adverts', async () => {
    const first = dataOf(await run(owner, saveIntroAdvert, advert())).advertId;
    const second = dataOf(await run(owner, saveIntroAdvert, advert({ href: '/menu' }))).advertId;
    dataOf(await run(owner, saveIntroAdvert, advert({ advertId: first, href: '' })));
    dataOf(await run(owner, reorderIntroAdverts, { menuId, ids: [second, first] }));
    const read = dataOf(await ask(owner, menuIntro, { menuId }));
    expect(read.adverts.map((x) => x.id)).toEqual([second, first]);
    expect(read.adverts.find((x) => x.id === first)?.href).toBe('');
    expect(codeOf(await run(owner, reorderIntroAdverts, { menuId, ids: [first] }))).toBe('INVALID');
    dataOf(await run(owner, deleteIntroAdvert, { menuId, advertId: first }));
    expect((await prisma().introAdvert.findMany()).map((x) => x.id)).toEqual([second]);
  });

  it("will not edit or delete an advert of another menu through this one", async () => {
    const other = await prisma().introAdvert.create({ data: { menuId: (await prisma().menu.findFirstOrThrow({ where: { restaurantId: b.id } })).id, imageAssetId: foreign } });
    expect(codeOf(await run(owner, saveIntroAdvert, advert({ advertId: other.id })))).toBe('NOT_FOUND');
    expect(codeOf(await run(owner, deleteIntroAdvert, { menuId, advertId: other.id }))).toBe('NOT_FOUND');
    expect(await prisma().introAdvert.count()).toBe(1);
  });

  it("lists the platform's adverts that apply, read only, and not the ones for other restaurants", async () => {
    await prisma().platformAdvert.create({ data: { imageAssetId: photo, alts: {}, restaurantIds: [] } });
    await prisma().platformAdvert.create({ data: { imageAssetId: photo, alts: {}, restaurantIds: [a.id] } });
    await prisma().platformAdvert.create({ data: { imageAssetId: photo, alts: {}, restaurantIds: [b.id] } });
    const read = dataOf(await ask(owner, menuIntro, { menuId }));
    expect(read.platformAdverts).toHaveLength(2);
    expect(read.adverts).toHaveLength(0);
  });
});
