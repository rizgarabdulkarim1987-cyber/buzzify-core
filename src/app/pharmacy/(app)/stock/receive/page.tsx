import { Lock, PackagePlus, PackageSearch, SearchX } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { OfflineNotice } from '@/app/pharmacy/_ui/OfflineNotice';
import { ReceiptStatus } from '@/app/pharmacy/_ui/ReceiptStatus';
import { ReceiveBlocked } from '@/app/pharmacy/_ui/ReceiveBlocked';
import { formatNumber } from '@/lib/pos-format';
import { getPhPlaces } from '@/server/pharmacy/actor';
import { list } from '@/server/pharmacy/queries/receipts';
import { query } from '@/server/studio/framework/invoke';
import { phDate } from '@/app/pharmacy/_ui/ph-date';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { buttonClasses } from '@/studio/ui/Button';
import { EmptyState } from '@/studio/ui/EmptyState';
import { PageHeader } from '@/studio/ui/PageHeader';
import { catalogAccess, roleMay } from '../../catalog/access';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('pharmacy.receive.title') };
}

const PAGE_SIZE = 25;
const STATUSES = ['DRAFT', 'CONFIRMED', 'VOID'] as const;
type Status = (typeof STATUSES)[number];
const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/**
 * The deliveries received by hand, newest first: number, supplier, date, lines and state, filtered by state. Every staff
 * role may look; starting or changing a receipt follows the role (`purchase.manage`), the pharmacy's state and having one
 * branch chosen, and the page says why the button is missing. A support actor gets a sentence, not an empty page.
 */
export default async function ReceiptsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [raw, access, locale, places] = await Promise.all([searchParams, catalogAccess(), requestStudioLocale(), getPhPlaces()]);
  const t = getStudioTranslator(locale);
  const { actor } = access;
  const rawStatus = one(raw.status);
  const status: Status | undefined = STATUSES.find((s) => s === rawStatus);
  const cursor = one(raw.cursor);
  const header = <PageHeader className="max-sm:px-4" title={t('pharmacy.receive.title')} description={t('pharmacy.receive.intro')} />;

  if (actor.role === null) {
    return (
      <>
        {header}
        <div data-testid="receive-forbidden" className="px-4 pb-10 sm:px-8">
          <EmptyState icon={<Lock />} title={t('pharmacy.receive.forbidden.title')} body={t('pharmacy.receive.forbidden.support')} />
        </div>
      </>
    );
  }

  const page = await query(list, {
    ...access.placeInput,
    ...(status ? { status } : {}),
    ...(cursor ? { cursor } : {}),
    pageSize: PAGE_SIZE,
  });
  const branches = places.find((p) => p.restaurantId === access.placeInput.restaurantId)?.branches ?? [];
  const branchNames = Object.fromEntries(branches.map((b) => [b.id, b.name]));
  const writable = access.writable('purchase.manage');
  const mayReceive = roleMay(actor, 'purchase.manage');
  const links = (over: { status?: string; cursor?: string }) => {
    const next = new URLSearchParams();
    const merged = { status, cursor, ...over };
    for (const [key, value] of Object.entries(merged)) if (value) next.set(key, value);
    const text = next.toString();
    return `/pharmacy/stock/receive${text ? `?${text}` : ''}`;
  };
  const filters: Array<{ value: Status | undefined; label: string }> = [
    { value: undefined, label: t('pharmacy.receive.filter.all') },
    ...STATUSES.map((s) => ({ value: s, label: t(`pharmacy.receive.status.${s}`) })),
  ];

  return (
    <>
      <PageHeader
        className="max-sm:px-4"
        title={t('pharmacy.receive.title')}
        description={t('pharmacy.receive.intro')}
        actions={
          writable.ok ? (
            <Link href="/pharmacy/stock/receive/new" className={buttonClasses('primary', 'lg', 'min-h-11')}>
              <PackagePlus aria-hidden />
              {t('pharmacy.receive.new')}
            </Link>
          ) : undefined
        }
      />
      <div className="flex min-w-0 flex-col gap-4 px-4 pb-10 sm:px-8">
        {mayReceive && !writable.ok && <ReceiveBlocked reason={writable.reason} t={t} />}
        {!mayReceive && <ReceiveBlocked reason="role" t={t} />}
        <OfflineNotice />

        <nav aria-label={t('pharmacy.receive.filter.label')} className="flex flex-wrap gap-2">
          {filters.map((f) => {
            const current = f.value === status;
            return (
              <Link
                key={f.label}
                href={links({ status: f.value, cursor: undefined })}
                aria-current={current ? 'page' : undefined}
                className={buttonClasses(current ? 'primary' : 'secondary', 'lg', 'min-h-11')}
              >
                {f.label}
              </Link>
            );
          })}
        </nav>

        {page.items.length === 0 ? (
          <div data-testid="receive-empty">
            <EmptyState
              icon={status ? <SearchX /> : <PackageSearch />}
              title={t(status ? 'pharmacy.receive.empty.filtered' : 'pharmacy.receive.empty.title')}
              body={t(status ? 'pharmacy.receive.empty.filteredBody' : 'pharmacy.receive.empty.body')}
            />
          </div>
        ) : (
          <ul aria-label={t('pharmacy.receive.title')} className="flex flex-col border-t border-line">
            {page.items.map((r) => (
              <li key={r.id} data-testid="receipt-row" className="border-b border-line">
                <Link
                  href={`/pharmacy/stock/receive/${r.id}`}
                  className="grid min-h-11 min-w-0 grid-cols-1 gap-x-6 gap-y-1 rounded-sm px-1 py-3 hover:bg-hover md:grid-cols-[minmax(0,9rem)_minmax(0,8rem)_minmax(0,2fr)_minmax(0,1.2fr)_minmax(0,8rem)_minmax(0,5rem)] md:items-center"
                >
                  <span className="text-base font-medium text-text">
                    {r.number ? (
                      <bdi dir="ltr" className="tabular-nums">
                        {r.number}
                      </bdi>
                    ) : (
                      <span className="text-muted">{t('pharmacy.receive.noNumber')}</span>
                    )}
                  </span>
                  <span>
                    <ReceiptStatus status={r.status} t={t} />
                  </span>
                  <span dir="auto" className="min-w-0 break-words text-sm text-text">
                    <span className="text-muted md:sr-only">{t('pharmacy.receive.field.supplier')}: </span>
                    {r.supplierName || <span className="text-muted">{t('pharmacy.receive.none')}</span>}
                    {branchNames[r.branchId] && access.place.branchId === null ? ` · ${branchNames[r.branchId]}` : ''}
                  </span>
                  <span className="min-w-0 break-words text-sm text-text">
                    <span className="text-muted md:sr-only">{t('pharmacy.receive.field.reference')}: </span>
                    {r.reference ? <bdi dir="ltr">{r.reference}</bdi> : <span className="text-muted">{t('pharmacy.receive.none')}</span>}
                  </span>
                  <span className="text-sm text-text">
                    <span className="text-muted md:sr-only">{t('pharmacy.receive.field.receivedOn')}: </span>
                    <bdi dir="ltr">{phDate(`${r.receivedOn}T00:00:00.000Z`, locale)}</bdi>
                  </span>
                  <span className="text-sm text-text tabular-nums">
                    <span className="text-muted md:sr-only">{t('pharmacy.receive.col.lines')}: </span>
                    <bdi dir="ltr">{formatNumber(r.lineCount)}</bdi>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}

        {(page.nextCursor || cursor) && (
          <nav aria-label={t('pharmacy.receive.title')} className="flex flex-wrap items-center gap-2">
            {cursor && (
              <Link href={links({ cursor: undefined })} className={buttonClasses('secondary', 'lg', 'min-h-11')}>
                {t('pharmacy.stock.first')}
              </Link>
            )}
            {page.nextCursor && (
              <Link href={links({ cursor: page.nextCursor })} rel="next" className={buttonClasses('secondary', 'lg', 'min-h-11')}>
                {t('pharmacy.stock.next')}
              </Link>
            )}
          </nav>
        )}
      </div>
    </>
  );
}
