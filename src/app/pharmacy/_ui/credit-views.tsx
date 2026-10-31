import { Info } from 'lucide-react';
import Link from 'next/link';
import type { Translate } from '@/lib/i18n';
import type { AgeingView, StatementRowView } from '@/server/pharmacy/customers-reads';
import { ageingRowOf, statementRowOf } from './credit-logic';
import { CorrectPayment } from './CustomerPayment';
import { phDate } from './ph-date';
import { Num } from './sell-parts';
import { formatMinor, type Currency } from './sell-logic';
import { isolateName as isolate } from './isolate-name';
import type { Locale } from '@/lib/locale';

const TH = 'px-3 py-2 text-start font-medium';
const THE = 'px-3 py-2 text-end font-medium';

/** A table that scrolls inside its own labelled region (never the page), reachable and operable by keyboard. */
function Scroller({ label, testId, minWidth, children }: { label: string; testId: string; minWidth: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 overflow-x-auto rounded-md border border-line" role="region" tabIndex={0} aria-label={label} data-testid={testId}>
      <table className={`w-full ${minWidth} border-collapse text-sm`}>{children}</table>
    </div>
  );
}

/** The ledger rows of a statement: a charge or reversal adds to the debt (debit), a payment or refund lowers it (credit). */
export function StatementTable({ rows, currency, t, locale, canCorrect }: { rows: StatementRowView[]; currency: Currency; t: Translate; locale: Locale; canCorrect: boolean }) {
  return (
    <Scroller label={t('pharmacy.credit.statement.tableLabel')} testId="statement-table" minWidth="min-w-[46rem]">
      <caption className="sr-only">{t('pharmacy.credit.statement.title')}</caption>
      <thead>
        <tr className="border-b border-line text-muted">
          <th scope="col" className={TH}>{t('pharmacy.credit.statement.day')}</th>
          <th scope="col" className={TH}>{t('pharmacy.credit.statement.kind')}</th>
          <th scope="col" className={TH}>{t('pharmacy.credit.statement.ref')}</th>
          <th scope="col" className={THE}>{t('pharmacy.credit.statement.debit')}</th>
          <th scope="col" className={THE}>{t('pharmacy.credit.statement.credit')}</th>
          <th scope="col" className={THE}>{t('pharmacy.credit.statement.balance')}</th>
          {canCorrect && <th scope="col" className={TH}>{t('pharmacy.credit.statement.action')}</th>}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const row = statementRowOf(r, currency);
          return (
            <tr key={r.id} className="border-b border-line align-top last:border-0" data-testid="statement-row" data-kind={r.kind}>
              <td className="px-3 py-2"><bdi dir="ltr">{phDate(`${row.day}T12:00:00Z`, locale)}</bdi></td>
              <td className="px-3 py-2">
                {t(`pharmacy.credit.kind.${r.kind}`)}
                {row.method ? ` · ${t(`pharmacy.credit.method.${row.method}`)}` : ''}
                {r.corrected ? <span className="block text-muted" data-testid="statement-corrected">{t('pharmacy.credit.statement.corrected')}</span> : null}
              </td>
              <td className="px-3 py-2">
                {row.saleId ? (
                  <Link href={`/pharmacy/sales/${row.saleId}`} className="inline-flex min-h-11 items-center rounded-md underline underline-offset-2 hover:bg-hover">
                    <Num>{row.saleNumber ?? t('pharmacy.sales.noNumber')}</Num>
                  </Link>
                ) : (
                  '—'
                )}
              </td>
              <td className="px-3 py-2 text-end tabular-nums" data-testid="statement-debit"><Num>{row.debit}</Num></td>
              <td className="px-3 py-2 text-end tabular-nums" data-testid="statement-credit"><Num>{row.credit}</Num></td>
              <td className="px-3 py-2 text-end font-semibold tabular-nums" data-testid="statement-balance"><Num>{row.balance}</Num></td>
              {canCorrect && <td className="px-3 py-2">{row.correctable && row.paymentId ? <CorrectPayment paymentId={row.paymentId} /> : null}</td>}
            </tr>
          );
        })}
      </tbody>
    </Scroller>
  );
}

/** What customers owe by age, per customer; the totals are per currency and never summed across them. */
export function AgeingTable({ view, t }: { view: AgeingView; t: Translate }) {
  const buckets = ['0-30', '31-60', '61-90', '90+'] as const;
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <Scroller label={t('pharmacy.credit.ageing.tableLabel')} testId="ageing-table" minWidth="min-w-[40rem]">
        <caption className="sr-only">{t('pharmacy.credit.ageing.title')}</caption>
        <thead>
          <tr className="border-b border-line text-muted">
            <th scope="col" className={TH}>{t('pharmacy.credit.ageing.customer')}</th>
            <th scope="col" className={THE}>{t('pharmacy.credit.ageing.owed')}</th>
            {buckets.map((b) => (
              <th key={b} scope="col" className={THE}>{t('pharmacy.credit.ageing.days', { bucket: b })}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {view.items.map((item) => {
            const row = ageingRowOf(item);
            return (
              <tr key={item.customerId} className="border-b border-line last:border-0" data-testid="ageing-row">
                <td className="px-3 py-2" dir="auto">
                  <Link href={`/pharmacy/customers/${item.customerId}`} className="inline-flex min-h-11 items-center rounded-md underline underline-offset-2 hover:bg-hover">
                    {isolate(row.name)}
                  </Link>
                </td>
                <td className="px-3 py-2 text-end font-semibold tabular-nums" data-testid="ageing-owed"><Num>{row.owed}</Num> {row.currency}</td>
                {row.cells.map((c) => (
                  <td key={c.bucket} className="px-3 py-2 text-end tabular-nums" data-testid={`ageing-${c.bucket}`}><Num>{c.text}</Num></td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </Scroller>
      <ul className="flex flex-col gap-1 text-sm text-text" aria-label={t('pharmacy.credit.ageing.totals')} data-testid="ageing-totals">
        {view.totals.map((total) => (
          <li key={total.currency}>
            <span className="font-medium">{total.currency}</span>: {t('pharmacy.credit.ageing.totalLine', { count: total.count })} · <Num>{formatMinor(BigInt(total.owedMinor), total.currency)}</Num>
          </li>
        ))}
      </ul>
      <p className="flex items-center gap-2 text-sm text-muted">
        <Info aria-hidden className="size-4 shrink-0" />
        {t('pharmacy.credit.ageing.note', { date: view.asOf })}
      </p>
      {view.hasMore && (
        <p role="status" className="flex items-center gap-2 text-sm text-text" data-testid="ageing-more">
          <Info aria-hidden className="size-4 shrink-0" />
          {t('pharmacy.credit.ageing.more')}
        </p>
      )}
    </div>
  );
}
