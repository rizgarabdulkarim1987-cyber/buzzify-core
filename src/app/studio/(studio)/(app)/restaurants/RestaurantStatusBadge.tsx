import type { Translate } from '@/lib/i18n';
import type { RestaurantStatus } from '@/server/domain/restaurant-profile';
import { StatusBadge, type StatusTone } from '@/studio/ui/StatusBadge';

const TONES: Record<RestaurantStatus, StatusTone> = { ACTIVE: 'success', SUSPENDED: 'danger', ARCHIVED: 'neutral' };

/** A restaurant's status as a badge: the word, with a colour that repeats it. */
export function RestaurantStatusBadge({ status, t }: { status: RestaurantStatus; t: Translate }) {
  return <StatusBadge tone={TONES[status]}>{t(`status.${status.toLowerCase()}`)}</StatusBadge>;
}
