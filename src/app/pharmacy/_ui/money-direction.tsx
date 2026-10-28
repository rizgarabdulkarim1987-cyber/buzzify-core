import { ArrowDownLeft, ArrowUpRight, CircleCheck } from 'lucide-react';
import type { Translate } from '@/lib/i18n';
import type { Locale } from '@/lib/locale';
import { Amount } from './money-status';

/**
 * Which way the money goes, in words: a positive net is what you owe the supplier, a negative net is what the supplier owes
 * you (an overpayment or unused credit), zero is nothing. Icon and sentence together; the amount is shown without its sign
 * because the sentence carries the direction.
 */
export function Direction({ netMinor, currency, t, locale }: { netMinor: string; currency: 'IQD' | 'USD'; t: Translate; locale: Locale }) {
  let value: bigint;
  try {
    value = BigInt(netMinor);
  } catch {
    return null;
  }
  if (value === 0n) {
    return (
      <span data-direction="zero" className="inline-flex items-start gap-1.5">
        <CircleCheck aria-hidden className="mt-0.5 size-4 shrink-0" />
        {t('pharmacy.purchasing.m.dir.zero')}
      </span>
    );
  }
  const owe = value > 0n;
  return (
    <span data-direction={owe ? 'owe' : 'owed'} className="inline-flex items-start gap-1.5">
      {owe ? <ArrowUpRight aria-hidden className="mt-0.5 size-4 shrink-0" /> : <ArrowDownLeft aria-hidden className="mt-0.5 size-4 shrink-0" />}
      <span>
        {t(owe ? 'pharmacy.purchasing.m.dir.owe' : 'pharmacy.purchasing.m.dir.owed')} <Amount amount={owe ? value : -value} currency={currency} locale={locale} className="font-medium" />
      </span>
    </span>
  );
}
