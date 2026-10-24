'use client';

import Link from 'next/link';
import { formatNumber } from '@/lib/pos-format';
import { countKind } from '@/lib/pos-view';
import type { DailyReport, ShiftReport } from '@/server/pos/report';
import { useT } from '@/studio/i18n';
import { Button } from '@/studio/ui/Button';
import { cx } from '@/studio/ui/cx';
import { EmptyState } from '@/studio/ui/EmptyState';
import { useMoney } from './money';

/** One Baghdad day: the sales, discounts, cancellations and drawer counts of its shifts, printable. */
export function DailyReportView({ report }: { report: DailyReport }) {
  const t = useT();
  const money = useMoney();
  const totals = report.totals;
  return (
    <div className="flex max-w-3xl flex-col gap-5 px-4 pb-8 sm:px-8 print:max-w-none print:p-0">
      <form method="get" className="flex flex-wrap items-end gap-3 print:hidden">
        <label className="flex flex-col gap-1.5 text-base font-medium">
          {t('pos.report.day')}
          <input type="date" name="day" defaultValue={report.day} dir="ltr" className="min-h-12 rounded-md border border-line-strong bg-raised px-3 text-base" />
        </label>
        <Button type="submit" variant="secondary" size="lg" className="min-h-12">
          {t('pos.report.show')}
        </Button>
        <Button type="button" variant="ghost" size="lg" className="min-h-12" onClick={() => window.print()}>
          {t('pos.receipt.print')}
        </Button>
      </form>

      <h2 className="text-lg font-semibold" dir="ltr">
        {report.day}
      </h2>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label={t('pos.report.netSales')} value={money(totals.netSales)} strong />
        <Stat label={t('pos.report.discounts')} value={money(totals.discountsTotal)} />
        <Stat label={t('pos.report.expenses')} value={money(totals.expensesTotal)} />
        <Stat label={t('pos.report.cancelled')} value={`${formatNumber(totals.cancelledOrders)} / ${formatNumber(totals.cancelledLines)}`} hint={t('pos.report.cancelledHint')} />
      </dl>

      {report.shifts.length === 0 ? (
        <EmptyState title={t('pos.report.noShifts')} />
      ) : (
        report.shifts.map((shift) => <ShiftCard key={shift.shift.id} shift={shift} />)
      )}

      {report.outsideShifts ? (
        <section className="rounded-lg border border-line p-4">
          <h3 className="text-base font-semibold">{t('pos.report.outside')}</h3>
          <p className="text-base text-muted">
            {t('pos.report.outsideCounts', { orders: formatNumber(report.outsideShifts.cancelledOrders), lines: formatNumber(report.outsideShifts.cancelledLines) })}
          </p>
          <ul className="mt-2 text-base">
            {report.outsideShifts.byActor.map((actor) => (
              <li key={actor.name}>
                {actor.name}: {formatNumber(actor.orders)} / {formatNumber(actor.lines)}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function Stat({ label, value, hint, strong }: { label: string; value: string; hint?: string; strong?: boolean }) {
  return (
    <div className="rounded-lg border border-line p-3">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className={cx('mt-1', strong ? 'text-xl font-semibold' : 'text-lg font-medium')}>{value}</dd>
      {hint ? <dd className="text-xs text-muted">{hint}</dd> : null}
    </div>
  );
}

function ShiftCard({ shift }: { shift: ShiftReport }) {
  const t = useT();
  const money = useMoney();
  const open = shift.shift.closedAt === null;
  const kind = shift.difference === null ? null : countKind(shift.difference);
  return (
    <section className="flex flex-col gap-2 rounded-lg border border-line p-4">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-base font-semibold">{shift.cashierName}</h3>
        <span className="text-sm text-muted">{open ? t('pos.report.stillOpen') : t('pos.report.closed')}</span>
      </header>
      <dl className="flex flex-col gap-1 text-base">
        <Line label={t('pos.report.netSales')} value={money(shift.netSales)} />
        <Line label={t('pos.report.discounts')} value={money(shift.discountsTotal)} />
        <Line label={t('pos.shift.expenses')} value={money(shift.expenses.reduce((sum, e) => sum + e.amount, 0))} />
        <Line label={t('pos.shift.expected')} value={money(shift.expectedCash)} />
        {shift.countedCash !== null ? <Line label={t('pos.shift.counted')} value={money(shift.countedCash)} /> : null}
        {kind ? (
          <div className={cx('flex justify-between font-semibold', kind === 'exact' ? 'text-success' : 'text-danger')}>
            <dt>{t(`pos.shift.${kind}`)}</dt>
            <dd>{kind === 'exact' ? '' : money(Math.abs(shift.difference!))}</dd>
          </div>
        ) : null}
        <Line label={t('pos.report.cancelled')} value={`${formatNumber(shift.cancelledOrders)} / ${formatNumber(shift.cancelledLines)}`} />
      </dl>
      {shift.cancelReasons.length > 0 ? (
        <p className="text-sm text-muted">{shift.cancelReasons.map((r) => `${r.reason || t('pos.report.noReason')} (${formatNumber(r.count)})`).join(' · ')}</p>
      ) : null}
      <Link href={`/pos/shift/${shift.shift.id}`} className="text-sm underline underline-offset-2 print:hidden">
        {t('pos.report.openShift')}
      </Link>
    </section>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
