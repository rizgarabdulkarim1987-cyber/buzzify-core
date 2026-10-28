import type { MediaKind } from '@/generated/prisma/client';
import type { AnyDb, ScopedDb } from '@/server/data/tenant-db';
import { safeHref } from '@/server/domain/intro';
import { loadAssets } from '@/server/media/resolve';
import { StudioError } from '@/server/studio/framework/result';

/**
 * An asset the intro may show: the restaurant's own or one from the shared library, of the kinds allowed. A video also needs its
 * poster (the page shows it while the video loads, and in place of it when the visitor asks for less data).
 */
export async function requireIntroAsset(db: AnyDb | ScopedDb, restaurantId: string, assetId: string, kinds: readonly MediaKind[], field: string): Promise<MediaKind> {
  // Another restaurant's asset and a missing one answer alike: not found.
  const found = (await loadAssets(db as AnyDb, restaurantId, [assetId], kinds)).get(assetId);
  if (!found) throw new StudioError('NOT_FOUND', undefined, { [field]: 'Choose a picture from your library' });
  if (found.kind === 'VIDEO') {
    const poster = (found.variants as { poster?: unknown } | null)?.poster;
    if (!poster) throw new StudioError('INVALID', undefined, { [field]: 'This video has no poster picture' });
  }
  return found.kind;
}

/** An advert's link: empty stays empty; anything that is not https or a path on the menu is refused rather than silently dropped. */
export function advertHref(value: string, field = 'href'): string {
  const trimmed = value.trim();
  if (trimmed === '') return '';
  const safe = safeHref(trimmed);
  if (safe === '') throw new StudioError('INVALID', undefined, { [field]: 'Use an https address or a path starting with /' });
  return safe;
}

export function requireWindow(startsAt: Date | null, endsAt: Date | null): void {
  if (startsAt && endsAt && endsAt.getTime() < startsAt.getTime()) throw new StudioError('INVALID', undefined, { endsAt: 'The end must come after the start' });
}
