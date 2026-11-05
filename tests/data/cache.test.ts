import { areTagsExpired, tagsManifest } from 'next/dist/server/lib/incremental-cache/tags-manifest.external.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const next = vi.hoisted(() => ({
  unstable_cache: vi.fn<(fn: () => Promise<unknown>, keyParts: string[], options: { tags: string[] }) => () => Promise<unknown>>((fn) => fn),
  updateTag: vi.fn(),
  revalidateTag: vi.fn(),
}));
vi.mock('next/cache', () => next);

const {
  cached,
  cachedLiveOverlay,
  cachedPlans,
  cachedRevisionSnapshot,
  cachedSlugResolution,
  expireLive,
  expireMenu,
  expirePlans,
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
      expect(next.unstable_cache).toHaveBeenCalledWith(expect.any(Function), ['revision', 'm1', 'r1'], {
        revalidate: false,
        tags: ['revision:r1'],
      });
    });

    it('keeps the live overlay for 30 seconds and a slug resolution for 5 minutes', async () => {
      await cachedLiveOverlay('m1', load);
      await cachedSlugResolution('atelier', load);
      expect(next.unstable_cache).toHaveBeenCalledWith(expect.any(Function), ['live', 'm1'], { revalidate: 30, tags: ['live:m1'] });
      // Keyed by the shape of the answer (8: it carries the stories), so an answer cached before a deploy that
      // changed the shape is never read as the new one.
      expect(next.unstable_cache).toHaveBeenCalledWith(expect.any(Function), ['slug', '8', 'atelier'], {
        revalidate: 300,
        tags: ['slug:atelier', 'plans'],
      });
    });

    it('keeps the plans for 5 minutes, and expirePlans expires them with every address at once', async () => {
      await cachedPlans(load);
      expect(next.unstable_cache).toHaveBeenCalledWith(expect.any(Function), ['plans'], { revalidate: 300, tags: ['plans'] });
      expirePlans();
      expect(next.updateTag.mock.calls.map(([tag]) => tag)).toEqual(['plans']);
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

  /**
   * The data cache as Next's file-system cache runs it, with Next's own expiry check (`areTagsExpired`): an entry is
   * stamped with `Date.now()` when it is stored, `updateTag` stamps the tag with `Date.now()`, and a read treats the
   * entry as expired once `performance.timeOrigin + performance.now()` has reached the tag's stamp. The clocks are
   * driven by the test.
   */
  describe('after a change, against Next’s own expiry check', () => {
    let wall = 1_800_000_000_000;
    /** How far the monotonic clock is behind the system clock. */
    let behind = 0;

    beforeEach(() => {
      process.env.NEXT_RUNTIME = 'nodejs';
      wall = 1_800_000_000_000;
      behind = 0;
      vi.spyOn(Date, 'now').mockImplementation(() => wall);
      vi.spyOn(performance, 'now').mockImplementation(() => wall - behind - performance.timeOrigin);
      const entries = new Map<string, { value: unknown; lastModified: number }>();
      next.unstable_cache.mockImplementation(
        (fn: () => Promise<unknown>, keyParts: string[], options: { tags: string[] }) => async () => {
          const key = keyParts.join('|');
          const entry = entries.get(key);
          if (entry && !areTagsExpired(options.tags, entry.lastModified)) return entry.value;
          const value = await fn();
          entries.set(key, { value, lastModified: Date.now() });
          return value;
        },
      );
      next.updateTag.mockImplementation((tag: string) => {
        tagsManifest.set(tag, { ...tagsManifest.get(tag), expired: Date.now() });
      });
    });

    afterEach(() => {
      vi.restoreAllMocks();
      next.unstable_cache.mockImplementation((fn: () => Promise<unknown>) => fn);
    });

    it('does not serve the old answer while the monotonic clock is behind the system clock', async () => {
      behind = 500;
      let status = 'live';
      const load = vi.fn(() => Promise.resolve(status));
      expect(await cachedSlugResolution('skewed', load)).toBe('live');

      wall += 1_000;
      status = 'unavailable';
      expireMenu(['skewed'], 'm-skewed');
      wall += 100;
      // Next itself does not see the expiry yet: its clock is 400 ms short of the stamp.
      expect(areTagsExpired(['slug:skewed'], wall - 1_100)).toBe(false);
      expect(await cachedSlugResolution('skewed', load)).toBe('unavailable');

      // Once Next sees it, the new answer is cached and served from the cache again.
      wall += 1_000;
      expect(await cachedSlugResolution('skewed', load)).toBe('unavailable');
      const reads = load.mock.calls.length;
      wall += 1_000;
      expect(await cachedSlugResolution('skewed', load)).toBe('unavailable');
      expect(load).toHaveBeenCalledTimes(reads);
    });

    it('does not keep an answer read before the change and stored after it', async () => {
      let status = 'live';
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      const slow = vi.fn(async () => {
        const seen = status;
        await gate;
        return seen;
      });
      // A guest's read queries the database before the change commits…
      const inFlight = cachedSlugResolution('raced', slow);
      wall += 100;
      status = 'unavailable';
      expireMenu(['raced'], 'm-raced');
      // …and stores its answer after the expiry, so Next takes the entry for newer than the change.
      wall += 100;
      release();
      await inFlight;
      wall += 100;
      expect(await cachedSlugResolution('raced', slow)).toBe('unavailable');
    });
  });
});
