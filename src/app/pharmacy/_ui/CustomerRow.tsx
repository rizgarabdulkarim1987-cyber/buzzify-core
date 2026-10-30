import { Archive } from 'lucide-react';
import Link from 'next/link';
import type { Translate } from '@/lib/i18n';
import type { CustomerView } from '@/server/pharmacy/customers-reads';
import { isolateName } from './isolate-name';
import { formatMinor } from './sell-logic';
import { Chip, Num } from './sell-parts';

/** One customer in the list: name, phone (managers only) and balance, limit and room left in the customer's own currency. */
export function CustomerRow({ c, t }: { c: CustomerView; t: Translate }) {
  return (
    <li data-testid="customer-row" className="border-b border-line">
      <Link
        href={`/pharmacy/customers/${c.id}`}
        className="grid min-h-11 min-w-0 grid-cols-1 gap-x-6 gap-y-1 rounded-sm px-1 py-3 hover:bg-hover md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] md:items-center"
      >
        <span className="min-w-0 break-words text-base font-semibold text-text" dir="auto">
          {isolateName(c.name)}
          {!c.active && (
            <span className="ms-2 inline-block align-middle">
              <Chip icon={<Archive aria-hidden />} testId="customer-archived">
                {t('pharmacy.customers.archived')}
              </Chip>
            </span>
          )}
          {c.phone ? (
            <span className="block text-sm font-normal text-muted">
              <Num>{c.phone}</Num>
            </span>
          ) : null}
        </span>
        <span className="text-sm text-text">
          <span className="text-muted">{t('pharmacy.credit.balance')}: </span>
          <Num>{formatMinor(BigInt(c.balanceMinor), c.currency)}</Num> {c.currency}
        </span>
        <span className="text-sm text-text">
          <span className="text-muted">{t('pharmacy.credit.limit')}: </span>
          <Num>{formatMinor(BigInt(c.creditLimitMinor), c.currency)}</Num> {c.currency}
        </span>
        <span className="text-sm font-medium text-text">
          <span className="font-normal text-muted">{t('pharmacy.credit.remaining')}: </span>
          <Num>{formatMinor(BigInt(c.availableMinor), c.currency)}</Num> {c.currency}
        </span>
      </Link>
    </li>
  );
}
