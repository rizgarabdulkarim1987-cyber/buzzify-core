import type { Locale } from '@/lib/locale';
import type { ScopedDb } from '@/server/data/tenant-db';
import { StudioError } from '@/server/studio/framework/result';
import type { LocaleTexts } from '@/server/studio/services/about';

/** Whether a dish's stored media holds a library photo (resolved or still an asset reference): the wheel shows real photos only. */
export function hasPhoto(media: unknown): boolean {
  return Array.isArray(media) && media.some((item) => item && typeof item === 'object' && ((item as { kind?: unknown }).kind === 'image' || (item as { kind?: unknown }).kind === 'asset'));
}

/** The dishes a wheel may use: ids of this menu with a photo. Another menu's dish answers like a missing one; a dish with no photo is refused with a reason. */
export async function requireWheelDishes(db: ScopedDb, menuId: string, productIds: readonly string[]): Promise<void> {
  const rows = await db.product.findMany({ where: { menuId, id: { in: [...productIds] } }, select: { id: true, media: true } });
  const found = new Set(rows.map((row) => row.id));
  if (productIds.some((id) => !found.has(id))) throw new StudioError('NOT_FOUND', undefined, { slices: 'Choose a dish of this menu' });
  if (rows.some((row) => !hasPhoto(row.media))) throw new StudioError('INVALID', undefined, { slices: 'Every dish on the wheel needs a photo' });
}

export interface WheelSliceRow {
  productId: string;
  label: LocaleTexts;
  weight: number;
}

export interface WheelCandidate {
  id: string;
  name: string;
  /** Thumbnail URL of the dish's first library photo, when the form can show one. */
  thumb: string | null;
}

/** Everything the Studio's Wheel tab shows. */
export interface WheelStudioView {
  slug: string;
  enabled: boolean;
  saved: boolean;
  defaultLocale: Locale;
  locales: Locale[];
  timezone: string;
  spinsPerDay: number;
  startsAt: string | null;
  endsAt: string | null;
  title: LocaleTexts;
  slices: WheelSliceRow[];
  candidates: WheelCandidate[];
}
