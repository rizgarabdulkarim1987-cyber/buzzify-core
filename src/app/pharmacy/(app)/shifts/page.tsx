import { DoorOpen, History } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Forbidden, Pager, PickBranch, StaleCursor } from '@/app/pharmacy/_ui/PageGate';
import { Money, ShiftStatus } from '@/app/pharmacy/_ui/money-parts';
import { ShiftPanel } from '@/app/pharmacy/_ui/ShiftPanel';
import { WriteBlocked } from '@/app/pharmacy/_ui/WriteBlocked';
import { Num } from '@/app/pharmacy/_ui/sell-parts';
import { formatUtc, shortId } from '@/app/pharmacy/_ui/shifts-logic';
import { current, list } from '@/server/pharmacy/queries/shifts';
import { search } from '@/server/pharmacy/queries/sell';
import { SHIFT_STATUSES } from '@/server/pharmacy/shifts-reads';
import { query, queryByCursor } from '@/server/studio/framework/invoke';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { EmptyState } from '@/studio/ui/EmptyState';
import { PageHeader } from '@/studio/ui/PageHeader';
import { catalogAccess, roleMay } from '../catalog/access';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('pharmacy.shifts.title') };
}

const PAGE_SIZE = 20;
const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
const LINK = 'inline-flex min-h-11 items-center rounded-md px-3 text-sm font-medium text-text hover:bg-hover';

/**
 * Shifts: the person's own open shift with live cash figures (paid in, paid out, close), then the history of shifts.
 * A holder of `report.view` sees every shift of the branch (and can close a colleague's open one); a cashier sees only
 * their own. The server judges every call again.
 */
export default async function ShiftsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [raw, access, locale] = await Promise.all([searchParams, catalogAccess(), requestStudioLocale()]);
  const t = getStudioTranslator(locale);
  const { actor, place, placeInput } = access;
  const header = <PageHeader className="max-sm:px-4" title={t('pharmacy.shifts.title')} description={t('pharmacy.shifts.intro')} />;
  const mayUse = roleMay(actor, 'shift.use');
  const mayReport = roleMay(actor, 'report.view');
  if (actor.role === null || (!mayUse && !mayReport)) {
    return (
      <>
        {header}
        <Forbidden t={t} scope="shifts" support={actor.role === null} />
      </>
    );
  }
  if (!place.branchId) {
    return (
      <>
        {header}
        <PickBranch t={t} scope="shifts" />
      </>
    );
  }

  const status = SHIFT_STATUSES.find((s) => s === one(raw.status));
  const cursor = one(raw.cursor)?.slice(0, 64) || undefined;
  const write = access.writable('shift.use');
  const live = mayUse && write.ok;
  const [now, found, listed] = await Promise.all([
    live ? query(current, placeInput) : Promise.resolve(null),
    live ? query(search, { ...placeInput, q: '', limit: 1 }) : Promise.resolve(null),
    queryByCursor(list, { ...placeInput, ...(status ? { status } : {}), ...(cursor ? { cursor } : {}), pageSize: PAGE_SIZE }),
  ]);
  const stale = listed.staleCursor;
  const page = listed.staleCursor ? { items: [], nextCursor: null } : listed.data;
  const href = (over: { status?: string | undefined; cursor?: string | undefined }) => {
    const next = new URLSearchParams();
    if (over.status) next.set('status', over.status);
    if (over.cursor) next.set('cursor', over.cursor);
    const text = next.toString();
    return `/pharmacy/shifts${text ? `?${text}` : ''}`;
  };

  return (
    <>
      {header}
      <div className="flex min-w-0 flex-col gap-8 px-4 pb-10 sm:px-8">
        {mayUse && !write.ok && <WriteBlocked writable={write} />}
        {live && found && (
          <ShiftPanel
            shift={now?.shift ?? null}
            totals={now?.totals ?? null}
            currencies={found.settings.enabledCurrencies}
            defaultCurrency={found.settings.defaultCurrency}
            asOf={new Date().toISOString()}
          />
        )}

        <section aria-labelledby="history" className="flex min-w-0 flex-col gap-3">
          <h2 id="history" className="flex items-center gap-2 text-lg font-semibold text-text">
            <History aria-hidden className="size-5 shrink-0 text-muted" />
            {t(mayReport ? 'pharmacy.shifts.historyBranch' : 'pharmacy.shifts.historyMine')}
          </h2>
          <nav aria-label={t('pharmacy.shifts.filter')} className="flex flex-wrap gap-1">
            {[undefined, ...SHIFT_STATUSES].map((s) => (
              <Link key={s ?? 'all'} href={href({ status: s })} aria-current={status === s ? 'page' : undefined} className={`${LINK} ${status === s ? 'bg-hover underline underline-offset-4' : ''}`}>
                {t(s ? `pharmacy.shifts.status.${s}` : 'pharmacy.shifts.filter.all')}
              </Link>
            ))}
          </nav>
          {stale ? (
            <StaleCursor t={t} href={href({ status })} />
          ) : page.items.length === 0 ? (
            <div data-testid="shifts-empty">
              <EmptyState icon={<DoorOpen />} title={t('pharmacy.shifts.empty.title')} body={t('pharmacy.shifts.empty.body')} />
            </div>
          ) : (
            <ul aria-label={t('pharmacy.shifts.title')} className="flex flex-col border-t border-line" data-testid="shift-list">
              {page.items.map((s) => (
                <li key={s.id} data-testid="shift-row" className="flex flex-wrap items-center gap-x-5 gap-y-1.5 border-b border-line py-3 text-sm">
                  <ShiftStatus status={s.status} t={t} />
                  <span className="text-text">
                    <span className="text-muted">{t('pharmacy.shifts.openedAt')}: </span>
                    <Num>{formatUtc(s.openedAt)}</Num>
                  </span>
                  <span className="text-text">
                    <span className="text-muted">{t('pharmacy.shifts.cashier')}: </span>
                    <Num>{shortId(s.userId)}</Num>
                  </span>
                  {s.status === 'CLOSED' && s.varianceMinor !== null && (
                    <span className="text-text" data-testid="row-variance">
                      <span className="text-muted">{t('pharmacy.shifts.varianceLabel')}: </span>
                      <Money minor={s.varianceMinor} currency={s.currency} signed />
                    </span>
                  )}
                  <Link href={`/pharmacy/shifts/${s.id}`} className="ms-auto inline-flex min-h-11 items-center rounded-md px-2 font-medium text-text underline underline-offset-2 hover:bg-hover" data-testid="shift-open-report">
                    {t(s.status === 'OPEN' && mayReport ? 'pharmacy.shifts.openReportClose' : 'pharmacy.shifts.openReport')}
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <Pager t={t} label={t('pharmacy.shifts.title')} first={cursor && !stale ? href({ status }) : null} next={page.nextCursor ? href({ status, cursor: page.nextCursor }) : null} />
        </section>
      </div>
    </>
  );
}
