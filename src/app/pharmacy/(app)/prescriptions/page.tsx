import { CircleCheck, FileCheck2, FileX2, ScrollText, SearchX } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { OfflineNotice } from '@/app/pharmacy/_ui/OfflineNotice';
import { loadPages, pagesOf } from '@/app/pharmacy/_ui/load-pages';
import { phDate } from '@/app/pharmacy/_ui/ph-date';
import { keysetOf } from '@/app/pharmacy/_ui/prescription-logic';
import { Chip, Num } from '@/app/pharmacy/_ui/sell-parts';
import { isolateName as isolate } from '@/app/pharmacy/_ui/isolate-name';
import { list } from '@/server/pharmacy/queries/prescriptions';
import { query } from '@/server/studio/framework/invoke';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { buttonClasses } from '@/studio/ui/Button';
import { EmptyState } from '@/studio/ui/EmptyState';
import { PageHeader } from '@/studio/ui/PageHeader';
import { rxGate } from './gate';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('pharmacy.rx.title') };
}

const PAGE = 25;
const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/**
 * Prescriptions, newest first: the number, the day on the paper, the sale it served (a link) and whether a file is kept. The
 * prescriber and the patient appear only because the person holds `rx.dispense` (the gate): the query leaves them out otherwise.
 */
export default async function PrescriptionsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [raw, g] = await Promise.all([searchParams, rxGate('pharmacy.rx.title')]);
  if (g.blocked) return g.blocked;
  const { access, t, locale } = g;
  const unused = one(raw.unused) === '1';
  const pages = pagesOf(one(raw.pages));
  const page = await loadPages(
    async (cursor) => keysetOf(await query(list, { ...access.placeInput, limit: PAGE + 1, ...(unused ? { unusedOnly: true } : {}), ...(cursor ? { cursor } : {}) }), PAGE),
    pages,
  );
  const href = (over: Record<string, string | undefined>) => {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries({ unused: unused ? '1' : undefined, pages: pages > 1 ? String(pages) : undefined, ...over })) if (v) next.set(k, v);
    const text = next.toString();
    return `/pharmacy/prescriptions${text ? `?${text}` : ''}`;
  };
  return (
    <>
      <PageHeader
        className="max-sm:px-4"
        title={t('pharmacy.rx.title')}
        description={t('pharmacy.rx.intro')}
        actions={
          <Link href="/pharmacy/prescriptions/register" className={buttonClasses('secondary', 'lg', 'min-h-11')} data-testid="rx-register-link">
            <ScrollText aria-hidden />
            {t('pharmacy.rx.register.title')}
          </Link>
        }
      />
      <div className="flex min-w-0 flex-col gap-4 px-4 pb-10 sm:px-8">
        <OfflineNotice messageKey="pharmacy.reports.offline" />
        <nav aria-label={t('pharmacy.rx.filter')} className="flex flex-wrap gap-2">
          <Link href={href({ unused: undefined, pages: undefined })} aria-current={!unused ? 'page' : undefined} className={buttonClasses(!unused ? 'primary' : 'secondary', 'lg', 'min-h-11')}>
            {t('pharmacy.rx.filter.all')}
          </Link>
          <Link href={href({ unused: '1', pages: undefined })} aria-current={unused ? 'page' : undefined} data-testid="rx-filter-unused" className={buttonClasses(unused ? 'primary' : 'secondary', 'lg', 'min-h-11')}>
            {t('pharmacy.rx.filter.unused')}
          </Link>
        </nav>
        {page.items.length === 0 ? (
          <div data-testid="rx-empty">
            <EmptyState icon={unused ? <SearchX /> : <ScrollText />} title={t(unused ? 'pharmacy.rx.emptyFiltered' : 'pharmacy.rx.empty')} body={t(unused ? 'pharmacy.rx.emptyFilteredBody' : 'pharmacy.rx.emptyBody')} />
          </div>
        ) : (
          <ul aria-label={t('pharmacy.rx.title')} className="flex flex-col border-t border-line" data-testid="rx-list">
            {page.items.map((r) => (
              <li key={r.id} data-testid="rx-row" className="border-b border-line">
                <div className="grid min-w-0 grid-cols-1 gap-x-6 gap-y-1 px-1 py-3 md:grid-cols-[minmax(0,10rem)_minmax(0,8rem)_minmax(0,2fr)_minmax(0,9rem)_minmax(0,9rem)] md:items-center">
                  <Link href={`/pharmacy/prescriptions/${r.id}`} className="inline-flex min-h-11 items-center rounded-md px-1 text-base font-semibold text-text underline underline-offset-2 hover:bg-hover" data-testid="rx-open">
                    <Num>{r.number}</Num>
                  </Link>
                  <span className="text-sm text-text">
                    <bdi dir="ltr">{phDate(`${r.issuedOn}T12:00:00Z`, locale)}</bdi>
                  </span>
                  <span className="min-w-0 break-words text-sm text-text" dir="auto">
                    {r.prescriberName ? isolate(r.prescriberName) : ''}
                    {r.patientName ? ` · ${isolate(r.patientName)}` : ''}
                  </span>
                  <span className="text-sm">
                    {r.saleId ? (
                      <Link href={`/pharmacy/sales/${r.saleId}`} className="inline-flex min-h-11 items-center gap-1.5 rounded-md px-1 font-medium text-text underline underline-offset-2 hover:bg-hover" data-testid="rx-sale-link">
                        <CircleCheck aria-hidden className="size-4" />
                        {t('pharmacy.rx.sale')}
                      </Link>
                    ) : (
                      <Chip icon={<FileX2 aria-hidden />}>{t('pharmacy.rx.notUsed')}</Chip>
                    )}
                  </span>
                  <span>
                    {r.fileCount > 0 ? (
                      <Chip icon={<FileCheck2 aria-hidden />} testId="rx-has-file">
                        {t('pharmacy.rx.hasFile')}
                      </Chip>
                    ) : (
                      <Chip icon={<FileX2 aria-hidden />} testId="rx-no-file">
                        {t('pharmacy.rx.noFile')}
                      </Chip>
                    )}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
        {page.nextCursor && (
          <nav aria-label={t('pharmacy.rx.title')}>
            <Link href={href({ pages: String(pages + 1) })} rel="next" className={buttonClasses('secondary', 'lg', 'min-h-11')} data-testid="rx-more">
              {t('pharmacy.purchasing.loadMore')}
            </Link>
          </nav>
        )}
      </div>
    </>
  );
}
