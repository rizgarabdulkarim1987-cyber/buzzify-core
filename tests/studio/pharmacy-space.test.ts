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
const read = (relative: string) => readFileSync(path.join(APP, relative), 'utf8');

describe('the Pharmacy space routes', () => {
  it('has a page for each screen of the space', () => {
    for (const screen of ['page', 'new/page', 'overview/page', 'billing/page', 'people/page', 'activity/page', 'settings/page']) {
      expect(existsSync(path.join(APP, 'pharmacy', `${screen}.tsx`)), screen).toBe(true);
    }
    for (const tab of ['page', 'branches/page', 'billing/page', 'people/page', 'activity/page']) {
      expect(existsSync(path.join(APP, 'pharmacy/[id]', `${tab}.tsx`)), tab).toBe(true);
    }
  });

  it('is closed to everyone but a Super Admin, and refuses a business of the other project', () => {
    expect(read('pharmacy/layout.tsx')).toMatch(/!actor\.isSuperAdmin\) notFound\(\)/);
    expect(read('pharmacy/[id]/layout.tsx')).toMatch(/sector !== 'PHARMACY'\) notFound\(\)/);
  });

  it('keeps every screen of the space on the pharmacy sector', () => {
    expect(read('pharmacy/billing/page.tsx')).toContain('space="pharmacy"');
    expect(read('pharmacy/people/page.tsx')).toContain('space="pharmacy"');
    expect(read('pharmacy/activity/page.tsx')).toContain('space="pharmacy"');
    expect(read('pharmacy/overview/page.tsx')).toContain("space: 'pharmacy'");
    expect(read('pharmacy/new/page.tsx')).toContain('space="pharmacy"');
  });

  it('holds the pharmacy plans in its own settings, and sends the old plans address there', () => {
    expect(read('pharmacy/settings/page.tsx')).toContain('AppPlansEditor');
    expect(read('billing/plans/page.tsx')).toContain("redirect('/studio/pharmacy/settings')");
  });

  it('sends the old Pharmacy list address to the space', () => {
    expect(read('pharmacies/page.tsx')).toContain("redirect('/studio/pharmacy')");
  });
});

describe('the screens of the Pharmacy space stay in it', () => {
  it('links the overview all-activity link to the Pharmacy activity', () => {
    expect(read('overview/OverviewParts.tsx')).toContain('activityHref');
    expect(read('pharmacy/overview/page.tsx')).toContain('/studio/pharmacy/activity');
  });

  it('offers the Super Admin invitation only where it is listed, the Platform space', () => {
    expect(read('people/PeopleManager.tsx')).toMatch(/space === 'platform' &&/);
  });
});

describe('the restaurant pickers of a space', () => {
  beforeEach(() => {
    searchRestaurants.mockReset();
    searchRestaurants.mockResolvedValue({ ok: true, data: { rows: [{ id: 'r1', name: 'Alpha', clientId: 'C-1', city: 'Erbil' }] } });
  });

  it('search only the space they are made for', async () => {
    const { findRestaurantOptionsIn, findRestaurantOptions } = await import('@/studio/pickers');
    await findRestaurantOptionsIn.pharmacy('al');
    expect(searchRestaurants).toHaveBeenLastCalledWith({ q: 'al', space: 'pharmacy' });
    await findRestaurantOptionsIn.food('al');
    expect(searchRestaurants).toHaveBeenLastCalledWith({ q: 'al', space: 'food' });
    await findRestaurantOptions('al');
    expect(searchRestaurants).toHaveBeenLastCalledWith({ q: 'al' });
  });

  it('turn a match into an option', async () => {
    const { findRestaurantOptionsIn } = await import('@/studio/pickers');
    expect(await findRestaurantOptionsIn.pharmacy('al')).toEqual([{ value: 'r1', label: 'Alpha', detail: 'C-1 · Erbil' }]);
  });
});
