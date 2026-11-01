import { describe, expect, it } from 'vitest';
import { bigSpaces, businessBase, businessPath, movedBusinessAddressOf, sectorOfSpace, SPACES, spaceOfPath, type Space } from '@/studio/spaces';

describe('spaceOfPath', () => {
  it('knows the pharmacy, retail and platform spaces by their prefix', () => {
    expect(spaceOfPath('/studio/retail')).toBe('retail');
    expect(spaceOfPath('/studio/retail/abc/retail')).toBe('retail');
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
    expect(spaceOfPath('/studio/retailers')).toBe('food');
  });
});

describe('businessPath', () => {
  it('puts a pharmacy in the Pharmacy space and a food business in Menu and Cashier', () => {
    expect(businessPath('PHARMACY', 'p1', 'billing')).toBe('/studio/pharmacy/p1/billing');
    expect(businessPath('PHARMACY', 'p1')).toBe('/studio/pharmacy/p1');
    expect(businessPath('FOOD', 'r1')).toBe('/studio/restaurants/r1');
    expect(businessPath('FOOD', 'r1', 'menus')).toBe('/studio/restaurants/r1/menus');
  });

  it('puts a retail shop in the Retail space', () => {
    expect(businessPath('RETAIL', 's1')).toBe('/studio/retail/s1');
    expect(businessPath('RETAIL', 's1', 'retail')).toBe('/studio/retail/s1/retail');
    expect(businessBase('retail')).toBe('/studio/retail');
    expect(businessBase('pharmacy')).toBe('/studio/pharmacy');
    expect(businessBase('food')).toBe('/studio/restaurants');
  });
});

describe('movedBusinessAddressOf', () => {
  it('moves the old Menu and Cashier address of a retail shop into the Retail space, keeping the tab', () => {
    expect(movedBusinessAddressOf('/studio/restaurants/s1', 's1', 'RETAIL')).toBe('/studio/retail/s1');
    expect(movedBusinessAddressOf('/studio/restaurants/s1/retail/', 's1', 'RETAIL')).toBe('/studio/retail/s1/retail');
    expect(movedBusinessAddressOf('/studio/restaurants/s1/billing', 's1', 'PHARMACY')).toBe('/studio/pharmacy/s1/billing');
  });

  it('names no other address for another business, another prefix or a food business', () => {
    expect(movedBusinessAddressOf('/studio/restaurants/s10', 's1', 'RETAIL')).toBeNull();
    expect(movedBusinessAddressOf('/studio/retail/s1', 's1', 'RETAIL')).toBeNull();
    expect(movedBusinessAddressOf('/studio/restaurants/r1', 'r1', 'FOOD')).toBeNull();
  });
});

describe('sectorOfSpace', () => {
  it('maps the three business spaces to a sector and the platform to none', () => {
    expect(sectorOfSpace('retail')).toBe('RETAIL');
    expect(sectorOfSpace('food')).toBe('FOOD');
    expect(sectorOfSpace('pharmacy')).toBe('PHARMACY');
    expect(sectorOfSpace('platform')).toBeNull();
  });
});

describe('the registry', () => {
  it('has three big icons and Platform small', () => {
    expect(bigSpaces().map((space) => space.id)).toEqual(['food', 'pharmacy', 'retail']);
    expect(SPACES.find((space) => space.id === 'platform')?.big).toBe(false);
  });

  it('gives a new project its own icon and path without touching the others', () => {
    const extra: Space = { id: 'clinic' as never, nameKey: 'hub.clinic', icon: 'pharmacy', home: '/studio/clinic', sectors: [], prefix: '/studio/clinic', big: true };
    const registry = [...SPACES, extra];
    expect(bigSpaces(registry).map((space) => space.id)).toEqual(['food', 'pharmacy', 'retail', 'clinic']);
    expect(spaceOfPath('/studio/clinic/x', registry)).toBe('clinic');
    expect(spaceOfPath('/studio/pharmacy/x', registry)).toBe('pharmacy');
    expect(spaceOfPath('/studio/restaurants', registry)).toBe('food');
  });
});
