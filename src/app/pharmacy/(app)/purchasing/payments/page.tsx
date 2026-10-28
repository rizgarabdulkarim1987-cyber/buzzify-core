import { HandCoins, Plus, SearchX } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Amount, PaymentChip } from '@/app/pharmacy/_ui/money-status';
import { OfflineNotice } from '@/app/pharmacy/_ui/OfflineNotice';
import { list } from '@/server/pharmacy/queries/supplier-payments';
import { list as suppliers } from '@/server/pharmacy/queries/suppliers';
import { query } from '@/server/studio/framework/invoke';
import { formatDate } from '@/studio/format';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { buttonClasses } from '@/studio/ui/Button';
import { EmptyState } from '@/studio/ui/EmptyState';
import { PageHeader } from '@/studio/ui/PageHeader';
import { purchasingGate } from '../gate';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('pharmacy.purchasing.m.pay.title') };
}

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/** Payments to suppliers, newest first; reversal rows only when asked for. Each is a record in the books: no cash moves. */
export default async function PaymentsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [raw, g] = await Promise.all([searchParams, purchasingGate('pharmacy.purchasing.m.pay.title', { href: '/pharmacy/purchasing', labelKey: 'pharmacy.purchasing.back' })]);
  if (g.blocked) return g.blocked;
  const { access, t, locale } = g;
  const supplierId = one(raw.supplier) || undefined;
  const withReversals = one(raw.reversals) === '1';
  const cursor = one(raw.cursor);
  const [page, supplierPage] = await Promise.all([
    query(list, { ...access.placeInput, ...(supplierId ? { supplierId } : {}), ...(withReversals ? { includeReversals: true } : {}), ...(cursor ? { cursor } : {}) }),
    query(suppliers, { ...access.placeInput, active: 'all' }),
  ]);
  const href = (over: Record<string, string | undefined>) => {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries({ supplier: supplierId, reversals: withReversals ? '1' : undefined, cursor, ...over })) if (v) next.set(k, v);
    const text = next.toString();
    return `/pharmacy/purchasing/payments${text ? `?${text}` : ''}`;
  };
  const filtered = Boolean(supplierId);
  return (
    <>
      <PageHeader
        className="max-sm:px-4"
        above={g.back}
        title={t('pharmacy.purchasing.m.pay.title')}
        description={t('pharmacy.purchasing.m.pay.intro')}
        actions={
          g.writable.ok && g.mayMoney ? (
            <Link href="/pharmacy/purchasing/payments/new" data-testid="payment-new" className={buttonClasses('primary', 'lg', 'min-h-11')}>
              <Plus aria-hidden />
              {t('pharmacy.purchasing.m.pay.new')}
            </Link>
          ) : undefined
        }
      />
      <div className="flex min-w-0 flex-col gap-4 px-4 pb-10 sm:px-8">
        {g.writeNotice}
        <OfflineNotice />
        <p className="flex items-start gap-2.5 rounded-md border border-line bg-surface px-3 py-2.5 text-sm text-text">
          <HandCoins aria-hidden className="mt-px size-4 shrink-0 text-muted" />
          <span className="min-w-0">{t('pharmacy.purchasing.m.pay.booksOnly')}</span>
        </p>
        <form method="get" role="search" className="flex flex-wrap items-end gap-2">
          {withReversals && <input type="hidden" name="reversals" value="1" />}
          <label className="flex min-w-0 flex-col gap-1 text-sm text-text">
            {t('pharmacy.purchasing.po.supplier')}
            <select name="supplier" defaultValue={supplierId ?? ''} className="min-h-11 w-full rounded-md border border-line-strong bg-raised px-3 text-base text-text sm:w-64">
              <option value="">{t('pharmacy.purchasing.po.allSuppliers')}</option>
              {supplierPage.items.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className={buttonClasses('secondary', 'lg', 'min-h-11')}>
            {t('pharmacy.purchasing.suppliers.searchGo')}
          </button>
        </form>
        <nav aria-label={t('pharmacy.purchasing.po.filter')} className="flex flex-wrap gap-2">
          <Link href={href({ reversals: undefined, cursor: undefined })} aria-current={!withReversals ? 'page' : undefined} className={buttonClasses(!withReversals ? 'primary' : 'secondary', 'lg', 'min-h-11')}>
            {t('pharmacy.purchasing.m.pay.hideReversals')}
          </Link>
          <Link href={href({ reversals: '1', cursor: undefined })} aria-current={withReversals ? 'page' : undefined} data-testid="payments-with-reversals" className={buttonClasses(withReversals ? 'primary' : 'secondary', 'lg', 'min-h-11')}>
            {t('pharmacy.purchasing.m.pay.showReversals')}
          </Link>
        </nav>
        {page.items.length === 0 ? (
          <div data-testid="payments-empty">
            <EmptyState icon={filtered ? <SearchX /> : <HandCoins />} title={t(filtered ? 'pharmacy.purchasing.m.pay.emptyFiltered' : 'pharmacy.purchasing.m.pay.empty')} body={t(filtered ? 'pharmacy.purchasing.m.pay.emptyFilteredBody' : 'pharmacy.purchasing.m.pay.emptyBody')} />
          </div>
        ) : (
          <ul aria-label={t('pharmacy.purchasing.m.pay.title')} className="flex flex-col border-t border-line">
            {page.items.map((p) => (
              <li key={p.id} data-testid="payment-row" className="border-b border-line">
                <Link
                  href={`/pharmacy/purchasing/payments/${p.id}`}
                  className="grid min-h-11 min-w-0 grid-cols-1 gap-x-6 gap-y-1 rounded-sm px-1 py-3 hover:bg-hover md:grid-cols-[minmax(0,7rem)_minmax(0,2fr)_minmax(0,9rem)_minmax(0,10rem)_minmax(0,8rem)] md:items-center"
                >
                  <span className="text-base font-medium text-text">
                    <bdi dir="ltr">{formatDate(`${p.paidOn}T00:00:00.000Z`, locale)}</bdi>
                  </span>
                  <span dir="auto" className="min-w-0 break-words text-sm text-text [overflow-wrap:anywhere]">
                    {p.supplierName}
                  </span>
                  <span className="text-sm text-text">{t(`pharmacy.purchasing.m.pay.method.${p.method}`)}</span>
                  <span>
                    <PaymentChip reversed={p.reversed} isReversal={p.isReversal} t={t} />
                  </span>
                  <span className="text-sm text-text md:text-end">{p.amountMinor !== undefined && <Amount amount={p.amountMinor} currency={p.currency} locale={locale} className="font-medium" />}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        {page.nextCursor && (
          <nav aria-label={t('pharmacy.purchasing.m.pay.title')}>
            <Link href={href({ cursor: page.nextCursor })} rel="next" className={buttonClasses('secondary', 'lg', 'min-h-11')}>
              {t('pharmacy.purchasing.loadMore')}
            </Link>
          </nav>
        )}
      </div>
    </>
  );
}
