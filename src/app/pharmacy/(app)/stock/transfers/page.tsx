import { ArrowLeftRight, Plus, SearchX } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { OfflineNotice } from '@/app/pharmacy/_ui/OfflineNotice';
import { loadPages, pagesOf } from '@/app/pharmacy/_ui/load-pages';
import { phDate } from '@/app/pharmacy/_ui/ph-date';
import { actionFor, type TransferStatus } from '@/app/pharmacy/_ui/transfers-logic';
import { Route, TransferStatusChip, TurnChip } from '@/app/pharmacy/_ui/transfers-parts';
import { formatNumber } from '@/lib/pos-format';
import { list } from '@/server/pharmacy/queries/transfers';
import { query } from '@/server/studio/framework/invoke';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { buttonClasses } from '@/studio/ui/Button';
import { EmptyState } from '@/studio/ui/EmptyState';
import { PageHeader } from '@/studio/ui/PageHeader';
import { transfersGate } from './gate';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('pharmacy.transfers.title') };
}

const STATUSES: TransferStatus[] = ['REQUESTED', 'SENT', 'RECEIVED', 'PARTIAL', 'CANCELLED'];
const DIRECTIONS = ['all', 'in', 'out'] as const;
const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/**
 * Transfers between branches, newest first. Incoming / Outgoing / All are relative to the branch the person works in (all of
 * their branches when they work in "All branches"); the chips filter by state. A row that waits for this person (a requested
 * transfer their branch must send, a sent one it must receive) says so in words and an icon.
 */
export default async function TransfersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [raw, g] = await Promise.all([searchParams, transfersGate('pharmacy.transfers.title', { href: '/pharmacy/stock', labelKey: 'pharmacy.transfers.backToStock' })]);
  if (g.blocked) return g.blocked;
  const { access, t, locale, reach } = g;
  const status = STATUSES.find((s) => s === one(raw.status));
  const direction = DIRECTIONS.find((d) => d === one(raw.dir)) ?? 'all';
  const pages = pagesOf(one(raw.pages));
  const page = await loadPages((cursor) => query(list, { ...access.placeInput, direction, ...(status ? { status } : {}), ...(cursor ? { cursor } : {}) }), pages);
  const href = (over: Record<string, string | undefined>) => {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries({ dir: direction === 'all' ? undefined : direction, status, pages: pages > 1 ? String(pages) : undefined, ...over })) if (v) next.set(k, v);
    const text = next.toString();
    return `/pharmacy/stock/transfers${text ? `?${text}` : ''}`;
  };
  const filtered = Boolean(status) || direction !== 'all';
  const waiting = page.items.filter((r) => actionFor(r, reach) !== null).length;
  const canNew = g.writable.ok;
  return (
    <>
      <PageHeader
        className="max-sm:px-4"
        above={g.back}
        title={t('pharmacy.transfers.title')}
        description={t('pharmacy.transfers.intro')}
        actions={
          canNew ? (
            <Link href="/pharmacy/stock/transfers/new" className={buttonClasses('primary', 'lg', 'min-h-11')} data-testid="transfer-new">
              <Plus aria-hidden />
              {t('pharmacy.transfers.new')}
            </Link>
          ) : undefined
        }
      />
      <div className="flex min-w-0 flex-col gap-4 px-4 pb-10 sm:px-8">
        {g.writeNotice}
        <OfflineNotice />
        <nav aria-label={t('pharmacy.transfers.direction')} className="flex flex-wrap gap-2">
          {DIRECTIONS.map((d) => (
            <Link
              key={d}
              href={href({ dir: d === 'all' ? undefined : d, pages: undefined })}
              aria-current={d === direction ? 'page' : undefined}
              data-testid={`transfers-dir-${d}`}
              className={buttonClasses(d === direction ? 'primary' : 'secondary', 'lg', 'min-h-11')}
            >
              {t(`pharmacy.transfers.dir.${d}`)}
            </Link>
          ))}
        </nav>
        <nav aria-label={t('pharmacy.transfers.filter')} className="flex flex-wrap gap-2">
          <Link href={href({ status: undefined, pages: undefined })} aria-current={!status ? 'page' : undefined} className={buttonClasses(!status ? 'primary' : 'secondary', 'lg', 'min-h-11')}>
            {t('pharmacy.receive.filter.all')}
          </Link>
          {STATUSES.map((s) => (
            <Link key={s} href={href({ status: s, pages: undefined })} aria-current={s === status ? 'page' : undefined} className={buttonClasses(s === status ? 'primary' : 'secondary', 'lg', 'min-h-11')}>
              {t(`pharmacy.transfers.status.${s}`)}
            </Link>
          ))}
        </nav>
        {waiting > 0 && (
          <p role="status" data-testid="transfers-waiting" className="flex items-start gap-2.5 rounded-md border border-ink bg-raised px-3 py-2.5 text-sm font-medium text-text">
            <ArrowLeftRight aria-hidden className="mt-px size-4 shrink-0" />
            <span className="min-w-0">{t('pharmacy.transfers.waiting', { count: waiting })}</span>
          </p>
        )}
        {page.items.length === 0 ? (
          <div data-testid="transfers-empty" className="flex flex-col items-start gap-3">
            <EmptyState
              icon={filtered ? <SearchX /> : <ArrowLeftRight />}
              title={t(filtered ? 'pharmacy.transfers.emptyFiltered' : 'pharmacy.transfers.empty')}
              body={t(filtered ? 'pharmacy.transfers.emptyFilteredBody' : 'pharmacy.transfers.emptyBody')}
            />
            {canNew && (
              <Link href="/pharmacy/stock/transfers/new" className={buttonClasses('primary', 'lg', 'min-h-11')}>
                <Plus aria-hidden />
                {t('pharmacy.transfers.new')}
              </Link>
            )}
          </div>
        ) : (
          <ul aria-label={t('pharmacy.transfers.title')} className="flex flex-col border-t border-line">
            {page.items.map((r) => {
              const turn = actionFor(r, reach);
              return (
                <li key={r.id} data-testid="transfer-row" data-status={r.status} className="border-b border-line">
                  <Link
                    href={`/pharmacy/stock/transfers/${r.id}`}
                    className="grid min-h-11 min-w-0 grid-cols-1 gap-x-6 gap-y-1 rounded-sm px-1 py-3 hover:bg-hover md:grid-cols-[minmax(0,9rem)_minmax(0,9rem)_minmax(0,2fr)_minmax(0,9rem)_minmax(0,7rem)] md:items-center"
                  >
                    <span className="text-base font-medium text-text">
                      {r.number ? (
                        <bdi dir="ltr" className="tabular-nums">
                          {r.number}
                        </bdi>
                      ) : null}
                    </span>
                    <span className="flex flex-wrap items-center gap-1.5">
                      <TransferStatusChip status={r.status} t={t} />
                      {turn && <TurnChip action={turn} t={t} />}
                    </span>
                    <span className="min-w-0 text-sm text-text">
                      <Route from={r.fromBranchName} to={r.toBranchName} />
                    </span>
                    <span className="text-sm text-text tabular-nums">
                      {t('pharmacy.transfers.row.counts', { lines: formatNumber(r.lineCount), units: formatNumber(r.status === 'REQUESTED' || r.status === 'CANCELLED' ? r.requestedQty : r.sentQty) })}
                      {r.inTransitQty > 0 && <span className="block text-muted">{t('pharmacy.transfers.row.inTransit', { qty: formatNumber(r.inTransitQty) })}</span>}
                    </span>
                    <span className="text-sm text-text">
                      <bdi dir="ltr">{phDate(r.requestedAt, locale)}</bdi>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
        {page.nextCursor && (
          <nav aria-label={t('pharmacy.transfers.title')}>
            <Link href={href({ pages: String(pages + 1) })} rel="next" className={buttonClasses('secondary', 'lg', 'min-h-11')} data-testid="transfers-more">
              {t('pharmacy.purchasing.loadMore')}
            </Link>
          </nav>
        )}
      </div>
    </>
  );
}
