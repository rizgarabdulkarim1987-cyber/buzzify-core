import { Store } from 'lucide-react';
import type { Translate } from '@/lib/i18n';
import type { BusinessSector } from '@/server/domain/restaurant-profile';
import type { RetailActivity } from '@/server/domain/retail/activity';
import { SPACE_ICONS } from '@/studio/space-icons';
import { spaceOfBusiness } from '@/studio/spaces';

/**
 * A business's sector as an icon and a word: the icon never stands alone. A retail shop shows its Retail product (its
 * icon, and its name when `t` speaks that product's words, as a product's space does).
 */
export function SectorBadge({ sector, activity, t }: { sector: BusinessSector; activity?: RetailActivity | null; t: Translate }) {
  const Icon = sector === 'FOOD' ? Store : SPACE_ICONS[spaceOfBusiness(sector, activity)];
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-sm text-text">
      <Icon aria-hidden className="size-4 text-muted" />
      {t(`restaurants.sector.${sector}`)}
    </span>
  );
}
