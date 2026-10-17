import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { databaseUrl, TEST_DB } from '../../scripts/db-config';
import { createMenuFixture, publishFixture, resetTestData, testPrisma } from '../helpers/db';

process.env.DATABASE_URL = databaseUrl(TEST_DB);
const prisma = testPrisma();

let withPublicMenu: typeof import('@/server/public-page').withPublicMenu;
let resolvePublicRoute: typeof import('@/server/public-page').resolvePublicRoute;
let backToMenuHref: typeof import('@/server/public-page').backToMenuHref;
let MenuUnavailable: typeof import('@/ui/MenuUnavailable').MenuUnavailable;

/** What Next's `notFound()` and `permanentRedirect()` throw, read through the digest the framework itself reads. */
async function thrownDigest(work: Promise<unknown>): Promise<string> {
  try {
    await work;
  } catch (error) {
    return String((error as { digest?: unknown }).digest ?? error);
  }
  return 'did not throw';
}

const PARAMS = (tenant: string, locale: string) => ({ tenant, locale });

beforeAll(async () => {
  await resetTestData(prisma);

  await createMenuFixture(prisma, 'live-cafe');

  // Live, in English only.
  const solo = await createMenuFixture(prisma, 'solo-cafe', { publish: false });
  await prisma.menu.update({ where: { id: solo.menu.id }, data: { locales: ['en'] } });
  await publishFixture(prisma, solo.menu.id);

  const renamed = await createMenuFixture(prisma, 'old-cafe');
  await prisma.menu.update({ where: { id: renamed.menu.id }, data: { slug: 'new-cafe' } });
  await prisma.menuSlug.create({ data: { slug: 'new-cafe', menuId: renamed.menu.id } });

  const paused = await createMenuFixture(prisma, 'paused-cafe');
  await prisma.menu.update({ where: { id: paused.menu.id }, data: { status: 'SUSPENDED' } });

  // The restaurant is suspended while the menu itself is fine.
  const closed = await createMenuFixture(prisma, 'closed-cafe');
  await prisma.restaurant.update({ where: { id: closed.restaurant.id }, data: { status: 'SUSPENDED' } });

  await createMenuFixture(prisma, 'draft-cafe', { publish: false });

  // Offers English only; suspended, so guests see the neutral page in a language it offers.
  const english = await createMenuFixture(prisma, 'english-cafe', { publish: false });
  await prisma.menu.update({ where: { id: english.menu.id }, data: { locales: ['en'] } });
  await publishFixture(prisma, english.menu.id);
  await prisma.menu.update({ where: { id: english.menu.id }, data: { status: 'SUSPENDED' } });

  ({ withPublicMenu, resolvePublicRoute, backToMenuHref } = await import('@/server/public-page'));
  ({ MenuUnavailable } = await import('@/ui/MenuUnavailable'));
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('resolvePublicRoute', () => {
  it('opens a live menu in an offered language', async () => {
    const result = await resolvePublicRoute(PARAMS('live-cafe', 'ar'));
    expect(result.kind).toBe('live');
    if (result.kind === 'live') {
      expect(result.route.locale).toBe('ar');
      expect(result.route.tenant.slug).toBe('live-cafe');
    }
  });

  it('says where a former slug moved to', async () => {
    expect(await resolvePublicRoute(PARAMS('old-cafe', 'en'))).toEqual({ kind: 'redirect', slug: 'new-cafe' });
  });

  it('reports a suspended menu or restaurant as unavailable, with the restaurant name in the visitor’s language', async () => {
    expect(await resolvePublicRoute(PARAMS('paused-cafe', 'ckb'))).toEqual({
      kind: 'unavailable',
      name: 'Restaurant paused-cafe',
      locale: 'ckb',
    });
    expect((await resolvePublicRoute(PARAMS('closed-cafe', 'ar'))).kind).toBe('unavailable');
  });

  it('shows the neutral page in the menu’s default language when the visitor’s is not one of its languages', async () => {
    expect(await resolvePublicRoute(PARAMS('english-cafe', 'ar'))).toMatchObject({ kind: 'unavailable', locale: 'en' });
  });

  it('is missing for an unknown or unpublished slug, an unknown language, or a language the menu does not offer', async () => {
    for (const [tenant, locale] of [
      ['nope', 'en'],
      ['draft-cafe', 'en'],
      ['live-cafe', 'xx'],
      ['old-cafe', 'xx'],
      ['paused-cafe', 'xx'],
    ] as const) {
      expect(await resolvePublicRoute(PARAMS(tenant, locale)), `${tenant}/${locale}`).toEqual({ kind: 'missing' });
    }
  });
});

describe('withPublicMenu', () => {
  it('renders a live menu', async () => {
    const render = vi.fn(async (route: { tenant: { slug: string }; locale: string }) => `${route.tenant.slug}/${route.locale}`);
    expect(await withPublicMenu(PARAMS('live-cafe', 'ar'), '', '', render)).toBe('live-cafe/ar');
    expect(render).toHaveBeenCalledTimes(1);
  });

  it('answers 404 for a missing menu without rendering', async () => {
    const render = vi.fn(async () => 'page');
    expect(await thrownDigest(withPublicMenu(PARAMS('nope', 'en'), '', '', render))).toBe('NEXT_HTTP_ERROR_FALLBACK;404');
    expect(await thrownDigest(withPublicMenu(PARAMS('draft-cafe', 'en'), '', '', render))).toBe(
      'NEXT_HTTP_ERROR_FALLBACK;404',
    );
    expect(await thrownDigest(withPublicMenu(PARAMS('live-cafe', 'xx'), '', '', render))).toBe(
      'NEXT_HTTP_ERROR_FALLBACK;404',
    );
    expect(render).not.toHaveBeenCalled();
  });

  it('redirects a former slug permanently, keeping the language, the subpath and the query', async () => {
    const render = vi.fn(async () => 'page');
    expect(await thrownDigest(withPublicMenu(PARAMS('old-cafe', 'ar'), '/p/old-cafe-espresso', '?x=1&y=2', render))).toBe(
      'NEXT_REDIRECT;replace;/new-cafe/ar/p/old-cafe-espresso?x=1&y=2;308;',
    );
    expect(await thrownDigest(withPublicMenu(PARAMS('old-cafe', 'en'), '', '', render))).toBe(
      'NEXT_REDIRECT;replace;/new-cafe/en;308;',
    );
    expect(render).not.toHaveBeenCalled();
  });

  it('shows the unavailable page for a suspended menu without rendering the menu', async () => {
    const render = vi.fn(async () => 'page');
    const page = (await withPublicMenu(PARAMS('paused-cafe', 'ar'), '/cart', '', render)) as {
      type: unknown;
      props: unknown;
    };
    expect(page.type).toBe(MenuUnavailable);
    expect(page.props).toEqual({ name: 'Restaurant paused-cafe', locale: 'ar' });
    expect(render).not.toHaveBeenCalled();
  });

  it('lets a failure inside the page propagate', async () => {
    await expect(
      withPublicMenu(PARAMS('live-cafe', 'en'), '', '', async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
  });
});

describe('backToMenuHref', () => {
  it('leads to a live menu’s home in the language of the page', async () => {
    expect(await backToMenuHref('/live-cafe/ar/p/does-not-exist')).toBe('/live-cafe/ar');
    expect(await backToMenuHref('/live-cafe/ckb/t/999')).toBe('/live-cafe/ckb');
    expect(await backToMenuHref('/solo-cafe/en')).toBe('/solo-cafe/en');
  });

  it('leads to the menu’s entry address when the menu did not render in that language', async () => {
    expect(await backToMenuHref('/live-cafe/xx')).toBe('/live-cafe');
    expect(await backToMenuHref('/solo-cafe/ckb/cart')).toBe('/solo-cafe');
    expect(await backToMenuHref('/paused-cafe/en')).toBe('/paused-cafe');
    expect(await backToMenuHref('/nope/en')).toBe('/nope');
  });

  it('leads to / when the path holds no usable slug, or is unknown', async () => {
    for (const path of [null, '', '/', '/Live-Cafe/en', '/%2Fevil.com/en', '/-x/en', '//evil.com/en']) {
      expect(await backToMenuHref(path), String(path)).toBe('/');
    }
  });
});
