import type { Locale } from '@/lib/locale';
import type { UpgradeInfo } from '@/server/studio/services/plans';

/** What the Studio's stories page reads: shared by the query and the editor. */
export interface StoryStudioRow {
  id: string;
  assetId: string;
  /** The library picture's thumbnail; null when the picture is gone from the library. */
  thumb: string | null;
  productId: string | null;
  captions: Partial<Record<Locale, string>>;
  /** ISO instant the story ends. */
  expiresAt: string;
  isActive: boolean;
  ended: boolean;
}

export interface StoriesStudioView {
  restaurantId: string;
  locales: Locale[];
  defaultLocale: Locale;
  timezone: string;
  products: Array<{ id: string; name: string }>;
  stories: StoryStudioRow[];
  upgrade: UpgradeInfo;
}
