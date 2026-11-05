import { Lock, PackageCheck } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { ExpiryGroups, ExpirySummary, ExpiryTotalsRow } from '@/app/pharmacy/_ui/ExpiryList';
import { OfflineNotice } from '@/app/pharmacy/_ui/OfflineNotice';
import { StockBlocked } from '@/app/pharmacy/_ui/StockBlocked';
import { formatNumber } from '@/lib/pos-format';
import { utcToday } from '@/server/domain/pharmacy/expiry';
import { getPhPlaces } from '@/server/pharmacy/actor';
import { expiry } from '@/server/pharmacy/queries/expiry';
import { query } from '@/server/studio/framework/invoke';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { EmptyState } from '@/studio/ui/EmptyState';
import { catalogAccess, roleMay } from '../../catalog/access';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('pharmacy.expiry.title') };
}

/** The query's most rows a page; groups are drawn per page. */
const PAGE_SIZE = 100;
const BTN = 'inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-ph-xl border border-ph-line bg-ph-card px-3 text-sm font-semibold text-ph-text hover:bg-ph-canvas';
const HORIZONS = [30, 60, 90, 180] as const;
const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/**
 * What expires soon. The horizon (30, 60, 90 or 180 days) is a link, so the page is a plain GET. Every staff role that
 * sees stock may look; following a batch up needs `stock.adjust`, an open pharmacy and one chosen branch, and the page says
 * why the form is missing. A support actor gets a sentence.
 */
export default async function ExpiryPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [raw, access, locale, places] = await Promise.all([searchParams, catalogAccess(), requestStudioLocale(), getPhPlaces()]);
  const t = getStudioTranslator(locale);
  const { actor } = access;
  const header = (
    <div className="flex min-w-0 flex-col gap-1 px-4 pt-5 sm:px-8">
      <h1 className="break-words text-[26px] font-bold leading-8 tracking-tight text-ph-text" dir="auto">
        {t('pharmacy.expiry.title')}
      </h1>
      <p className="max-w-prose text-sm text-ph-muted">{t('pharmacy.expiry.intro')}</p>
    </div>
  );

  if (actor.role === null || !roleMay(actor, 'catalog.view')) {
    return (
      <>
        {header}
        <div data-testid="expiry-forbidden" className="px-4 pb-10 sm:px-8">
          <EmptyState icon={<Lock />} title={t('pharmacy.expiry.forbidden.title')} body={t(actor.role === null ? 'pharmacy.expiry.forbidden.support' : 'pharmacy.expiry.forbidden.role')} />
        </div>
      </>
    );
  }

  const days = HORIZONS.find((d) => String(d) === one(raw.days)) ?? 90;
  const cursor = one(raw.cursor)?.slice(0, 800) || undefined;
  const page = await query(expiry, { ...access.placeInput, days, ...(cursor ? { cursor } : {}), pageSize: PAGE_SIZE });

  const branches = places.find((p) => p.restaurantId === access.placeInput.restaurantId)?.branches ?? [];
  const branchNames = access.place.branchId === null ? Object.fromEntries(branches.map((b) => [b.id, b.name])) : null;
  const adjust = access.writable('stock.adjust');
  const mayFollow = adjust.ok && access.place.branchId !== null;
  const link = (over: { days?: number; cursor?: string }) => {
    const next = new URLSearchParams();
    next.set('days', String(over.days ?? days));
    if (over.cursor) next.set('cursor', over.cursor);
    return `/pharmacy/stock/expiry?${next.toString()}`;
  };

  return (
    <>
      {header}
      <div className="flex min-w-0 flex-col gap-4 px-4 pt-4 pb-10 sm:px-8">
        {!adjust.ok && <StockBlocked reason={adjust.reason} t={t} />}
        {adjust.ok && access.place.branchId === null && (
          <p data-testid="expiry-pick-branch" className="flex items-start gap-2.5 rounded-ph-xl border border-ph-line bg-ph-card px-3 py-2.5 text-sm text-ph-text">
            <Lock aria-hidden className="mt-px size-4 shrink-0 text-ph-muted" />
            <span className="min-w-0">{t('pharmacy.expiry.pickBranch')}</span>
          </p>
        )}
        <OfflineNotice />

        <nav aria-label={t('pharmacy.expiry.horizon')} className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-ph-muted">{t('pharmacy.expiry.horizon')}</span>
          {HORIZONS.map((d) => (
            <Link
              key={d}
              href={link({ days: d })}
              aria-current={d === days ? 'page' : undefined}
              className={`inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-semibold ${
                d === days ? 'border-transparent bg-ph-g8 text-ph-on-green' : 'border-ph-line bg-ph-card text-ph-text hover:bg-ph-canvas'
              }`}
            >
              {t('pharmacy.expiry.horizon.option', { days: formatNumber(d) })}
            </Link>
          ))}
        </nav>

        <ExpirySummary totals={page.totals} days={days} t={t} />
        <ExpiryTotalsRow totals={page.totals} days={days} t={t} />

        {page.items.length === 0 ? (
          <div data-testid="expiry-empty">
            <EmptyState icon={<PackageCheck />} title={t('pharmacy.expiry.empty.title', { days: formatNumber(days) })} body={t('pharmacy.expiry.empty.body')} />
          </div>
        ) : (
          <ExpiryGroups items={page.items} today={utcToday()} t={t} userId={actor.userId} canFollow={mayFollow} branchNames={branchNames} />
        )}

        {(page.nextCursor || cursor) && (
          <nav aria-label={t('pharmacy.expiry.title')} className="flex flex-wrap items-center gap-2">
            {cursor && (
              <Link href={link({})} className={BTN}>
                {t('pharmacy.stock.first')}
              </Link>
            )}
            {page.nextCursor && (
              <Link href={link({ cursor: page.nextCursor })} rel="next" className={BTN}>
                {t('pharmacy.stock.next')}
              </Link>
            )}
          </nav>
        )}
      </div>
    </>
  );
}
