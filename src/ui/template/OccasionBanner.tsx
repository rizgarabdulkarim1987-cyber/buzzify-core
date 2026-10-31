'use client';

import type { LiveOccasionMood } from '@/server/domain/occasion-mood';
import { formatCount } from '@/server/domain/money';
import { useApp } from '@/ui/AppProviders';

/**
 * While a dated occasion with a mood runs (Ramadan, Newroz, Eid), a slim strip under the header names it and counts
 * the days left (plan feature `guest.occasionMoods`). It is static text: no motion, no timers. The tint is the mood's
 * own colour, kept to the strip so the template's palette stays the template's.
 */
export function OccasionBanner({ occasion }: { occasion: LiveOccasionMood }) {
  const { t, locale, tenant } = useApp();
  const days = formatCount(occasion.daysLeft, locale, tenant.numeralSystem);
  const text = occasion.daysLeft === 0 ? t('occasion.lastDay', { name: occasion.name }) : t('occasion.daysLeft', { name: occasion.name, days });
  return (
    <p className="tpl-occasion" data-mood={occasion.mood} role="status">
      {text}
    </p>
  );
}
