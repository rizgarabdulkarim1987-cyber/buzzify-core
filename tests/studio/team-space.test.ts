import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getStudioTranslator } from '@/studio/messages';
import { settingsTabs } from '@/app/studio/(studio)/(app)/settings/tabs';
import { spaceNav } from '@/studio/nav';

const searchRestaurants = vi.fn();
vi.mock('@/app/studio/_actions/search', () => ({
  searchRestaurants: (input: unknown) => searchRestaurants(input),
  searchMenus: vi.fn(),
  searchPeople: vi.fn(),
}));

const APP = path.join(process.cwd(), 'src/app/studio/(studio)/(app)');
const read = (relative: string) => readFileSync(path.join(APP, relative), 'utf8');

describe('the Platform space', () => {
  it('has the team and the platform settings, and nothing else in its navigation', () => {
    expect(spaceNav('platform').map((item) => item.key)).toEqual(['team', 'teamSettings']);
  });

  it('is closed to everyone but a Super Admin', () => {
    expect(existsSync(path.join(APP, 'team/layout.tsx'))).toBe(true);
    expect(read('team/layout.tsx')).toMatch(/!actor\.isSuperAdmin\) notFound\(\)/);
  });

  it('lists the team through the platform space of People', () => {
    expect(read('team/page.tsx')).toContain('space="platform"');
  });

  it('holds the general settings form, which the Menu and Cashier settings no longer carry', () => {
    expect(read('team/settings/page.tsx')).toContain('SettingsForm');
    expect(read('settings/page.tsx')).toContain("redirect('/studio/settings/plans')");
    const hrefs = settingsTabs(getStudioTranslator('en')).map((tab) => tab.href);
    expect(hrefs).toEqual(['/studio/settings/plans', '/studio/settings/billing', '/studio/settings/ai']);
  });
});

describe('the restaurant picker of the Platform space', () => {
  beforeEach(() => {
    searchRestaurants.mockReset();
    searchRestaurants.mockImplementation(async ({ space }: { space: string }) => ({
      ok: true,
      data: { rows: space === 'pharmacy' ? [{ id: 'p1', name: 'Alpha Pharmacy', clientId: 'P-1', city: null }] : [{ id: 'f1', name: 'Cafe Beta', clientId: 'F-1', city: null }] },
    }));
  });

  it('finds the businesses of both projects, so a new designer can be given work in either', async () => {
    const { findRestaurantOptionsIn } = await import('@/studio/pickers');
    const options = await findRestaurantOptionsIn.platform('a');
    expect(options.map((option) => option.value).sort()).toEqual(['f1', 'p1']);
  });
});
