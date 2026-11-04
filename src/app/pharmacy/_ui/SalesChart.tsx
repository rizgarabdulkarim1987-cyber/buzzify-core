import Link from 'next/link';
import type { Translate } from '@/lib/i18n';
import { HOME_PERIODS, type HomePeriod } from '@/server/domain/pharmacy/home';
import { chartPaths } from './home-logic';
import { Money } from './money-parts';
import type { Currency } from './sell-logic';

const W = 400;
const H = 150;

/** Which points get a label under the chart: every day for 7 days, every fifth day for 30, every second month; always the last. */
function labelled(count: number, period: HomePeriod): number[] {
  const step = period === '7d' ? 1 : period === '30d' ? 5 : 2;
  const out: number[] = [];
  for (let i = count - 1; i >= 0; i -= step) out.unshift(i);
  return out;
}

function labelOf(label: string, index: number, count: number, period: HomePeriod, t: Translate): string {
  if (period === '12m') return t(`pharmacy.home.month.${Number(label.slice(5, 7))}`);
  if (index === count - 1) return t('pharmacy.home.chart.today');
  if (period === '30d') return String(Number(label.slice(8, 10)));
  // sales.weekday.0 is Monday.
  return t(`sales.weekday.${(new Date(`${label}T00:00:00.000Z`).getUTCDay() + 6) % 7}`);
}

/**
 * The home screen's sales chart: a line and a flat soft fill in plain SVG, drawn on the server, with the period tabs as
 * links (`?period=`). Time runs in reading direction: the SVG is mirrored in right-to-left pages, so today is always at the
 * end. No animation. When every total is 0 it says so instead of drawing a flat line.
 */
export function SalesChart({
  series,
  period,
  currency,
  otherCurrencies,
  reportsHref,
  t,
}: {
  series: { label: string; total: number }[];
  period: HomePeriod;
  currency: Currency;
  otherCurrencies: boolean;
  reportsHref: string | null;
  t: Translate;
}) {
  const paths = chartPaths(
    series.map((p) => p.total),
    W,
    H,
  );
  const marks = labelled(series.length, period);
  const title = t(period === '12m' ? 'pharmacy.home.chart.labelYear' : 'pharmacy.home.chart.label');
  return (
    <section aria-labelledby="home-chart-title" data-testid="home-chart" className="flex min-w-0 flex-col gap-3 rounded-[22px] bg-ph-card p-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 id="home-chart-title" className="text-base font-bold">
          {t('pharmacy.home.chart.title')}
        </h2>
        {reportsHref ? (
          <Link href={reportsHref} className="inline-flex min-h-11 items-center px-1 text-sm font-semibold text-ph-g6 underline-offset-4 hover:underline">
            {t('pharmacy.home.chart.reports')}
          </Link>
        ) : null}
        <nav aria-label={t('pharmacy.home.period.label')} className="ms-auto flex rounded-xl bg-ph-canvas p-0.5">
          {HOME_PERIODS.map((p) => (
            <Link
              key={p}
              href={`?period=${p}`}
              aria-current={p === period ? 'page' : undefined}
              className={`inline-flex min-h-11 items-center rounded-[10px] px-3 text-sm font-semibold ${p === period ? 'bg-ph-card text-ph-text ring-1 ring-ph-line' : 'text-ph-muted hover:text-ph-text'}`}
            >
              {t(`pharmacy.home.period.${p}`)}
            </Link>
          ))}
        </nav>
      </div>
      {otherCurrencies ? (
        <p data-testid="home-other-currencies" className="text-xs text-ph-muted">
          {t('pharmacy.home.otherCurrencies')}
        </p>
      ) : null}
      {paths ? (
        <figure className="m-0 flex flex-col gap-1.5">
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={title} className="block h-36 w-full rtl:-scale-x-100">
            <path d={paths.area} fill="var(--ph-g6)" fillOpacity={0.12} />
            <path d={paths.line} fill="none" stroke="var(--ph-g6)" strokeWidth={3} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          </svg>
          <div aria-hidden className="relative h-4 text-xs text-ph-muted">
            {marks.map((i, n) => {
              const at = series.length > 1 ? (i / (series.length - 1)) * 100 : 0;
              const edge = i === 0 ? 'start' : i === series.length - 1 ? 'end' : 'mid';
              // On a phone, day and month names keep every other label (counted back from the last) so they never touch.
              const sparse = period !== '30d' && (marks.length - 1 - n) % 2 === 1 ? 'max-sm:hidden' : '';
              return (
                <span
                  key={series[i]!.label}
                  className={`absolute top-0 whitespace-nowrap ${sparse} ${edge === 'mid' ? '-translate-x-1/2 rtl:translate-x-1/2' : ''}`}
                  style={edge === 'end' ? { insetInlineEnd: 0 } : { insetInlineStart: `${at}%` }}
                >
                  {labelOf(series[i]!.label, i, series.length, period, t)}
                </span>
              );
            })}
          </div>
          <figcaption className="sr-only">
            <ul>
              {series.map((p, i) => (
                <li key={p.label}>
                  {labelOf(p.label, i, series.length, period, t)} {p.label}: <Money minor={BigInt(p.total)} currency={currency} />
                </li>
              ))}
            </ul>
          </figcaption>
        </figure>
      ) : (
        <p data-testid="home-chart-empty" className="grid min-h-36 place-items-center rounded-xl bg-ph-canvas px-4 text-center text-sm text-ph-muted">
          {t('pharmacy.home.chart.empty')}
        </p>
      )}
    </section>
  );
}
