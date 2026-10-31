import { describe, expect, it } from 'vitest';
import { bigSpaces, businessPath, sectorOfSpace, SPACES, spaceOfPath, type Space } from '@/studio/spaces';

describe('spaceOfPath', () => {
  it('knows the pharmacy and platform spaces by their prefix', () => {
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
  });
});

describe('businessPath', () => {
  it('puts a pharmacy in the Pharmacy space and a food business in Menu and Cashier', () => {
    expect(businessPath('PHARMACY', 'p1', 'billing')).toBe('/studio/pharmacy/p1/billing');
    expect(businessPath('PHARMACY', 'p1')).toBe('/studio/pharmacy/p1');
    expect(businessPath('FOOD', 'r1')).toBe('/studio/restaurants/r1');
    expect(businessPath('FOOD', 'r1', 'menus')).toBe('/studio/restaurants/r1/menus');
  });
});

describe('sectorOfSpace', () => {
  it('maps the two business spaces to a sector and the platform to none', () => {
    expect(sectorOfSpace('food')).toBe('FOOD');
    expect(sectorOfSpace('pharmacy')).toBe('PHARMACY');
    expect(sectorOfSpace('platform')).toBeNull();
  });
});

describe('the registry', () => {
  it('has two big icons and Platform small', () => {
    expect(bigSpaces().map((space) => space.id)).toEqual(['food', 'pharmacy']);
    expect(SPACES.find((space) => space.id === 'platform')?.big).toBe(false);
  });

  it('gives a new project its own icon and path without touching the others', () => {
    const extra: Space = { id: 'clinic' as never, nameKey: 'hub.clinic', icon: 'pharmacy', home: '/studio/clinic', sectors: [], prefix: '/studio/clinic', big: true };
    const registry = [...SPACES, extra];
    expect(bigSpaces(registry).map((space) => space.id)).toEqual(['food', 'pharmacy', 'clinic']);
    expect(spaceOfPath('/studio/clinic/x', registry)).toBe('clinic');
    expect(spaceOfPath('/studio/pharmacy/x', registry)).toBe('pharmacy');
    expect(spaceOfPath('/studio/restaurants', registry)).toBe('food');
  });
});
