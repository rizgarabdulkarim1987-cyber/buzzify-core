import { CircleAlert, Info, ScrollText, SearchX } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { OfflineNotice } from '@/app/pharmacy/_ui/OfflineNotice';
import { loadPages, pagesOf } from '@/app/pharmacy/_ui/load-pages';
import { keysetOf, netRegister } from '@/app/pharmacy/_ui/prescription-logic';
import { Note, Num } from '@/app/pharmacy/_ui/sell-parts';
import { isolateName as isolate } from '@/app/pharmacy/_ui/isolate-name';
import { baghdadDay, validDay } from '@/server/domain/pharmacy/reports-domain';
import { register } from '@/server/pharmacy/queries/prescriptions';
import { query } from '@/server/studio/framework/invoke';
import { StudioError } from '@/server/studio/framework/result';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { buttonClasses } from '@/studio/ui/Button';
import { EmptyState } from '@/studio/ui/EmptyState';
import { PageHeader } from '@/studio/ui/PageHeader';
import { rxGate } from '../gate';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('pharmacy.rx.register.title') };
}

const PAGE = 100;
const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
const dayOrNull = (v: string | undefined) => (v && validDay(v) ? v : null);

/**
 * The controlled-drug register, read only: what was dispensed and what came back, netted by Baghdad day, product and batch. It
 * holds no patient field and no prescription number. The rows are read newest first by cursor, so the table nets the rows loaded
 * so far (the page says so while more remain). Days are Baghdad days, at most 366.
 */
export default async function RegisterPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [raw, g] = await Promise.all([searchParams, rxGate('pharmacy.rx.register.title', { href: '/pharmacy/prescriptions', labelKey: 'pharmacy.rx.back' })]);
  if (g.blocked) return g.blocked;
  const { access, t } = g;
  const today = baghdadDay(new Date());
  const from = dayOrNull(one(raw.from));
  const to = dayOrNull(one(raw.to));
  const ranged = from !== null && to !== null;
  const pages = pagesOf(one(raw.pages));
  let refusal: 'long' | 'order' | null = null;
  let rows: Parameters<typeof netRegister>[0][number][] = [];
  let next: string | null = null;
  try {
    const loaded = await loadPages(async (cursor) => keysetOf(await query(register, { ...access.placeInput, limit: PAGE + 1, ...(ranged ? { from, to } : {}), ...(cursor ? { cursor } : {}) }), PAGE), pages);
    rows = loaded.items;
    next = loaded.nextCursor;
  } catch (error) {
    if (error instanceof StudioError && error.code === 'INVALID') refusal = /year/.test(error.fields?.to ?? error.message) ? 'long' : 'order';
    else throw error;
  }
  const net = netRegister(rows, (iso) => baghdadDay(new Date(iso)));
  const href = (over: Record<string, string | undefined>) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries({ from: ranged ? from : undefined, to: ranged ? to : undefined, ...over })) if (v) q.set(k, v);
    const text = q.toString();
    return `/pharmacy/prescriptions/register${text ? `?${text}` : ''}`;
  };
  const half = Boolean(raw.from || raw.to) && !ranged;
  const INPUT = 'min-h-11 rounded-md border border-line-strong bg-raised px-3 text-base text-text';
  return (
    <>
      <PageHeader className="max-sm:px-4" above={g.back} title={t('pharmacy.rx.register.title')} description={t('pharmacy.rx.register.intro')} />
      <div className="flex min-w-0 flex-col gap-4 px-4 pb-10 sm:px-8">
        <OfflineNotice messageKey="pharmacy.reports.offline" />
        <form method="get" className="flex flex-wrap items-end gap-3" data-testid="register-filter">
          <label className="flex flex-col gap-1 text-sm font-medium text-text">
            {t('pharmacy.rx.register.from')}
            <input type="date" name="from" defaultValue={from ?? ''} max={today} dir="ltr" className={INPUT} data-testid="register-from" />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium text-text">
            {t('pharmacy.rx.register.to')}
            <input type="date" name="to" defaultValue={to ?? ''} max={today} dir="ltr" className={INPUT} data-testid="register-to" />
          </label>
          <button type="submit" className={buttonClasses('primary', 'lg', 'min-h-11')} data-testid="register-apply">
            {t('pharmacy.rx.register.apply')}
          </button>
          {ranged && (
            <Link href="/pharmacy/prescriptions/register" className={buttonClasses('secondary', 'lg', 'min-h-11')}>
              {t('pharmacy.rx.register.clear')}
            </Link>
          )}
        </form>
        {half && (
          <Note icon={<CircleAlert aria-hidden />} tone="danger" role="alert" testId="register-range-wrong">
            {t('pharmacy.rx.register.rangeWrong')}
          </Note>
        )}
        {refusal && (
          <Note icon={<CircleAlert aria-hidden />} tone="danger" role="alert" testId="register-refused">
            {t(refusal === 'long' ? 'pharmacy.rx.register.rangeLong' : 'pharmacy.rx.register.rangeOrder')}
          </Note>
        )}
        {next && (
          <Note icon={<Info aria-hidden />} role="status" testId="register-partial">
            {t('pharmacy.rx.register.partial', { count: rows.length })}
          </Note>
        )}
        {net.length === 0 && !refusal ? (
          <div data-testid="register-empty">
            <EmptyState icon={ranged ? <SearchX /> : <ScrollText />} title={t(ranged ? 'pharmacy.rx.register.emptyFiltered' : 'pharmacy.rx.register.empty')} body={t('pharmacy.rx.register.emptyBody')} />
          </div>
        ) : (
          net.length > 0 && (
            <div className="min-w-0 overflow-x-auto rounded-md border border-line" role="region" tabIndex={0} aria-label={t('pharmacy.rx.register.tableLabel')} data-testid="register-table">
              <table className="w-full min-w-[40rem] border-collapse text-sm">
                <caption className="sr-only">{t('pharmacy.rx.register.title')}</caption>
                <thead>
                  <tr className="border-b border-line text-muted">
                    <th scope="col" className="px-3 py-2 text-start font-medium">{t('pharmacy.rx.register.day')}</th>
                    <th scope="col" className="px-3 py-2 text-start font-medium">{t('pharmacy.rx.register.product')}</th>
                    <th scope="col" className="px-3 py-2 text-start font-medium">{t('pharmacy.rx.register.lot')}</th>
                    <th scope="col" className="px-3 py-2 text-end font-medium">{t('pharmacy.rx.register.sold')}</th>
                    <th scope="col" className="px-3 py-2 text-end font-medium">{t('pharmacy.rx.register.returned')}</th>
                    <th scope="col" className="px-3 py-2 text-end font-medium">{t('pharmacy.rx.register.net')}</th>
                  </tr>
                </thead>
                <tbody>
                  {net.map((r) => (
                    <tr key={`${r.day}|${r.productId}|${r.batchId}`} className="border-b border-line last:border-0" data-testid="register-row">
                      <td className="px-3 py-2"><Num>{r.day}</Num></td>
                      <td className="px-3 py-2" dir="auto">{isolate(r.productName)}</td>
                      <td className="px-3 py-2"><Num>{r.lot}</Num></td>
                      <td className="px-3 py-2 text-end tabular-nums" data-testid="register-sold"><Num>{r.sold}</Num></td>
                      <td className="px-3 py-2 text-end tabular-nums" data-testid="register-returned"><Num>{r.returned}</Num></td>
                      <td className="px-3 py-2 text-end font-semibold tabular-nums" data-testid="register-net"><Num>{r.net}</Num></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}
        {next && (
          <nav aria-label={t('pharmacy.rx.register.title')}>
            <Link href={href({ pages: String(pages + 1) })} rel="next" className={buttonClasses('secondary', 'lg', 'min-h-11')} data-testid="register-more">
              {t('pharmacy.purchasing.loadMore')}
            </Link>
          </nav>
        )}
      </div>
    </>
  );
}
