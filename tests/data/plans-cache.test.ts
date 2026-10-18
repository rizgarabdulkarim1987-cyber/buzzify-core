import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { allows, defaultPlans, effectiveEntitlements, plansToStore } from '@/server/domain/entitlements';

// Next's data cache keeps what it caches as JSON (`JSON.stringify` on the way in, `JSON.parse` on the way out), so a
// cache hit gets back only what JSON can hold. This stands in for it: the first call stores, the next ones read the JSON.
const stored = vi.hoisted(() => new Map<string, string>());
vi.mock('next/cache', () => ({
  unstable_cache: (fn: () => Promise<unknown>, keyParts: string[]) => async () => {
    const key = keyParts.join('/');
    if (!stored.has(key)) stored.set(key, JSON.stringify(await fn()));
    return JSON.parse(stored.get(key)!) as unknown;
  },
  updateTag: vi.fn(),
  revalidateTag: vi.fn(),
}));

const { livePlans } = await import('@/server/data/public-menu');

describe('the plans the guest pages read through the data cache', () => {
  beforeAll(() => {
    process.env.NEXT_RUNTIME = 'nodejs';
  });
  afterAll(() => {
    delete process.env.NEXT_RUNTIME;
  });

  it('are the same from a cache hit as from the database', async () => {
    const custom = plansToStore(defaultPlans());
    custom.BASIC.features['immersive.explore'] = true;
    const db = { platformSetting: { findUnique: async () => ({ value: custom }) } } as never;

    const fresh = await livePlans(db);
    const fromCache = await livePlans(db);
    for (const plan of ['BASIC', 'PRO', 'PREMIUM'] as const) {
      expect(effectiveEntitlements({ plan, plans: fromCache, extras: {} })).toEqual(effectiveEntitlements({ plan, plans: fresh, extras: {} }));
    }
    expect(allows(effectiveEntitlements({ plan: 'BASIC', plans: fromCache, extras: {} }), 'immersive.explore')).toBe(true);
  });
});
