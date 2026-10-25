import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Actor } from '@/server/studio/auth/actor';
import { getActor } from '@/server/studio/auth/actor';
import { STYLE_PAGES } from '@/studio/styles/catalog';
import { GET as getPage } from '@/app/studio/style-files/page/[file]/route';
import { GET as getPoster } from '@/app/studio/style-files/poster/[id]/route';

// `getActor` reads the session from Next's request headers; the route's check is what is under test, so it is stood in for.
vi.mock('@/server/studio/auth/actor', () => ({ getActor: vi.fn() }));

const designer: Actor = {
  userId: 'u1',
  email: 'd@example.com',
  name: 'Designer',
  isSuperAdmin: false,
  twoFactorEnabled: false,
  locale: 'en',
  memberships: [],
};
const owner: Actor = { ...designer, userId: 'u2', memberships: [{ restaurantId: 'r1', role: 'OWNER' }] };

const page = (file: string) => getPage(new Request('http://localhost/x'), { params: Promise.resolve({ file }) });
const poster = (id: string) => getPoster(new Request('http://localhost/x'), { params: Promise.resolve({ id }) });
const keysOf = (html: string) => [...html.matchAll(/^\s*\{ (?:grp: '\w', )?key: '([a-z0-9]+)'/gm)].map((m) => m[1]);

describe('style page files', () => {
  beforeEach(() => {
    vi.mocked(getActor).mockReset();
    vi.mocked(getActor).mockResolvedValue(designer);
  });

  it.each(STYLE_PAGES)('serves the %s page to a designer as private HTML that is revalidated', async (name) => {
    const res = await page(name);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(res.headers.get('cache-control')).toBe('private, no-cache');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    const html = await res.text();
    expect(html).toContain("get('style')");
    expect(html).toContain('searchParams');
    expect(html).toContain('solo');
    expect(html).not.toContain('brainstorm.send');
    expect(html).not.toContain('يعجبني');
    expect(html).not.toContain('-liked');
    expect(html).toContain('STYLES');
  });

  it('drops the unpicked styles', async () => {
    expect(keysOf(await (await page('themed')).text())).not.toContain('par');
    expect(keysOf(await (await page('kurd-arab')).text())).toEqual(['cit', 'ram', 'lyl']);
    expect(keysOf(await (await page('layout-2')).text())).toHaveLength(8);
  });

  it('refuses an owner and a signed-out visitor', async () => {
    vi.mocked(getActor).mockResolvedValue(owner);
    expect((await page('motion')).status).toBe(404);
    vi.mocked(getActor).mockResolvedValue(null);
    expect((await page('motion')).status).toBe(404);
  });

  it('refuses a Super Admin who has not set up two-factor', async () => {
    vi.mocked(getActor).mockResolvedValue({ ...designer, isSuperAdmin: true, twoFactorEnabled: false });
    expect((await page('motion')).status).toBe(404);
    expect((await poster('themed-kurd')).status).toBe(404);
    vi.mocked(getActor).mockResolvedValue({ ...designer, isSuperAdmin: true, twoFactorEnabled: true });
    expect((await page('motion')).status).toBe(200);
  });

  it.each(['..%2Fpackage.json', 'layout-2.html', 'LAYOUT', 'nope'])('answers 404 for the page name %s', async (name) => {
    expect((await page(name)).status).toBe(404);
  });
});

describe('style poster files', () => {
  beforeEach(() => {
    vi.mocked(getActor).mockReset();
    vi.mocked(getActor).mockResolvedValue(designer);
  });

  it('serves a catalog id as image/webp', async () => {
    const res = await poster('themed-kurd');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/webp');
  });

  it.each(['nope', 'themed-par'])('answers 404 for %s', async (id) => {
    expect((await poster(id)).status).toBe(404);
  });

  it('answers 404 to an owner', async () => {
    vi.mocked(getActor).mockResolvedValue(owner);
    expect((await poster('themed-kurd')).status).toBe(404);
  });
});
