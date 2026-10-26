'use client';

import { formatNumber, ltr } from '@/lib/pos-format';
import { useT } from '@/studio/i18n';

/**
 * Amounts as the till writes them: Latin digits with a comma for thousands, then the currency word of the language, kept as
 * one left-to-right piece so Arabic and Sorani text cannot move the sign or the digits around.
 */
export function useMoney(): (amount: number) => string {
  const t = useT();
  const currency = t('pos.currency');
  return (amount) => ltr(`${formatNumber(amount)} ${currency}`);
}
