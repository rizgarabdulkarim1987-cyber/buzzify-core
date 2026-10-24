import { describe, expect, it } from 'vitest';
import type { Actor } from '@/server/studio/auth/actor';
import { isNavItemActive, NAV_ITEMS, posNavItem, safeNextPath, visibleNav } from '@/studio/nav';

function actor(overrides: Partial<Actor>): Actor {
  return {
    userId: 'user-1',
    email: 'person@example.test',
    name: 'Person',
    isSuperAdmin: false,
    isPlatformOwner: false,
    twoFactorEnabled: true,
    locale: 'en',
    memberships: [],
    ...overrides,
  };
}

const keys = (items: ReturnType<typeof visibleNav>) => items.map((item) => item.key);

describe('NAV_ITEMS', () => {
  it('lists the Studio areas in order, each under /studio', () => {
    expect(NAV_ITEMS.map((item) => item.key)).toEqual(['overview', 'restaurants', 'billing', 'cashierOverview', 'menus', 'media', 'motion', 'people', 'activity', 'settings']);
    expect(NAV_ITEMS.map((item) => item.href)).toEqual([
      '/studio',
      '/studio/restaurants',
      '/studio/billing',
      '/studio/cashier',
      '/studio/menus',
      '/studio/media',
      '/studio/motion',
      '/studio/people',
      '/studio/activity',
      '/studio/settings',
    ]);
  });
});

describe('visibleNav', () => {
  it('gives a Super Admin every area', () => {
    expect(keys(visibleNav(actor({ isSuperAdmin: true })))).toEqual(['overview', 'restaurants', 'billing', 'cashierOverview', 'menus', 'media', 'motion', 'people', 'activity', 'settings']);
  });

  it('gives a Super Admin every area even when they also own a restaurant', () => {
    const superAdmin = actor({ isSuperAdmin: true, memberships: [{ restaurantId: 'r1', role: 'OWNER' }] });
    expect(keys(visibleNav(superAdmin))).toEqual(['overview', 'restaurants', 'billing', 'cashierOverview', 'menus', 'media', 'motion', 'people', 'activity', 'settings']);
  });

  it('gives a designer the working areas but not Billing, People, Activity or Settings', () => {
    const designer = actor({ memberships: [{ restaurantId: 'r1', role: 'DESIGNER' }] });
    expect(keys(visibleNav(designer))).toEqual(['overview', 'restaurants', 'menus', 'media', 'motion']);
  });

  it('treats staff who are not assigned to a restaurant yet as designers', () => {
    expect(keys(visibleNav(actor({})))).toEqual(['overview', 'restaurants', 'menus', 'media', 'motion']);
  });

  it('treats someone who designs for one client and owns another as a designer', () => {
    const both = actor({
      memberships: [
        { restaurantId: 'r1', role: 'OWNER' },
        { restaurantId: 'r2', role: 'DESIGNER' },
      ],
    });
    expect(keys(visibleNav(both))).toEqual(['overview', 'restaurants', 'menus', 'media', 'motion']);
  });

  it('gives an owner only their restaurant', () => {
    const owner = actor({ memberships: [{ restaurantId: 'r1', role: 'OWNER' }] });
    expect(visibleNav(owner)).toEqual([
      {
        key: 'myRestaurant',
        href: '/studio/restaurants/r1/menus',
        labelKey: 'nav.myRestaurant',
        icon: 'store',
        match: ['/studio/restaurants/r1'],
      },
    ]);
  });

  it('sends an owner whose restaurant has exactly one menu straight to that menu', () => {
    const owner = actor({ memberships: [{ restaurantId: 'r1', role: 'OWNER' }] });
    const [item] = visibleNav(owner, [{ id: 'r1', name: 'ATELIER', menuIds: ['m1'] }]);
    expect(item!.href).toBe('/studio/menus/m1');
    expect(item!.match).toEqual(['/studio/restaurants/r1', '/studio/menus/m1']);
  });

  it("sends an owner whose restaurant has several menus (or none) to the restaurant's Menus tab", () => {
    const owner = actor({ memberships: [{ restaurantId: 'r1', role: 'OWNER' }] });
    const [item] = visibleNav(owner, [{ id: 'r1', name: 'ATELIER', menuIds: ['m1', 'm2'] }]);
    expect(item!.href).toBe('/studio/restaurants/r1/menus');
    expect(item!.match).toEqual(['/studio/restaurants/r1', '/studio/menus/m1', '/studio/menus/m2']);
  });

  it('lists each restaurant by name for an owner of several, never jumping to one menu', () => {
    const owner = actor({
      memberships: [
        { restaurantId: 'r1', role: 'OWNER' },
        { restaurantId: 'r2', role: 'OWNER' },
      ],
    });
    const items = visibleNav(owner, [
      { id: 'r1', name: 'ATELIER', menuIds: ['m1'] },
      { id: 'r2', name: 'مطعم مازو', menuIds: [] },
    ]);
    expect(items.map((item) => [item.href, item.label])).toEqual([
      ['/studio/restaurants/r1/menus', 'ATELIER'],
      ['/studio/restaurants/r2/menus', 'مطعم مازو'],
    ]);
  });

  it('ignores menus it is told about for restaurants the person does not own', () => {
    const owner = actor({ memberships: [{ restaurantId: 'r1', role: 'OWNER' }] });
    const items = visibleNav(owner, [
      { id: 'r1', name: 'ATELIER', menuIds: ['m1', 'm2'] },
      { id: 'r9', name: 'Elsewhere', menuIds: ['m9'] },
    ]);
    expect(items.map((item) => item.href)).toEqual(['/studio/restaurants/r1/menus']);
  });
});

describe('isNavItemActive', () => {
  const [overview, restaurants] = NAV_ITEMS;

  it('marks Overview only on /studio itself', () => {
    expect(isNavItemActive(overview!, '/studio')).toBe(true);
    expect(isNavItemActive(overview!, '/studio/restaurants')).toBe(false);
  });

  it('marks an area on its own pages and below, not on a neighbour that shares a prefix', () => {
    expect(isNavItemActive(restaurants!, '/studio/restaurants')).toBe(true);
    expect(isNavItemActive(restaurants!, '/studio/restaurants/r1/menus')).toBe(true);
    expect(isNavItemActive(restaurants!, '/studio/restaurantsx')).toBe(false);
  });

  it('marks an owner’s item on their restaurant and on its menus', () => {
    const owner = actor({ memberships: [{ restaurantId: 'r1', role: 'OWNER' }] });
    const [item] = visibleNav(owner, [{ id: 'r1', name: 'ATELIER', menuIds: ['m1'] }]);
    expect(isNavItemActive(item!, '/studio/menus/m1')).toBe(true);
    expect(isNavItemActive(item!, '/studio/restaurants/r1/people')).toBe(true);
    expect(isNavItemActive(item!, '/studio/account')).toBe(false);
  });
});

describe('the cashier item and the shared sign-in', () => {
  it('is one item pointing at /pos', () => {
    expect(posNavItem()).toMatchObject({ key: 'cashier', href: '/pos', labelKey: 'nav.cashier' });
  });

  it('is not among the Studio areas, so a menu-only user never sees it', () => {
    expect(NAV_ITEMS.map((item) => item.key)).not.toContain('cashier');
  });

  it('lets a sign-in return to the till', () => {
    expect(safeNextPath('/pos')).toBe('/pos');
    expect(safeNextPath('/pos/settings')).toBe('/pos/settings');
    for (const value of ['/posters', '/pos/../studio', '//pos', '/pos?x=1', 'https://evil.test/pos']) {
      expect(safeNextPath(value), value).toBeNull();
    }
  });
});

describe('safeNextPath', () => {
  it('keeps a Studio path', () => {
    expect(safeNextPath('/studio')).toBe('/studio');
    expect(safeNextPath('/studio/invite/AbC-12_x')).toBe('/studio/invite/AbC-12_x');
  });

  it('refuses anything that could leave the Studio or the site', () => {
    for (const value of [
      null,
      '',
      'https://evil.test/studio',
      '//evil.test',
      '/studio/../api',
      '/studios',
      '/studio//evil.test',
      '/studio/x?y=1',
      '/studio\\evil',
      '/atelier/en',
      ['/studio'],
    ]) {
      expect(safeNextPath(value as never), String(value)).toBeNull();
    }
  });
});
