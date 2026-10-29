import { revalidateTag, unstable_cache, updateTag } from 'next/cache';

/** Inside the Next.js server; false in Vitest and in scripts such as the seed, which have no data cache. */
function inNextRuntime(): boolean {
  return Boolean(process.env.NEXT_RUNTIME);
}

/**
 * When this process last expired each tag, by the system clock. `updateTag` does not by itself guarantee that the next
 * read misses, for two reasons:
 *
 * - Next stamps the expiry with `Date.now()` but treats the tag as expired only once
 *   `performance.timeOrigin + performance.now()` has reached that stamp (`areTagsExpired`). In a long-running server the
 *   two clocks drift apart: time synchronisation slews the system clock, not the monotonic one. Measured on a
 *   development machine, they drifted by about 11 ms a minute, and the dev server served the old answer for the first
 *   140 to 200 ms after every change ("Menu suspended" shown, the guest still saw the menu).
 * - A read that queried the database before the change committed can store its answer after the expiry. The entry is
 *   then newer than the expiry, and it is served until it revalidates, for up to 5 minutes.
 *
 * So every cached answer carries the time its database read started. An answer read before this process last expired
 * one of its tags is not used: the read goes to the database. Kept for longer than any of these entries can live, on
 * `globalThis`: Server Actions and pages are bundled apart, and each bundle has its own copy of this module.
 */
const globalForCache = globalThis as unknown as { __buzzifyTagExpiries?: Map<string, number> };
const expiredAt = (globalForCache.__buzzifyTagExpiries ??= new Map<string, number>());
const EXPIRY_MEMORY_MS = 10 * 60_000;

function forgetOldExpiries(now: number): void {
  for (const [tag, at] of expiredAt) if (now - at > EXPIRY_MEMORY_MS) expiredAt.delete(tag);
}

/** Whether something read at `readAt` may predate a change this process has expired one of `tags` for. */
function readBeforeExpiry(readAt: number, tags: readonly string[]): boolean {
  return tags.some((tag) => (expiredAt.get(tag) ?? -Infinity) >= readAt);
}

/** A cached answer and the time (system clock) its database read started. */
interface Stamped<T> {
  readAt: number;
  value: T;
}

/**
 * Uses the Next.js data cache inside the Next runtime and calls straight through elsewhere (tests, scripts). An answer
 * read before one of its tags was last expired here goes back to the database (see `expiredAt`).
 */
export function cached<T>(
  fn: () => Promise<T>,
  keyParts: string[],
  options: { revalidate: number | false; tags: string[] },
): () => Promise<T> {
  if (!inNextRuntime()) return fn;
  const read = unstable_cache(
    async (): Promise<Stamped<T>> => {
      const readAt = Date.now();
      return { readAt, value: await fn() };
    },
    keyParts,
    options,
  );
  return async () => {
    const answer = await read();
    return readBeforeExpiry(answer.readAt, options.tags) ? fn() : answer.value;
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// What the public read path caches. Every value is plain JSON, which is how the data cache stores it.
// ---------------------------------------------------------------------------------------------------------------------

const revisionTag = (revisionId: string) => `revision:${revisionId}`;
const liveTag = (menuId: string) => `live:${menuId}`;
const slugTag = (slug: string) => `slug:${slug}`;
/** What the plans hold: every address carries it too, since what a menu shows guests depends on its plan. */
const PLANS_TAG = 'plans';

/** A revision's snapshot. Revisions never change, so it is kept until the cache drops it. */
export function cachedRevisionSnapshot<T>(menuId: string, revisionId: string, load: () => Promise<T>): Promise<T> {
  return cached(load, ['revision', menuId, revisionId], { revalidate: false, tags: [revisionTag(revisionId)] })();
}

/** A menu's live overlay (sold out, hidden, stock). At most 30 seconds old, and expired by `expireLive`. */
export function cachedLiveOverlay<T>(menuId: string, load: () => Promise<T>): Promise<T> {
  return cached(load, ['live', menuId], { revalidate: 30, tags: [liveTag(menuId)] })();
}

/**
 * What a slug opens: the menu, its status, its live revision and what its plan shows guests. At most 5 minutes old, and
 * expired by `expireMenu`, or by `expirePlans` with every other address.
 */
export function cachedSlugResolution<T>(slug: string, load: () => Promise<T>): Promise<T> {
  // The data cache can outlive a deploy, so a change to what the answer carries moves the key (2: the guest features of
  // the restaurant's plan; 3: the menu's motions; 4: offers and the labels drawn from guest data; 5: the menu's id on an unavailable answer), and an answer cached
  // by the previous version is never read as the new one.
  return cached(load, ['slug', '6', slug], { revalidate: 300, tags: [slugTag(slug), PLANS_TAG] })();
}

/** The plans the platform owner set. At most 5 minutes old, and expired by `expirePlans`. */
export function cachedPlans<T>(load: () => Promise<T>): Promise<T> {
  return cached(load, ['plans'], { revalidate: 300, tags: [PLANS_TAG] })();
}

// ---------------------------------------------------------------------------------------------------------------------
// Expiry. Call these after the transaction that made the change has committed.
// ---------------------------------------------------------------------------------------------------------------------

function expire(tag: string): void {
  if (!inNextRuntime()) return;
  const now = Date.now();
  forgetOldExpiries(now);
  expiredAt.set(tag, now);
  try {
    // In a Server Action the next read waits for fresh data, so the person who made the change sees it at once.
    updateTag(tag);
  } catch {
    // Anywhere else (a Route Handler, a cron job) `updateTag` throws. `{ expire: 0 }` is its equivalent there:
    // nothing stale is served and the next read is a blocking miss.
    revalidateTag(tag, { expire: 0 });
  }
}

/**
 * After a change to the menu itself: a publish, a status change, a slug change or a deletion, or a change to its
 * restaurant's status. `slugs` must hold every slug the menu has had, since each one's resolution is cached on its own.
 * The live overlay is expired too, because a publish can bring products into the menu whose live state the cached
 * overlay has never seen.
 */
export function expireMenu(slugs: readonly string[], menuId: string): void {
  for (const slug of new Set(slugs)) expire(slugTag(slug));
  expire(liveTag(menuId));
}

/** After the platform owner changes what the plans hold: the plans and every address, which depend on them. */
export function expirePlans(): void {
  expire(PLANS_TAG);
}

/** After a change to what is live without a publish: availability, hidden products, stock. */
export function expireLive(menuId: string): void {
  expire(liveTag(menuId));
}
