import type { Metadata } from 'next';
import Link from 'next/link';
import { baghdadDay, baghdadDayOf, baghdadMonthOf, DAY_MS, isCalendarDay } from '@/lib/baghdad';
import { formatNumber } from '@/lib/pos-format';
import { checkRange } from '@/server/pos/range-report';
import { query } from '@/server/studio/framework/invoke';
import { posBreakdown } from '@/server/studio/queries/pos-breakdown';
import { posRangeReport } from '@/server/studio/queries/pos-inventory';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { PageHeader } from '@/studio/ui/PageHeader';
import { StatusBadge } from '@/studio/ui/StatusBadge';
import { BreakdownTables } from '@/app/pos/_ui/BreakdownTables';
import { moneyLabel } from '@/app/pos/_ui/stock/view';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('pos.range.title') };
}

function shift(day: string, n: number): string {
  return baghdadDayOf(new Date(baghdadDay(day).start.getTime() + n * DAY_MS + 12 * 3_600_000));
}

function monthBounds(month: string): { from: string; to: string } {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
  return { from: `${month}-01`, to: shift(`${next}-01`, -1) };
}

/** A week, a month or any dates up to 92 days: sales, refunds, purchases and a margin only where the cost is known. */
export default async function RangePage({ searchParams }: { searchParams: Promise<{ preset?: string; from?: string; to?: string }> }) {
  const [{ preset, from: askedFrom, to: askedTo }, locale] = await Promise.all([searchParams, requestStudioLocale()]);
  const t = getStudioTranslator(locale);
  const today = baghdadDayOf(new Date());
  const thisMonth = baghdadMonthOf(new Date());
  const lastMonth = monthBounds(shift(`${thisMonth}-01`, -1).slice(0, 7));
  let from = shift(today, -6);
  let to = today;
  if (preset === 'month') ({ from, to } = { from: `${thisMonth}-01`, to: today });
  else if (preset === 'lastMonth') ({ from, to } = lastMonth);
  else if (askedFrom && askedTo && isCalendarDay(askedFrom) && isCalendarDay(askedTo)) ({ from, to } = { from: askedFrom, to: askedTo });
  const checked = checkRange(from, to);
  const problem = 'problem' in checked ? checked.problem : null;
  const active = preset === 'month' || preset === 'lastMonth' ? preset : askedFrom && askedTo ? 'custom' : 'week';
  const [report, breakdown] = problem === null ? await Promise.all([query(posRangeReport, { from, to }), query(posBreakdown, { from, to })]) : [null, null];
  const presets = [
    { key: 'week', href: '/pos/report/range', label: t('pos.range.week') },
    { key: 'month', href: '/pos/report/range?preset=month', label: t('pos.range.month') },
    { key: 'lastMonth', href: '/pos/report/range?preset=lastMonth', label: t('pos.range.lastMonth') },
  ];
  return (
    <>
      <PageHeader
        above={
          <Link href="/pos/report" className="inline-flex min-h-12 items-center text-base text-muted underline underline-offset-2">
            {t('pos.range.daily')}
          </Link>
        }
        title={t('pos.range.title')}
        description={<span dir="ltr">{from} → {to}</span>}
      />
      <div className="flex flex-col gap-8 px-8 pb-8">
        <nav aria-label={t('pos.range.presets')} className="flex flex-wrap gap-2">
          {presets.map((item) => (
            <Link key={item.key} href={item.href} aria-current={item.key === active ? 'page' : undefined} className={`inline-flex min-h-12 items-center rounded-md px-4 text-base font-medium ${item.key === active ? 'bg-ink text-on-ink' : 'text-text hover:bg-hover'}`}>
              {item.label}
            </Link>
          ))}
        </nav>
        <form method="get" action="/pos/report/range" className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm text-muted">
            {t('pos.range.from')}
            <input type="date" name="from" defaultValue={from} required className="min-h-12 rounded-md border border-line bg-surface px-3 text-base text-text" dir="ltr" />
          </label>
          <label className="flex flex-col gap-1 text-sm text-muted">
            {t('pos.range.to')}
            <input type="date" name="to" defaultValue={to} required className="min-h-12 rounded-md border border-line bg-surface px-3 text-base text-text" dir="ltr" />
          </label>
          <button type="submit" className="inline-flex min-h-12 items-center rounded-md bg-ink px-5 text-base font-medium text-on-ink">
            {t('pos.range.show')}
          </button>
        </form>

        {problem !== null ? (
          <p role="alert" className="text-base text-danger">
            {t(`pos.range.problem.${problem}`)}
          </p>
        ) : report ? (
          <>
            <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[
                { key: 'gross', label: t('pos.range.gross'), value: report.totals.grossSales },
                { key: 'refunds', label: t('pos.range.refunds'), value: report.totals.refundsTotal },
                { key: 'net', label: t('pos.range.net'), value: report.totals.netSales },
                ...(report.costsHidden ? [] : [{ key: 'purchases', label: t('pos.range.purchases'), value: report.totals.purchasesTotal }]),
              ].map((tile) => (
                <div key={tile.key} className="flex flex-col gap-1 rounded-lg border border-line px-4 py-3">
                  <dt className="text-sm text-muted">{tile.label}</dt>
                  <dd className="text-xl font-semibold text-text" data-testid={`range-${tile.key}`}>
                    {moneyLabel(t, tile.value)}
                  </dd>
                </div>
              ))}
            </dl>

            {report.costsHidden ? null : (
              <section aria-labelledby="range-cost" className="flex flex-col gap-3">
                <h2 id="range-cost" className="text-base font-semibold text-text">
                  {t('pos.range.coverage')}
                </h2>
                {report.totals.coverage.soldLines === 0 ? (
                  <p className="text-sm text-muted">{t('pos.range.noSales')}</p>
                ) : report.totals.coverage.uncoveredLines === 0 ? (
                  <p className="text-base text-text" data-testid="range-margin">
                    {t('pos.range.marginAll', { margin: moneyLabel(t, report.totals.coverage.coveredMargin), cost: moneyLabel(t, report.totals.coverage.coveredCost) })}
                  </p>
                ) : (
                  <p className="text-base text-text" data-testid="range-margin-partial">
                    {t('pos.range.marginPartial', {
                      margin: moneyLabel(t, report.totals.coverage.coveredMargin),
                      covered: moneyLabel(t, report.totals.coverage.coveredSales),
                      uncovered: moneyLabel(t, report.totals.coverage.uncoveredSales),
                      lines: formatNumber(report.totals.coverage.uncoveredLines),
                    })}
                  </p>
                )}
                <p className="text-sm text-muted">{t('pos.range.marginNote')}</p>
                <p className="text-sm text-muted">
                  {t('pos.range.purchasesLine', { count: formatNumber(report.totals.purchaseCount), unpaid: moneyLabel(t, report.totals.purchasesUnpaid) })}
                  {report.totals.wasteCost > 0 || report.totals.wasteUnknown > 0
                    ? ` ${t('pos.range.wasteLine', { cost: moneyLabel(t, report.totals.wasteCost), unknown: formatNumber(report.totals.wasteUnknown) })}`
                    : ''}
                </p>
              </section>
            )}

            <section aria-labelledby="range-days" className="flex flex-col gap-3">
              <h2 id="range-days" className="text-base font-semibold text-text">
                {t('pos.range.byDay')}
              </h2>
              <div className="overflow-x-auto rounded-lg border border-line">
                <table className="w-full min-w-96 text-start text-base">
                  <thead className="text-sm text-muted">
                    <tr>
                      <th scope="col" className="px-4 py-2 text-start font-medium">{t('pos.range.day')}</th>
                      <th scope="col" className="px-4 py-2 text-start font-medium">{t('pos.range.net')}</th>
                      <th scope="col" className="px-4 py-2 text-start font-medium">{t('pos.range.refunds')}</th>
                      {report.costsHidden ? null : <th scope="col" className="px-4 py-2 text-start font-medium">{t('pos.range.purchases')}</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {report.days.map((day) => (
                      <tr key={day.day}>
                        <th scope="row" className="px-4 py-2 text-start font-normal" dir="ltr">{day.day}</th>
                        <td className="px-4 py-2">{moneyLabel(t, day.netSales)}</td>
                        <td className="px-4 py-2">{moneyLabel(t, day.refundsTotal)}</td>
                        {report.costsHidden ? null : <td className="px-4 py-2">{moneyLabel(t, day.purchasesTotal)}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section aria-labelledby="range-products" className="flex flex-col gap-3">
              <h2 id="range-products" className="text-base font-semibold text-text">
                {t('pos.range.products')}
              </h2>
              {report.products.length === 0 ? (
                <p className="text-sm text-muted">{t('pos.range.noSales')}</p>
              ) : (
                <ul className="flex flex-col divide-y divide-line rounded-lg border border-line">
                  {report.products.map((product) => (
                    <li key={product.name} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate text-base text-text" dir="auto">{product.name}</span>
                        <span className="text-sm text-muted">{t('pos.range.sold', { n: formatNumber(product.quantity) })}</span>
                      </span>
                      <span className="flex flex-col items-end gap-1">
                        <span className="text-base text-text">{moneyLabel(t, product.sales)}</span>
                        {report.costsHidden ? null : product.margin !== null ? (
                          <span className="text-sm text-muted">{t('pos.range.margin', { margin: moneyLabel(t, product.margin) })}</span>
                        ) : (
                          <StatusBadge>{t(`pos.range.status.${product.status}`)}</StatusBadge>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {breakdown ? <BreakdownTables t={t} breakdown={breakdown} from={from} to={to} /> : null}
          </>
        ) : null}
      </div>
    </>
  );
}
