import { describe, expect, it } from 'vitest';
import { RETAIL_HANDOFF } from '@/studio/nav';
import {
  activityOfSpace,
  bigSpaces,
  businessBase,
  businessPath,
  movedBusinessAddressOf,
  oldRetailAddressOf,
  retailAddressIn,
  sectorOfSpace,
  spaceOfBusiness,
  SPACES,
  spaceOfPath,
  type Space,
} from '@/studio/spaces';

describe('spaceOfPath', () => {
  it('knows the pharmacy, the three Retail products and the platform by their prefix', () => {
    expect(spaceOfPath('/studio/supermarket')).toBe('supermarket');
    expect(spaceOfPath('/studio/supermarket/abc/retail')).toBe('supermarket');
    expect(spaceOfPath('/studio/electronics/abc')).toBe('electronics');
    expect(spaceOfPath('/studio/clothing/overview')).toBe('clothing');
    expect(spaceOfPath('/studio/pharmacy')).toBe('pharmacy');
    expect(spaceOfPath('/studio/pharmacy/abc/billing')).toBe('pharmacy');
    expect(spaceOfPath('/studio/team')).toBe('platform');
    expect(spaceOfPath('/studio/team/settings')).toBe('platform');
  });

  it('leaves every other Studio path to Menu and Cashier', () => {
    for (const path of ['/studio', '/studio/restaurants', '/studio/menus/1', '/studio/platform/intro', '/studio/pharmacies']) {
      expect(spaceOfPath(path)).toBe('food');
    }
  });

  it('matches whole segments only', () => {
    expect(spaceOfPath('/studio/pharmacyx')).toBe('food');
    expect(spaceOfPath('/studio/teamwork')).toBe('food');
    expect(spaceOfPath('/studio/supermarkets')).toBe('food');
    expect(spaceOfPath('/studio/clothingx')).toBe('food');
  });
});

describe('spaceOfBusiness and businessPath', () => {
  it('puts a pharmacy in the Pharmacy space and a food business in Menu and Cashier', () => {
    expect(businessPath(spaceOfBusiness('PHARMACY'), 'p1', 'billing')).toBe('/studio/pharmacy/p1/billing');
    expect(businessPath('pharmacy', 'p1')).toBe('/studio/pharmacy/p1');
    expect(businessPath(spaceOfBusiness('FOOD'), 'r1')).toBe('/studio/restaurants/r1');
    expect(businessPath('food', 'r1', 'menus')).toBe('/studio/restaurants/r1/menus');
  });

  it('puts a retail shop in its own product space, and a shop of no known product in the Supermarket', () => {
    expect(spaceOfBusiness('RETAIL', 'SUPERMARKET')).toBe('supermarket');
    expect(spaceOfBusiness('RETAIL', 'ELECTRONICS')).toBe('electronics');
    expect(spaceOfBusiness('RETAIL', 'CLOTHING')).toBe('clothing');
    expect(spaceOfBusiness('RETAIL')).toBe('supermarket');
    expect(spaceOfBusiness('RETAIL', null)).toBe('supermarket');
    expect(businessPath('electronics', 's1', 'retail')).toBe('/studio/electronics/s1/retail');
    expect(businessBase('supermarket')).toBe('/studio/supermarket');
    expect(businessBase('clothing')).toBe('/studio/clothing');
    expect(businessBase('pharmacy')).toBe('/studio/pharmacy');
    expect(businessBase('food')).toBe('/studio/restaurants');
  });
});

describe('movedBusinessAddressOf', () => {
  it('moves the old Menu and Cashier address of a business into its space, keeping the tab', () => {
    expect(movedBusinessAddressOf('/studio/restaurants/s1', 's1', 'electronics')).toBe('/studio/electronics/s1');
    expect(movedBusinessAddressOf('/studio/restaurants/s1/retail/', 's1', 'supermarket')).toBe('/studio/supermarket/s1/retail');
    expect(movedBusinessAddressOf('/studio/restaurants/s1/billing', 's1', 'pharmacy')).toBe('/studio/pharmacy/s1/billing');
  });

  it('names no other address for another business, another prefix or a food business', () => {
    expect(movedBusinessAddressOf('/studio/restaurants/s10', 's1', 'supermarket')).toBeNull();
    expect(movedBusinessAddressOf('/studio/supermarket/s1', 's1', 'supermarket')).toBeNull();
    expect(movedBusinessAddressOf('/studio/restaurants/r1', 'r1', 'food')).toBeNull();
  });
});

describe('the old Retail addresses', () => {
  it('go to the same page of the Supermarket', () => {
    expect(oldRetailAddressOf('/studio/retail', RETAIL_HANDOFF)).toBe('/studio/supermarket');
    expect(oldRetailAddressOf('/studio/retail/', RETAIL_HANDOFF)).toBe('/studio/supermarket');
    expect(oldRetailAddressOf('/studio/retail/new', RETAIL_HANDOFF)).toBe('/studio/supermarket/new');
    expect(oldRetailAddressOf('/studio/retail/s1/retail', RETAIL_HANDOFF)).toBe('/studio/supermarket/s1/retail');
    expect(oldRetailAddressOf('/studio/retail/settings', RETAIL_HANDOFF)).toBe('/studio/supermarket/settings');
  });

  it('leave the owners’ handoff and other prefixes alone', () => {
    for (const path of ['/studio/retail/open/s1', '/studio/retail/continue', '/studio/retail/choose']) expect(oldRetailAddressOf(path, RETAIL_HANDOFF)).toBeNull();
    expect(oldRetailAddressOf('/studio/retailers', RETAIL_HANDOFF)).toBeNull();
    expect(oldRetailAddressOf('/studio/supermarket', RETAIL_HANDOFF)).toBeNull();
  });

  it('a shop opened under another product moves to the same page of its own', () => {
    expect(retailAddressIn('/studio/supermarket/s1/billing', 'supermarket', 'clothing')).toBe('/studio/clothing/s1/billing');
    expect(retailAddressIn('/studio/supermarket/s1/', 'supermarket', 'electronics')).toBe('/studio/electronics/s1');
    expect(retailAddressIn('/studio/pharmacy/s1', 'supermarket', 'electronics')).toBeNull();
  });
});

describe('sectorOfSpace and activityOfSpace', () => {
  it('maps the business spaces to a sector, each Retail product to its activity, and the platform to none', () => {
    for (const space of ['supermarket', 'electronics', 'clothing'] as const) expect(sectorOfSpace(space)).toBe('RETAIL');
    expect(activityOfSpace('supermarket')).toBe('SUPERMARKET');
    expect(activityOfSpace('electronics')).toBe('ELECTRONICS');
    expect(activityOfSpace('clothing')).toBe('CLOTHING');
    expect(activityOfSpace('pharmacy')).toBeNull();
    expect(sectorOfSpace('food')).toBe('FOOD');
    expect(sectorOfSpace('pharmacy')).toBe('PHARMACY');
    expect(sectorOfSpace('platform')).toBeNull();
  });
});

describe('the registry', () => {
  it('has five big icons, the three Retail products apart, and Platform small', () => {
    expect(bigSpaces().map((space) => space.id)).toEqual(['food', 'pharmacy', 'supermarket', 'electronics', 'clothing']);
    expect(SPACES.find((space) => space.id === 'platform')?.big).toBe(false);
    expect(new Set(SPACES.map((space) => space.icon)).size).toBe(SPACES.length);
  });

  it('gives a new project its own icon and path without touching the others', () => {
    const extra: Space = { id: 'clinic' as never, nameKey: 'hub.clinic', icon: 'pharmacy', home: '/studio/clinic', sectors: [], prefix: '/studio/clinic', big: true };
    const registry = [...SPACES, extra];
    expect(bigSpaces(registry).map((space) => space.id)).toEqual(['food', 'pharmacy', 'supermarket', 'electronics', 'clothing', 'clinic']);
    expect(spaceOfPath('/studio/clinic/x', registry)).toBe('clinic');
    expect(spaceOfPath('/studio/pharmacy/x', registry)).toBe('pharmacy');
    expect(spaceOfPath('/studio/restaurants', registry)).toBe('food');
  });
});
