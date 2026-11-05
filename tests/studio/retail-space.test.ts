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
const SPACE = '[product]';
const read = (relative: string) => readFileSync(path.join(APP, relative), 'utf8');

describe('the Retail product space routes', () => {
  it('has a page for each screen of a product space', () => {
    for (const screen of ['page', 'new/page', 'overview/page', 'billing/page', 'people/page', 'announcements/page', 'activity/page', 'settings/page']) {
      expect(existsSync(path.join(APP, SPACE, `${screen}.tsx`)), screen).toBe(true);
    }
    for (const tab of ['page', 'branches/page', 'billing/page', 'people/page', 'activity/page', 'retail/page']) {
      expect(existsSync(path.join(APP, SPACE, '[id]', `${tab}.tsx`)), tab).toBe(true);
    }
  });

  it('is only a Retail product, closed to everyone but a Super Admin, and refuses a business of another project', () => {
    expect(read(`${SPACE}/product.ts`)).toContain('if (!isRetailSpace(product)) notFound();');
    expect(read(`${SPACE}/layout.tsx`)).toContain('await productOf(params)');
    expect(read(`${SPACE}/layout.tsx`)).toMatch(/!actor\.isSuperAdmin\) notFound\(\)/);
    expect(read(`${SPACE}/[id]/layout.tsx`)).toMatch(/sector !== 'RETAIL'\) notFound\(\)/);
    expect(read(`${SPACE}/[id]/layout.tsx`)).toContain('space={product}');
  });

  it('moves a shop opened under another product to the same page of its own', () => {
    const layout = read(`${SPACE}/[id]/layout.tsx`);
    expect(layout).toContain('spaceOfBusiness(restaurant.sector, restaurant.retailActivity)');
    expect(layout).toContain("retailAddressIn((await headers()).get(REQUEST_PATH_HEADER) ?? '', product, own)");
  });

  it("leaves the owners' sign-in handoff outside the Super Admin frame, where owners still reach it", () => {
    expect(existsSync(path.join(APP, 'retail/choose/page.tsx'))).toBe(true);
    expect(existsSync(path.join(APP, 'retail/layout.tsx'))).toBe(false);
    for (const handler of ['open/[restaurantId]/route.ts', 'continue/route.ts']) {
      expect(existsSync(path.join(process.cwd(), 'src/app/studio/retail', handler)), handler).toBe(true);
    }
  });

  it('sends every old Retail address to the Supermarket, keeping its query', () => {
    expect(read('retail/page.tsx')).toContain('redirectOldRetail([], searchParams)');
    expect(read('retail/[...legacy]/page.tsx')).toContain('redirectOldRetail((await params).legacy, searchParams)');
    const legacy = read('retail/legacy.ts');
    expect(legacy).toContain('oldRetailAddressOf(path, RETAIL_HANDOFF)');
    expect(legacy).toContain('query.append(key, one)');
  });

  it('keeps every screen of a product space on that product', () => {
    for (const screen of ['billing', 'people', 'activity', 'announcements']) expect(read(`${SPACE}/${screen}/page.tsx`)).toContain('space={await productOf(params)}');
    expect(read(`${SPACE}/overview/page.tsx`)).toContain('query(overview, { space: product })');
    expect(read(`${SPACE}/overview/page.tsx`)).toContain('activityHref={`${base}/activity`}');
    expect(read(`${SPACE}/new/page.tsx`)).toContain('<CreateRestaurantForm initialSector="RETAIL" space={product} />');
  });

  it('holds the shared Retail plans and price in its settings, and sends the old plans tab to the Supermarket', () => {
    const settings = read(`${SPACE}/settings/page.tsx`);
    expect(settings).toContain('applicationId="retail"');
    expect(settings).toContain('billingOverview, { space: product }');
    expect(read('billing/plans/page.tsx')).toContain("redirect('/studio/supermarket/settings')");
  });

  it('lists only its own shops, opens each in the space, and makes a new one of its own product', () => {
    const list = read(`${SPACE}/page.tsx`);
    expect(list).toContain('query(retailList, { failedOnly, space: product })');
    expect(list).toContain("businessPath(product, row.id, 'retail')");
    expect(list).toContain('href={`${base}/new`}');
  });
});

describe('a retail shop opened through Menu and Cashier', () => {
  it('sends a Super Admin to the same page in the Retail space, and nobody else', () => {
    const layout = read('restaurants/[id]/layout.tsx');
    expect(layout).toMatch(/actor\.isSuperAdmin && restaurant\.sector === 'RETAIL'/);
    expect(layout).toContain('const space = spaceOfBusiness(restaurant.sector, restaurant.retailActivity);');
    expect(layout).toContain("movedBusinessAddressOf((await headers()).get(REQUEST_PATH_HEADER) ?? '', restaurant.id, space)");
  });

  it('sends the old new-shop link of a Super Admin to the space of its sector', () => {
    expect(read('restaurants/new/page.tsx')).toMatch(/actor\.isSuperAdmin && sector !== 'FOOD'\) redirect\(/);
  });

  it('keeps the Retail tab on a shop for a Super Admin', () => {
    expect(read('restaurants/[id]/BusinessLayout.tsx')).toMatch(/restaurant\.sector === 'RETAIL' && actor\.isSuperAdmin \? \[\{ href: `\$\{base\}\/retail`/);
  });
});

describe('the restaurant pickers of the Retail product spaces', () => {
  beforeEach(() => {
    searchRestaurants.mockReset();
    searchRestaurants.mockResolvedValue({ ok: true, data: { rows: [{ id: 's1', name: 'Shop', clientId: 'C-9', city: null }] } });
  });

  it('search only their own product, and the Platform space searches every project', async () => {
    const { findRestaurantOptionsIn } = await import('@/studio/pickers');
    for (const product of ['supermarket', 'electronics', 'clothing'] as const) {
      await findRestaurantOptionsIn[product]('sh');
      expect(searchRestaurants).toHaveBeenLastCalledWith({ q: 'sh', space: product });
    }
    searchRestaurants.mockClear();
    await findRestaurantOptionsIn.platform('sh');
    expect(searchRestaurants.mock.calls.map(([input]) => (input as { space: string }).space).sort()).toEqual(['clothing', 'electronics', 'food', 'pharmacy', 'supermarket']);
  });
});
