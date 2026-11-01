import { describe, expect, it } from 'vitest';
import type { Actor } from '@/server/studio/auth/actor';
import { isNavItemActive, NAV_ITEMS, openRetailNavItem, posNavItem, safeNextPath, spaceNav, visibleNav } from '@/studio/nav';
import { spaceOfPath, type SpaceId } from '@/studio/spaces';

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
    expect(NAV_ITEMS.map((item) => item.key)).toEqual(['overview', 'restaurants', 'billing', 'cashierOverview', 'pharmacies', 'retail', 'menus', 'media', 'people', 'announcements', 'platformIntro', 'activity', 'settings']);
    expect(NAV_ITEMS.map((item) => item.href)).toEqual([
      '/studio',
      '/studio/restaurants',
      '/studio/billing',
      '/studio/cashier',
      '/studio/pharmacies',
      '/studio/retail',
      '/studio/menus',
      '/studio/media',
      '/studio/people',
      '/studio/announcements',
      '/studio/platform/intro',
      '/studio/activity',
      '/studio/settings',
    ]);
  });
});

describe('the Menu Styles area', () => {
  it('is gone from the navigation: styles live in the Templates gallery', () => {
    expect(NAV_ITEMS.map((item) => item.key)).not.toContain('styles');
    expect(NAV_ITEMS.map((item) => item.href)).not.toContain('/studio/styles');
  });
});

describe('visibleNav', () => {
  it('gives a Super Admin every area', () => {
    expect(keys(visibleNav(actor({ isSuperAdmin: true })))).toEqual(['overview', 'restaurants', 'billing', 'cashierOverview', 'pharmacies', 'retail', 'menus', 'media', 'people', 'announcements', 'platformIntro', 'activity', 'settings']);
  });

  it('gives a Super Admin every area even when they also own a restaurant', () => {
    const superAdmin = actor({ isSuperAdmin: true, memberships: [{ restaurantId: 'r1', role: 'OWNER' }] });
    expect(keys(visibleNav(superAdmin))).toEqual(['overview', 'restaurants', 'billing', 'cashierOverview', 'pharmacies', 'retail', 'menus', 'media', 'people', 'announcements', 'platformIntro', 'activity', 'settings']);
  });

  it('gives a Super Admin the Pharmacy area right after the Cashier, with its own pill icon', () => {
    const items = visibleNav(actor({ isSuperAdmin: true }));
    const at = items.findIndex((item) => item.key === 'cashierOverview');
    expect(items[at + 1]).toEqual({ key: 'pharmacies', href: '/studio/pharmacies', labelKey: 'nav.pharmacies', icon: 'pharmacy' });
  });

  it('never shows the Pharmacy area to a designer or an owner', () => {
    for (const memberships of [[{ restaurantId: 'r1', role: 'DESIGNER' as const }], [{ restaurantId: 'r1', role: 'OWNER' as const }], []]) {
      expect(keys(visibleNav(actor({ memberships })))).not.toContain('pharmacies');
    }
  });

  it('gives a Super Admin the Retail area right after Pharmacy, and nobody else', () => {
    const items = visibleNav(actor({ isSuperAdmin: true }));
    const at = items.findIndex((item) => item.key === 'pharmacies');
    expect(items[at + 1]).toEqual({ key: 'retail', href: '/studio/retail', labelKey: 'nav.retail', icon: 'retail' });
    for (const memberships of [[{ restaurantId: 'r1', role: 'DESIGNER' as const }], [{ restaurantId: 'r1', role: 'OWNER' as const }], []]) {
      expect(keys(visibleNav(actor({ memberships })))).not.toContain('retail');
    }
  });

  it('gives a designer the working areas but not Billing, People, Activity or Settings', () => {
    const designer = actor({ memberships: [{ restaurantId: 'r1', role: 'DESIGNER' }] });
    expect(keys(visibleNav(designer))).toEqual(['overview', 'restaurants', 'menus', 'media']);
  });

  it('treats staff who are not assigned to a restaurant yet as designers', () => {
    expect(keys(visibleNav(actor({})))).toEqual(['overview', 'restaurants', 'menus', 'media']);
  });

  it('treats someone who designs for one client and owns another as a designer', () => {
    const both = actor({
      memberships: [
        { restaurantId: 'r1', role: 'OWNER' },
        { restaurantId: 'r2', role: 'DESIGNER' },
      ],
    });
    expect(keys(visibleNav(both))).toEqual(['overview', 'restaurants', 'menus', 'media']);
  });

  it('gives an owner two items: their restaurant and their menu settings', () => {
    const owner = actor({ memberships: [{ restaurantId: 'r1', role: 'OWNER' }] });
    expect(visibleNav(owner)).toEqual([
      {
        key: 'myRestaurant',
        href: '/studio/restaurants/r1',
        labelKey: 'nav.myRestaurant',
        icon: 'store',
        match: ['/studio/restaurants/r1'],
        exclude: ['/studio/restaurants/r1/menus'],
      },
      {
        key: 'myMenu',
        href: '/studio/restaurants/r1/menus',
        labelKey: 'nav.myMenu',
        icon: 'menus',
        match: ['/studio/restaurants/r1/menus'],
      },
    ]);
  });

  it('sends an owner whose restaurant has exactly one menu straight to that menu', () => {
    const owner = actor({ memberships: [{ restaurantId: 'r1', role: 'OWNER' }] });
    const [restaurant, menu] = visibleNav(owner, [{ id: 'r1', name: 'ATELIER', menuIds: ['m1'] }]);
    expect(restaurant!.href).toBe('/studio/restaurants/r1');
    expect(menu!.href).toBe('/studio/menus/m1');
    expect(menu!.match).toEqual(['/studio/restaurants/r1/menus', '/studio/menus/m1']);
  });

  it("sends an owner whose restaurant has several menus (or none) to the restaurant's Menus tab", () => {
    const owner = actor({ memberships: [{ restaurantId: 'r1', role: 'OWNER' }] });
    const [, menu] = visibleNav(owner, [{ id: 'r1', name: 'ATELIER', menuIds: ['m1', 'm2'] }]);
    expect(menu!.href).toBe('/studio/restaurants/r1/menus');
    expect(menu!.match).toEqual(['/studio/restaurants/r1/menus', '/studio/menus/m1', '/studio/menus/m2']);
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
    expect(items.map((item) => [item.key, item.href, item.label ?? item.scope])).toEqual([
      ['myRestaurant', '/studio/restaurants/r1', 'ATELIER'],
      ['myMenu', '/studio/restaurants/r1/menus', 'ATELIER'],
      ['myRestaurant', '/studio/restaurants/r2', 'مطعم مازو'],
      ['myMenu', '/studio/restaurants/r2/menus', 'مطعم مازو'],
    ]);
  });

  it('ignores menus it is told about for restaurants the person does not own', () => {
    const owner = actor({ memberships: [{ restaurantId: 'r1', role: 'OWNER' }] });
    const items = visibleNav(owner, [
      { id: 'r1', name: 'ATELIER', menuIds: ['m1', 'm2'] },
      { id: 'r9', name: 'Elsewhere', menuIds: ['m9'] },
    ]);
    expect(items.map((item) => item.href)).toEqual(['/studio/restaurants/r1', '/studio/restaurants/r1/menus']);
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

  it('marks the restaurant item on the restaurant pages and the menu item on the menu and the Menus tab', () => {
    const owner = actor({ memberships: [{ restaurantId: 'r1', role: 'OWNER' }] });
    const [restaurant, menu] = visibleNav(owner, [{ id: 'r1', name: 'ATELIER', menuIds: ['m1'] }]);
    expect(isNavItemActive(restaurant!, '/studio/restaurants/r1')).toBe(true);
    expect(isNavItemActive(restaurant!, '/studio/restaurants/r1/people')).toBe(true);
    expect(isNavItemActive(restaurant!, '/studio/restaurants/r1/menus')).toBe(false);
    expect(isNavItemActive(restaurant!, '/studio/menus/m1')).toBe(false);
    expect(isNavItemActive(menu!, '/studio/menus/m1')).toBe(true);
    expect(isNavItemActive(menu!, '/studio/restaurants/r1/menus')).toBe(true);
    expect(isNavItemActive(menu!, '/studio/restaurants/r1/people')).toBe(false);
    expect(isNavItemActive(restaurant!, '/studio/account')).toBe(false);
  });
});

describe('spaceNav', () => {
  it('keeps Menu and Cashier free of pharmacy and platform items', () => {
    const food = keys(spaceNav('food'));
    expect(food).toEqual(['overview', 'restaurants', 'billing', 'cashierOverview', 'menus', 'media', 'people', 'announcements', 'platformIntro', 'activity', 'settings']);
    expect(food.filter((key) => key.startsWith('pharmacy') || key === 'pharmacies' || key.startsWith('team'))).toEqual([]);
  });

  it('keeps Pharmacy free of the cashier, menus and restaurants', () => {
    const pharmacy = keys(spaceNav('pharmacy'));
    expect(pharmacy).toEqual(['pharmacyOverview', 'pharmacies', 'pharmacyBilling', 'pharmacyPeople', 'pharmacyAnnouncements', 'pharmacyActivity', 'pharmacySettings']);
    for (const absent of ['cashierOverview', 'menus', 'restaurants', 'media', 'platformIntro']) expect(pharmacy).not.toContain(absent);
  });

  it('gives the Platform entry only the team and its settings', () => {
    expect(keys(spaceNav('platform'))).toEqual(['team', 'teamSettings']);
  });

  it('puts every item of a space under that space', () => {
    for (const space of ['food', 'pharmacy', 'platform'] as SpaceId[]) {
      for (const item of spaceNav(space)) expect(spaceOfPath(item.href)).toBe(space);
    }
  });

  it('leaves the navigation of an owner and a designer as it was', () => {
    const owner = actor({ memberships: [{ restaurantId: 'r1', role: 'OWNER' }] });
    expect(keys(visibleNav(owner))).toEqual(['myRestaurant', 'myMenu']);
    expect(keys(visibleNav(actor({ memberships: [{ restaurantId: 'r1', role: 'DESIGNER' }] })))).toEqual(['overview', 'restaurants', 'menus', 'media']);
  });
});

describe('openRetailNavItem', () => {
  const owner = actor({ memberships: [{ restaurantId: 'shop-1', role: 'OWNER' }] });

  it('takes an owner of one retail shop straight to it, as a plain link (the target is a redirecting Route Handler)', () => {
    expect(openRetailNavItem(owner, [{ id: 'shop-1' }])).toEqual({
      key: 'openRetail',
      href: '/studio/retail/open/shop-1',
      labelKey: 'retail.open',
      icon: 'retail',
      plain: true,
    });
  });

  it('sends an owner of several retail shops to the chooser', () => {
    expect(openRetailNavItem(owner, [{ id: 'shop-1' }, { id: 'shop-2' }])).toMatchObject({ key: 'openRetail', href: '/studio/retail/choose', plain: true });
  });

  it('is nothing without a retail shop, and nothing for a Super Admin', () => {
    expect(openRetailNavItem(owner, [])).toBeNull();
    expect(openRetailNavItem(actor({ isSuperAdmin: true }), [{ id: 'shop-1' }])).toBeNull();
  });

  it('is added beside an owner’s own items, which stay as they are', () => {
    const items = visibleNav(owner, [{ id: 'shop-1', name: 'Shop', menuIds: [] }]);
    expect(keys(items)).toEqual(['myRestaurant', 'myMenu']);
  });
});
