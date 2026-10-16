import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const next = vi.hoisted(() => ({
  unstable_cache: vi.fn((fn: () => Promise<unknown>) => fn),
  updateTag: vi.fn(),
  revalidateTag: vi.fn(),
}));
vi.mock('next/cache', () => next);

const {
  cached,
  cachedLiveOverlay,
  cachedRevisionSnapshot,
  cachedSlugResolution,
  expireLive,
  expireMenu,
} = await import('@/server/data/cache');

const load = () => Promise.resolve('value');

describe('data cache', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    next.updateTag.mockImplementation(() => undefined);
  });

  afterEach(() => {
    delete process.env.NEXT_RUNTIME;
  });

  describe('outside the Next runtime (tests, the seed)', () => {
    it('calls straight through and expires nothing', async () => {
      expect(cached(load, ['k'], { revalidate: 60, tags: ['t'] })).toBe(load);
      expect(await cachedSlugResolution('atelier', load)).toBe('value');
      expireMenu(['atelier'], 'm1');
      expireLive('m1');
      expect(next.unstable_cache).not.toHaveBeenCalled();
      expect(next.updateTag).not.toHaveBeenCalled();
      expect(next.revalidateTag).not.toHaveBeenCalled();
    });
  });

  describe('inside the Next runtime', () => {
    beforeEach(() => {
      process.env.NEXT_RUNTIME = 'nodejs';
    });

    it('keeps a revision snapshot until the cache drops it', async () => {
      expect(await cachedRevisionSnapshot('m1', 'r1', load)).toBe('value');
      expect(next.unstable_cache).toHaveBeenCalledWith(load, ['revision', 'm1', 'r1'], {
        revalidate: false,
        tags: ['revision:r1'],
      });
    });

    it('keeps the live overlay for 30 seconds and a slug resolution for 5 minutes', async () => {
      await cachedLiveOverlay('m1', load);
      await cachedSlugResolution('atelier', load);
      expect(next.unstable_cache).toHaveBeenCalledWith(load, ['live', 'm1'], { revalidate: 30, tags: ['live:m1'] });
      expect(next.unstable_cache).toHaveBeenCalledWith(load, ['slug', 'atelier'], {
        revalidate: 300,
        tags: ['slug:atelier'],
      });
    });

    it('expires every slug of a menu and its overlay with updateTag in a Server Action', () => {
      expireMenu(['atelier', 'old-atelier', 'atelier'], 'm1');
      expect(next.updateTag.mock.calls.map(([tag]) => tag)).toEqual(['slug:atelier', 'slug:old-atelier', 'live:m1']);
      expect(next.revalidateTag).not.toHaveBeenCalled();
    });

    it('falls back to revalidateTag with no stale window where updateTag is not allowed', () => {
      next.updateTag.mockImplementation(() => {
        throw new Error('updateTag can only be called from within a Server Action.');
      });
      expireLive('m1');
      expect(next.revalidateTag).toHaveBeenCalledExactlyOnceWith('live:m1', { expire: 0 });
    });
  });
});
