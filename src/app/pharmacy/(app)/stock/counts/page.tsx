import { ClipboardList, ListX, Lock } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { CountBlocked } from '@/app/pharmacy/_ui/CountBlocked';
import { CountStart } from '@/app/pharmacy/_ui/CountStart';
import { CountStatus } from '@/app/pharmacy/_ui/CountStatus';
import { OfflineNotice } from '@/app/pharmacy/_ui/OfflineNotice';
import { getPhPlaces } from '@/server/pharmacy/actor';
import { list } from '@/server/pharmacy/queries/counts';
import { categories } from '@/server/pharmacy/queries/products';
import { query } from '@/server/studio/framework/invoke';
import { formatDateTime } from '@/studio/format';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { buttonClasses } from '@/studio/ui/Button';
import { EmptyState } from '@/studio/ui/EmptyState';
import { PageHeader } from '@/studio/ui/PageHeader';
import { catalogAccess, roleMay } from '../../catalog/access';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('pharmacy.counts.title') };
}

const PAGE_SIZE = 25;
const STATUSES = ['OPEN', 'SUBMITTED', 'APPROVED', 'CANCELLED'] as const;
const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
const LINK = 'inline-flex min-h-11 items-center rounded-md px-2 text-sm font-medium text-text underline underline-offset-2 hover:bg-hover';

/**
 * The stock counts, newest first, filtered by state, with "Start a count" for the roles that count (`stock.count`) in an
 * open pharmacy with one branch chosen. The roles that cannot count, and a support actor, get a sentence.
 */
export default async function CountsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [raw, access, locale, places] = await Promise.all([searchParams, catalogAccess(), requestStudioLocale(), getPhPlaces()]);
  const t = getStudioTranslator(locale);
  const { actor } = access;
  const header = <PageHeader className="max-sm:px-4" title={t('pharmacy.counts.title')} description={t('pharmacy.counts.intro')} />;

  if (actor.role === null || !roleMay(actor, 'stock.count')) {
    return (
      <>
        {header}
        <div data-testid="counts-forbidden" className="px-4 pb-10 sm:px-8">
          <EmptyState icon={<Lock />} title={t('pharmacy.counts.forbidden.title')} body={t(actor.role === null ? 'pharmacy.counts.forbidden.support' : 'pharmacy.counts.forbidden.role')} />
        </div>
      </>
    );
  }

  const status = STATUSES.find((s) => s === one(raw.status));
  const cursor = one(raw.cursor)?.slice(0, 64) || undefined;
  const mayCount = access.writable('stock.count');
  const [page, categoryList] = await Promise.all([
    query(list, { ...access.placeInput, ...(status ? { status } : {}), ...(cursor ? { cursor } : {}), pageSize: PAGE_SIZE }),
    query(categories, access.placeInput),
  ]);
  const branches = places.find((p) => p.restaurantId === access.placeInput.restaurantId)?.branches ?? [];
  const branchNames = Object.fromEntries(branches.map((b) => [b.id, b.name]));
  const categoryNames = Object.fromEntries(categoryList.map((c) => [c.id, c.name]));
  const link = (over: { status?: string | undefined; cursor?: string | undefined }) => {
    const next = new URLSearchParams();
    if (over.status) next.set('status', over.status);
    if (over.cursor) next.set('cursor', over.cursor);
    const text = next.toString();
    return `/pharmacy/stock/counts${text ? `?${text}` : ''}`;
  };

  return (
    <>
      {header}
      <div className="flex min-w-0 flex-col gap-4 px-4 pb-10 sm:px-8">
        {!mayCount.ok && <CountBlocked reason={mayCount.reason} t={t} />}
        {mayCount.ok && access.place.branchId === null && (
          <p data-testid="counts-pick-branch" className="flex items-start gap-2.5 rounded-md border border-line bg-surface px-3 py-2.5 text-sm text-text">
            <Lock aria-hidden className="mt-px size-4 shrink-0 text-muted" />
            <span className="min-w-0">{t('pharmacy.counts.start.pickBranch')}</span>
          </p>
        )}
        <OfflineNotice />
        {mayCount.ok && access.place.branchId !== null && <CountStart branchName={access.place.branchName ?? ''} categories={categoryList} />}

        <nav aria-label={t('pharmacy.counts.filter')} className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-muted">{t('pharmacy.counts.filter')}</span>
          {[undefined, ...STATUSES].map((value) => (
            <Link
              key={value ?? 'all'}
              href={link({ status: value })}
              aria-current={value === status ? 'page' : undefined}
              className={buttonClasses(value === status ? 'primary' : 'secondary', 'lg', 'min-h-11')}
            >
              {value ? t(`pharmacy.counts.status.${value}`) : t('pharmacy.counts.filter.all')}
            </Link>
          ))}
        </nav>

        {page.items.length === 0 ? (
          <div data-testid="counts-empty">
            <EmptyState
              icon={status ? <ListX /> : <ClipboardList />}
              title={t(status ? 'pharmacy.counts.empty.filtered' : 'pharmacy.counts.empty.title')}
              body={t(status ? 'pharmacy.counts.empty.filteredBody' : 'pharmacy.counts.empty.body')}
            />
          </div>
        ) : (
          <ul aria-label={t('pharmacy.counts.title')} className="flex flex-col border-t border-line">
            {page.items.map((count) => {
              const value = count.scope === 'CATEGORY' ? (categoryNames[count.scopeValue] ?? '') : count.scope === 'LOCATION' ? count.scopeValue : '';
              return (
                <li key={count.id} data-testid="count-row" className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1.5 border-b border-line px-1 py-3 text-sm">
                  <span dir="auto" className="min-w-0 break-words font-semibold text-text">
                    {value ? t('pharmacy.counts.detail.scopeValue', { scope: t(`pharmacy.counts.scope.${count.scope}`), value }) : t(`pharmacy.counts.scope.${count.scope}`)}
                  </span>
                  <CountStatus status={count.status} t={t} />
                  {count.blind && <span className="inline-flex min-h-6 items-center rounded-sm border border-line-strong px-1.5 py-0.5 text-xs font-medium text-text">{t('pharmacy.counts.blind')}</span>}
                  {access.place.branchId === null && (
                    <span dir="auto" className="text-muted">
                      {branchNames[count.branchId] ?? ''}
                    </span>
                  )}
                  <span className="text-muted">{t('pharmacy.counts.lineCount', { count: count.lineCount })}</span>
                  <span className="text-muted">
                    {t('pharmacy.counts.col.counter')}: {t(count.countedById === actor.userId ? 'pharmacy.counts.counter.you' : 'pharmacy.counts.counter.other')}
                  </span>
                  <bdi dir="ltr" className="text-muted tabular-nums">
                    {formatDateTime(count.createdAt, locale)}
                  </bdi>
                  <Link href={`/pharmacy/stock/counts/${count.id}`} className={`${LINK} ms-auto`}>
                    {t('pharmacy.counts.open')}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}

        {(page.nextCursor || cursor) && (
          <nav aria-label={t('pharmacy.counts.title')} className="flex flex-wrap items-center gap-2">
            {cursor && (
              <Link href={link({ status })} className={buttonClasses('secondary', 'lg', 'min-h-11')}>
                {t('pharmacy.stock.first')}
              </Link>
            )}
            {page.nextCursor && (
              <Link href={link({ status, cursor: page.nextCursor })} rel="next" className={buttonClasses('secondary', 'lg', 'min-h-11')}>
                {t('pharmacy.stock.next')}
              </Link>
            )}
          </nav>
        )}
      </div>
    </>
  );
}
