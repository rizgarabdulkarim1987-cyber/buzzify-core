import { revalidateTag, unstable_cache, updateTag } from 'next/cache';

/** Inside the Next.js server; false in Vitest and in scripts such as the seed, which have no data cache. */
function inNextRuntime(): boolean {
  return Boolean(process.env.NEXT_RUNTIME);
}

/** Uses the Next.js data cache inside the Next runtime and calls straight through elsewhere (tests, scripts). */
export function cached<T>(
  fn: () => Promise<T>,
  keyParts: string[],
  options: { revalidate: number | false; tags: string[] },
): () => Promise<T> {
  if (!inNextRuntime()) return fn;
  return unstable_cache(fn, keyParts, options);
}

// ---------------------------------------------------------------------------------------------------------------------
// What the public read path caches. Every value is plain JSON, which is how the data cache stores it.
// ---------------------------------------------------------------------------------------------------------------------

const revisionTag = (revisionId: string) => `revision:${revisionId}`;
const liveTag = (menuId: string) => `live:${menuId}`;
const slugTag = (slug: string) => `slug:${slug}`;

/** A revision's snapshot. Revisions never change, so it is kept until the cache drops it. */
export function cachedRevisionSnapshot<T>(menuId: string, revisionId: string, load: () => Promise<T>): Promise<T> {
  return cached(load, ['revision', menuId, revisionId], { revalidate: false, tags: [revisionTag(revisionId)] })();
}

/** A menu's live overlay (sold out, hidden, stock). At most 30 seconds old, and expired by `expireLive`. */
export function cachedLiveOverlay<T>(menuId: string, load: () => Promise<T>): Promise<T> {
  return cached(load, ['live', menuId], { revalidate: 30, tags: [liveTag(menuId)] })();
}

/** What a slug opens: the menu, its status and its live revision. At most 5 minutes old, and expired by `expireMenu`. */
export function cachedSlugResolution<T>(slug: string, load: () => Promise<T>): Promise<T> {
  return cached(load, ['slug', slug], { revalidate: 300, tags: [slugTag(slug)] })();
}

// ---------------------------------------------------------------------------------------------------------------------
// Expiry. Call these after the transaction that made the change has committed.
// ---------------------------------------------------------------------------------------------------------------------

function expire(tag: string): void {
  if (!inNextRuntime()) return;
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

/** After a change to what is live without a publish: availability, hidden products, stock. */
export function expireLive(menuId: string): void {
  expire(liveTag(menuId));
}
