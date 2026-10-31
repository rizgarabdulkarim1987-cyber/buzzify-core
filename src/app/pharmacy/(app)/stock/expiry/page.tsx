import { Lock, PackageCheck } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { ExpiryList, ExpiryTotalsRow } from '@/app/pharmacy/_ui/ExpiryList';
import { OfflineNotice } from '@/app/pharmacy/_ui/OfflineNotice';
import { StockBlocked } from '@/app/pharmacy/_ui/StockBlocked';
import { formatNumber } from '@/lib/pos-format';
import { getPhPlaces } from '@/server/pharmacy/actor';
import { expiry } from '@/server/pharmacy/queries/expiry';
import { query } from '@/server/studio/framework/invoke';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { buttonClasses } from '@/studio/ui/Button';
import { EmptyState } from '@/studio/ui/EmptyState';
import { PageHeader } from '@/studio/ui/PageHeader';
import { catalogAccess, roleMay } from '../../catalog/access';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('pharmacy.expiry.title') };
}

const PAGE_SIZE = 25;
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
  const header = <PageHeader className="max-sm:px-4" title={t('pharmacy.expiry.title')} description={t('pharmacy.expiry.intro')} />;

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
      <div className="flex min-w-0 flex-col gap-4 px-4 pb-10 sm:px-8">
        {!adjust.ok && <StockBlocked reason={adjust.reason} t={t} />}
        {adjust.ok && access.place.branchId === null && (
          <p data-testid="expiry-pick-branch" className="flex items-start gap-2.5 rounded-md border border-line bg-surface px-3 py-2.5 text-sm text-text">
            <Lock aria-hidden className="mt-px size-4 shrink-0 text-muted" />
            <span className="min-w-0">{t('pharmacy.expiry.pickBranch')}</span>
          </p>
        )}
        <OfflineNotice />

        <nav aria-label={t('pharmacy.expiry.horizon')} className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-muted">{t('pharmacy.expiry.horizon')}</span>
          {HORIZONS.map((d) => (
            <Link
              key={d}
              href={link({ days: d })}
              aria-current={d === days ? 'page' : undefined}
              className={`${buttonClasses(d === days ? 'primary' : 'secondary', 'lg', 'min-h-11')}`}
            >
              {t('pharmacy.expiry.horizon.option', { days: formatNumber(d) })}
            </Link>
          ))}
        </nav>

        <ExpiryTotalsRow totals={page.totals} days={days} t={t} />

        {page.items.length === 0 ? (
          <div data-testid="expiry-empty">
            <EmptyState icon={<PackageCheck />} title={t('pharmacy.expiry.empty.title', { days: formatNumber(days) })} body={t('pharmacy.expiry.empty.body')} />
          </div>
        ) : (
          <ExpiryList items={page.items} t={t} userId={actor.userId} canFollow={mayFollow} branchNames={branchNames} />
        )}

        {(page.nextCursor || cursor) && (
          <nav aria-label={t('pharmacy.expiry.title')} className="flex flex-wrap items-center gap-2">
            {cursor && (
              <Link href={link({})} className={buttonClasses('secondary', 'lg', 'min-h-11')}>
                {t('pharmacy.stock.first')}
              </Link>
            )}
            {page.nextCursor && (
              <Link href={link({ cursor: page.nextCursor })} rel="next" className={buttonClasses('secondary', 'lg', 'min-h-11')}>
                {t('pharmacy.stock.next')}
              </Link>
            )}
          </nav>
        )}
      </div>
    </>
  );
}
