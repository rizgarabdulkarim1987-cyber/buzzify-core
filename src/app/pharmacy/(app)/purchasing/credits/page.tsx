import { NotebookText, Plus, SearchX } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Amount } from '@/app/pharmacy/_ui/money-status';
import { OfflineNotice } from '@/app/pharmacy/_ui/OfflineNotice';
import { list } from '@/server/pharmacy/queries/credit-notes';
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
  return { title: getStudioTranslator(await requestStudioLocale())('pharmacy.purchasing.m.cr.title') };
}

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/** Credit notes from suppliers, newest first, with how much of each is still to apply. */
export default async function CreditsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [raw, g] = await Promise.all([searchParams, purchasingGate('pharmacy.purchasing.m.cr.title', { href: '/pharmacy/purchasing', labelKey: 'pharmacy.purchasing.back' })]);
  if (g.blocked) return g.blocked;
  const { access, t, locale } = g;
  const supplierId = one(raw.supplier) || undefined;
  const openOnly = one(raw.open) === '1';
  const cursor = one(raw.cursor);
  const [page, supplierPage] = await Promise.all([
    query(list, { ...access.placeInput, ...(supplierId ? { supplierId } : {}), ...(openOnly ? { openOnly: true } : {}), ...(cursor ? { cursor } : {}) }),
    query(suppliers, { ...access.placeInput, active: 'all' }),
  ]);
  const href = (over: Record<string, string | undefined>) => {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries({ supplier: supplierId, open: openOnly ? '1' : undefined, cursor, ...over })) if (v) next.set(k, v);
    const text = next.toString();
    return `/pharmacy/purchasing/credits${text ? `?${text}` : ''}`;
  };
  const filtered = Boolean(supplierId || openOnly);
  return (
    <>
      <PageHeader
        className="max-sm:px-4"
        above={g.back}
        title={t('pharmacy.purchasing.m.cr.title')}
        description={t('pharmacy.purchasing.m.cr.intro')}
        actions={
          g.writable.ok && g.mayMoney ? (
            <Link href="/pharmacy/purchasing/credits/new" data-testid="credit-new" className={buttonClasses('primary', 'lg', 'min-h-11')}>
              <Plus aria-hidden />
              {t('pharmacy.purchasing.m.cr.new')}
            </Link>
          ) : undefined
        }
      />
      <div className="flex min-w-0 flex-col gap-4 px-4 pb-10 sm:px-8">
        {g.writeNotice}
        <OfflineNotice />
        <form method="get" role="search" className="flex flex-wrap items-end gap-2">
          {openOnly && <input type="hidden" name="open" value="1" />}
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
          <Link href={href({ open: undefined, cursor: undefined })} aria-current={!openOnly ? 'page' : undefined} className={buttonClasses(!openOnly ? 'primary' : 'secondary', 'lg', 'min-h-11')}>
            {t('pharmacy.receive.filter.all')}
          </Link>
          <Link href={href({ open: '1', cursor: undefined })} aria-current={openOnly ? 'page' : undefined} data-testid="credits-open-filter" className={buttonClasses(openOnly ? 'primary' : 'secondary', 'lg', 'min-h-11')}>
            {t('pharmacy.purchasing.m.cr.openOnly')}
          </Link>
        </nav>
        {page.items.length === 0 ? (
          <div data-testid="credits-empty">
            <EmptyState icon={filtered ? <SearchX /> : <NotebookText />} title={t(filtered ? 'pharmacy.purchasing.m.cr.emptyFiltered' : 'pharmacy.purchasing.m.cr.empty')} body={t(filtered ? 'pharmacy.purchasing.m.cr.emptyFilteredBody' : 'pharmacy.purchasing.m.cr.emptyBody')} />
          </div>
        ) : (
          <ul aria-label={t('pharmacy.purchasing.m.cr.title')} className="flex flex-col border-t border-line">
            {page.items.map((c) => (
              <li key={c.id} data-testid="credit-row" className="border-b border-line">
                <Link
                  href={`/pharmacy/purchasing/credits/${c.id}`}
                  className="grid min-h-11 min-w-0 grid-cols-1 gap-x-6 gap-y-1 rounded-sm px-1 py-3 hover:bg-hover md:grid-cols-[minmax(0,8rem)_minmax(0,2fr)_minmax(0,7rem)_minmax(0,9rem)_minmax(0,9rem)] md:items-center"
                >
                  <span className="text-base font-medium text-text">
                    <bdi dir="ltr" className="tabular-nums">
                      {c.number}
                    </bdi>
                  </span>
                  <span dir="auto" className="min-w-0 break-words text-sm text-text [overflow-wrap:anywhere]">
                    {c.supplierName}
                  </span>
                  <span className="text-sm text-text">
                    <bdi dir="ltr">{formatDate(`${c.noteDate}T00:00:00.000Z`, locale)}</bdi>
                  </span>
                  <span className="text-sm text-text">{c.amountMinor !== undefined && <Amount amount={c.amountMinor} currency={c.currency} locale={locale} className="font-medium" />}</span>
                  <span className="text-sm text-text md:text-end">
                    {c.availableMinor !== undefined && (
                      <>
                        <span className="text-muted">{t('pharmacy.purchasing.m.cr.left')}: </span>
                        <Amount amount={c.availableMinor} currency={c.currency} locale={locale} />
                      </>
                    )}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        {page.nextCursor && (
          <nav aria-label={t('pharmacy.purchasing.m.cr.title')}>
            <Link href={href({ cursor: page.nextCursor })} rel="next" className={buttonClasses('secondary', 'lg', 'min-h-11')}>
              {t('pharmacy.purchasing.loadMore')}
            </Link>
          </nav>
        )}
      </div>
    </>
  );
}
