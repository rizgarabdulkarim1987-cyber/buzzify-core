import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const searchRestaurants = vi.fn();
vi.mock('@/app/studio/_actions/search', () => ({
  searchRestaurants: (input: unknown) => searchRestaurants(input),
  searchMenus: vi.fn(),
  searchPeople: vi.fn(),
}));

const APP = path.join(process.cwd(), 'src/app/studio/(studio)/(app)');
const SPACE = 'retail/(space)';
const read = (relative: string) => readFileSync(path.join(APP, relative), 'utf8');

describe('the Retail space routes', () => {
  it('has a page for each screen of the space', () => {
    for (const screen of ['page', 'new/page', 'overview/page', 'billing/page', 'people/page', 'announcements/page', 'activity/page', 'settings/page']) {
      expect(existsSync(path.join(APP, SPACE, `${screen}.tsx`)), screen).toBe(true);
    }
    for (const tab of ['page', 'branches/page', 'billing/page', 'people/page', 'activity/page', 'retail/page']) {
      expect(existsSync(path.join(APP, SPACE, '[id]', `${tab}.tsx`)), tab).toBe(true);
    }
  });

  it('is closed to everyone but a Super Admin, and refuses a business of another project', () => {
    expect(read(`${SPACE}/layout.tsx`)).toMatch(/!actor\.isSuperAdmin\) notFound\(\)/);
    expect(read(`${SPACE}/[id]/layout.tsx`)).toMatch(/sector !== 'RETAIL'\) notFound\(\)/);
    expect(read(`${SPACE}/[id]/layout.tsx`)).toContain('space="retail"');
  });

  it("leaves the owners' sign-in handoff outside the Super Admin frame, where owners still reach it", () => {
    expect(existsSync(path.join(APP, 'retail/choose/page.tsx'))).toBe(true);
    expect(existsSync(path.join(APP, 'retail/layout.tsx'))).toBe(false);
    for (const handler of ['open/[restaurantId]/route.ts', 'continue/route.ts']) {
      expect(existsSync(path.join(process.cwd(), 'src/app/studio/retail', handler)), handler).toBe(true);
    }
  });

  it('keeps every screen of the space on the retail sector', () => {
    for (const screen of ['billing', 'people', 'activity']) expect(read(`${SPACE}/${screen}/page.tsx`)).toContain('space="retail"');
    expect(read(`${SPACE}/announcements/page.tsx`)).toContain('space="retail"');
    expect(read(`${SPACE}/overview/page.tsx`)).toContain("space: 'retail'");
    expect(read(`${SPACE}/overview/page.tsx`)).toContain('/studio/retail/activity');
    expect(read(`${SPACE}/new/page.tsx`)).toContain('space="retail"');
  });

  it('holds the Retail plans and price in its own settings, and sends the old plans tab there', () => {
    const settings = read(`${SPACE}/settings/page.tsx`);
    expect(settings).toContain('applicationId="retail"');
    expect(settings).toContain("billingOverview, { space: 'retail' }");
    expect(read('billing/plans/page.tsx')).toContain("redirect('/studio/retail/settings')");
  });

  it('opens each shop of its list in the space, and makes a new one with its own form', () => {
    const list = read(`${SPACE}/page.tsx`);
    expect(list).toContain("businessPath('RETAIL', row.id, 'retail')");
    expect(list).toContain("'/studio/retail/new'");
  });
});

describe('a retail shop opened through Menu and Cashier', () => {
  it('sends a Super Admin to the same page in the Retail space, and nobody else', () => {
    const layout = read('restaurants/[id]/layout.tsx');
    expect(layout).toMatch(/actor\.isSuperAdmin && restaurant\.sector === 'RETAIL'/);
    expect(layout).toContain("movedBusinessAddressOf((await headers()).get(REQUEST_PATH_HEADER) ?? '', restaurant.id, 'RETAIL')");
  });

  it('sends the old new-shop link of a Super Admin to the space of its sector', () => {
    expect(read('restaurants/new/page.tsx')).toMatch(/actor\.isSuperAdmin && sector !== 'FOOD'\) redirect\(/);
  });

  it('keeps the Retail tab on a shop for a Super Admin', () => {
    expect(read('restaurants/[id]/BusinessLayout.tsx')).toMatch(/restaurant\.sector === 'RETAIL' && actor\.isSuperAdmin \? \[\{ href: `\$\{base\}\/retail`/);
  });
});

describe('the restaurant pickers of the Retail space', () => {
  beforeEach(() => {
    searchRestaurants.mockReset();
    searchRestaurants.mockResolvedValue({ ok: true, data: { rows: [{ id: 's1', name: 'Shop', clientId: 'C-9', city: null }] } });
  });

  it('search only the Retail space, and the Platform space searches every project', async () => {
    const { findRestaurantOptionsIn } = await import('@/studio/pickers');
    await findRestaurantOptionsIn.retail('sh');
    expect(searchRestaurants).toHaveBeenLastCalledWith({ q: 'sh', space: 'retail' });
    searchRestaurants.mockClear();
    await findRestaurantOptionsIn.platform('sh');
    expect(searchRestaurants.mock.calls.map(([input]) => (input as { space: string }).space).sort()).toEqual(['food', 'pharmacy', 'retail']);
  });
});
