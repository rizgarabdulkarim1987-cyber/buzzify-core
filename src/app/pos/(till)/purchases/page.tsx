import type { Metadata } from 'next';
import Link from 'next/link';
import { baghdadDay, baghdadDayOf, DAY_MS } from '@/lib/baghdad';
import { formatNumber } from '@/lib/pos-format';
import { query } from '@/server/studio/framework/invoke';
import { posPurchases } from '@/server/studio/queries/pos-inventory';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { buttonClasses } from '@/studio/ui/Button';
import { EmptyState } from '@/studio/ui/EmptyState';
import { PageHeader } from '@/studio/ui/PageHeader';
import { StatusBadge } from '@/studio/ui/StatusBadge';
import { moneyLabel, SectionTabs } from '@/app/pos/_ui/stock/view';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('pos.buy.title') };
}

/** Supplier invoices of the last 30 days (or only the unpaid ones), newest first. Needs `purchase.manage`. */
export default async function PurchasesPage({ searchParams }: { searchParams: Promise<{ unpaid?: string }> }) {
  const [{ unpaid }, locale] = await Promise.all([searchParams, requestStudioLocale()]);
  const t = getStudioTranslator(locale);
  const unpaidOnly = unpaid === '1';
  const from = baghdadDayOf(new Date(baghdadDay(baghdadDayOf(new Date())).start.getTime() - 30 * DAY_MS));
  const rows = await query(posPurchases, { unpaidOnly, ...(unpaidOnly ? {} : { from }) });
  const live = rows.filter((row) => !row.voided);
  const sum = live.reduce((total, row) => total + row.total, 0);
  const owed = live.filter((row) => !row.paid).reduce((total, row) => total + row.total, 0);
  return (
    <>
      <PageHeader
        title={t('pos.buy.title')}
        description={t('pos.buy.intro')}
        actions={
          <Link href="/pos/purchases/new" className={buttonClasses('primary', 'lg', 'min-h-12')}>
            {t('pos.buy.new')}
          </Link>
        }
      />
      <SectionTabs
        label={t('pos.buy.sections')}
        current={unpaidOnly ? 'unpaid' : 'all'}
        items={[
          { key: 'all', href: '/pos/purchases', label: t('pos.buy.tab.all') },
          { key: 'unpaid', href: '/pos/purchases?unpaid=1', label: t('pos.buy.tab.unpaid') },
          { key: 'suppliers', href: '/pos/purchases/suppliers', label: t('pos.buy.tab.suppliers') },
        ]}
      />
      <div className="flex flex-col gap-4 px-8 pb-8">
        {rows.length === 0 ? (
          <EmptyState title={t('pos.buy.empty')} />
        ) : (
          <ul className="flex flex-col divide-y divide-line rounded-lg border border-line">
            {rows.map((row) => (
              <li key={row.id}>
                <Link href={`/pos/purchases/${row.id}`} className={`flex min-h-12 flex-wrap items-center justify-between gap-3 px-4 py-3 hover:bg-hover ${row.voided ? 'line-through opacity-60' : ''}`}>
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-base text-text" dir="auto">
                      {row.supplierName}
                    </span>
                    <span className="text-sm text-muted" dir="auto">
                      <span dir="ltr">{row.invoiceDay}</span> {row.number ? `· #${row.number}` : ''} · {t('pos.buy.linesCount', { n: formatNumber(row.lines) })}
                    </span>
                  </span>
                  <span className="flex items-center gap-3">
                    {row.voided ? <StatusBadge>{t('pos.buy.voided')}</StatusBadge> : row.paid ? <StatusBadge tone="success">{t('pos.buy.paidState')}</StatusBadge> : <StatusBadge tone="danger">{t('pos.buy.unpaid')}</StatusBadge>}
                    <span className="text-base text-text">{moneyLabel(t, row.total)}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        <p className="text-sm text-muted">
          {t('pos.buy.listTotal')}: {moneyLabel(t, sum)} · {t('pos.buy.listOwed')}: {moneyLabel(t, owed)}
        </p>
      </div>
    </>
  );
}
