import { ArrowDown, ArrowUp, Boxes, ChartLine, Clock, Minus, Pill, Receipt, ShoppingCart } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import type { Translate } from '@/lib/i18n';
import { DoctorSlot } from './DoctorSlot';
import { average, trendOf, type HomeAttention, type HomeFigures, type HomePeriod } from './home-logic';
import { urgencyTone } from './expiry-groups';
import { Money } from './money-parts';
import { SalesChart } from './SalesChart';
import { Num } from './sell-parts';

type Tone = 'green' | 'blue' | 'amber' | 'red';
const TILE: Record<Tone, string> = {
  green: 'bg-ph-g1 text-ph-g6',
  blue: 'bg-ph-blue-wash text-ph-blue',
  amber: 'bg-ph-amber-wash text-ph-amber-ink',
  red: 'bg-ph-red-wash text-ph-red',
};
const CARD = 'min-w-0 rounded-[22px] bg-ph-card p-4';
const PILL = 'inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-bold';

function Kpi({ testid, tone, icon, label, value, foot }: { testid: string; tone: Tone; icon: ReactNode; label: string; value: ReactNode; foot: ReactNode }) {
  return (
    <li data-testid={testid} className={`${CARD} flex flex-col gap-0.5`}>
      <span aria-hidden className={`mb-1.5 grid size-[38px] place-items-center rounded-ph-xl [&_svg]:size-5 ${TILE[tone]}`}>
        {icon}
      </span>
      <span className="text-xs text-ph-muted">{label}</span>
      <span className="break-words text-2xl font-extrabold tabular-nums">{value}</span>
      {foot}
    </li>
  );
}

function TrendChip({ today, yesterday, t }: { today: number; yesterday: number; t: Translate }) {
  const trend = trendOf(today, yesterday);
  if (!trend) return null;
  const look = { up: 'bg-ph-g1 text-ph-g6', down: 'bg-ph-red-wash text-ph-red', flat: 'bg-ph-canvas text-ph-muted' }[trend.direction];
  const Icon = { up: ArrowUp, down: ArrowDown, flat: Minus }[trend.direction];
  return (
    <span data-testid="home-trend" className={`${PILL} mt-1 self-start font-semibold ${look}`}>
      <Icon aria-hidden className="size-3.5" />
      {t(`pharmacy.home.trend.${trend.direction}`, { pct: trend.pct })}
    </span>
  );
}

function AttentionRow({ item, t }: { item: HomeAttention; t: Translate }) {
  const expiry = item.kind === 'expiry';
  const days = item.days ?? 0;
  // The colour follows the alert (a MONTH batch from the start of its month), the same as the Expiry screen's groups.
  const tone: Tone = !expiry ? 'amber' : urgencyTone(item.urgency ?? days);
  return (
    <li className="flex min-h-[52px] min-w-0 items-center gap-3 border-ph-line py-1.5 [&+&]:border-t sm:[&+&]:border-t-0">
      <span aria-hidden className={`grid size-10 shrink-0 place-items-center rounded-ph-xl [&_svg]:size-5 ${TILE[tone]}`}>
        {expiry ? <Pill /> : <Boxes />}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="break-words font-semibold" dir="auto">
          {item.productName}
        </span>
        <span className="text-xs text-ph-muted">
          {expiry
            ? t('pharmacy.home.attention.batch', { lot: item.detail, qty: item.qty })
            : t('pharmacy.home.attention.left', { qty: item.qty, min: item.min ?? 0 })}
        </span>
      </span>
      <span className={`${PILL} ${TILE[tone]}`}>
        {!expiry ? t('pharmacy.home.attention.low') : days === 0 ? t('pharmacy.home.attention.today') : t('pharmacy.home.attention.days', { count: days })}
      </span>
    </li>
  );
}

/**
 * The pharmacy's home (pharmacy redesign, task 6): greeting and the one "New sale" button, four KPI cards, the sales chart
 * and what needs attention, then the AI Doctor's slot (empty until it ships). Money and invoices are shown only when the
 * figures say the person may see them (`report.view`); the stock cards are for everyone. Server-rendered, no motion.
 */
export function HomeDashboard({
  figures,
  greeting,
  place,
  period,
  sellHref,
  reportsHref,
  t,
}: {
  figures: HomeFigures | null;
  greeting: string;
  place: string;
  period: HomePeriod;
  sellHref: string | null;
  reportsHref: string | null;
  t: Translate;
}) {
  const f = figures;
  return (
    <div className="flex flex-col gap-3.5 px-4 py-5 md:px-[22px]">
      <div className="flex flex-wrap items-center gap-x-3.5 gap-y-3">
        <div className="flex min-w-0 flex-1 flex-col">
          <h1 className="break-words text-[26px] font-bold leading-8 tracking-tight" dir="auto">
            {greeting}
          </h1>
          <p data-testid="home-place" className="break-words text-sm text-ph-muted" dir="auto">
            {place}
          </p>
        </div>
        {sellHref ? (
          <Link href={sellHref} className="inline-flex min-h-11 items-center gap-2 rounded-ph-2xl bg-ph-g8 px-5 text-base font-bold text-ph-on-green hover:bg-ph-g9">
            <ShoppingCart aria-hidden className="size-5" />
            {t('pharmacy.home.newSale')}
          </Link>
        ) : null}
      </div>

      {f ? (
        <>
          <ul aria-label={t('pharmacy.home.kpis')} className="grid grid-cols-2 gap-3.5 lg:grid-cols-4">
            {f.salesVisible ? (
              <>
                <Kpi
                  testid="home-kpi-sales"
                  tone="green"
                  icon={<ChartLine />}
                  label={t('pharmacy.home.kpi.sales')}
                  value={<Money minor={BigInt(f.salesToday)} currency={f.currency} />}
                  foot={<TrendChip today={f.salesToday} yesterday={f.salesYesterday} t={t} />}
                />
                <Kpi
                  testid="home-kpi-invoices"
                  tone="blue"
                  icon={<Receipt />}
                  label={t('pharmacy.home.kpi.invoices')}
                  value={<Num>{f.invoicesToday}</Num>}
                  foot={
                    <span className="text-xs font-semibold text-ph-blue">
                      {t('pharmacy.home.kpi.average')} <Money minor={BigInt(average(f.salesToday, f.invoicesToday))} currency={f.currency} />
                    </span>
                  }
                />
              </>
            ) : null}
            <Kpi
              testid="home-kpi-low"
              tone="amber"
              icon={<Boxes />}
              label={t('pharmacy.home.kpi.lowStock')}
              value={<Num>{f.lowStock}</Num>}
              foot={<span className="text-xs font-semibold text-ph-amber-ink">{t('pharmacy.home.kpi.lowStockUnit')}</span>}
            />
            <Kpi
              testid="home-kpi-expiring"
              tone="red"
              icon={<Clock />}
              label={t('pharmacy.home.kpi.expiring')}
              value={<Num>{f.expiring90}</Num>}
              foot={<span className="text-xs font-semibold text-ph-red">{t('pharmacy.home.kpi.expiringUnit')}</span>}
            />
          </ul>

          {f.salesVisible ? (
            <SalesChart series={f.series} period={period} currency={f.currency} otherCurrencies={f.otherCurrencies} reportsHref={reportsHref} t={t} />
          ) : null}

          <section aria-labelledby="home-attention-title" data-testid="home-attention" className={CARD}>
            <h2 id="home-attention-title" className="mb-2 flex items-center gap-2 text-base font-bold">
              <Clock aria-hidden className="size-5 text-ph-red" />
              {t('pharmacy.home.attention.title')}
            </h2>
            {f.attention.length ? (
              <ul className="grid gap-x-5 sm:grid-cols-2 lg:grid-cols-3">
                {f.attention.map((item, i) => (
                  <AttentionRow key={`${item.kind}-${i}`} item={item} t={t} />
                ))}
              </ul>
            ) : (
              <p className="text-sm text-ph-muted">{t('pharmacy.home.attention.none')}</p>
            )}
          </section>
        </>
      ) : null}

      <DoctorSlot where="home" />
    </div>
  );
}
