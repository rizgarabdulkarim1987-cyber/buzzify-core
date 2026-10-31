import { Pill, ShoppingBag, Store } from 'lucide-react';
import type { Translate } from '@/lib/i18n';
import type { BusinessSector } from '@/server/domain/restaurant-profile';

/** A business's sector as an icon and a word: the icon never stands alone. */
export function SectorBadge({ sector, t }: { sector: BusinessSector; t: Translate }) {
  const Icon = sector === 'PHARMACY' ? Pill : sector === 'RETAIL' ? ShoppingBag : Store;
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-sm text-text">
      <Icon aria-hidden className="size-4 text-muted" />
      {t(`restaurants.sector.${sector}`)}
    </span>
  );
}
