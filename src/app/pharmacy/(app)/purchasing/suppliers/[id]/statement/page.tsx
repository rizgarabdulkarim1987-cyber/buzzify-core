import { CircleAlert, CircleCheck, Info } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Direction } from '@/app/pharmacy/_ui/money-direction';
import { Amount } from '@/app/pharmacy/_ui/money-status';
import { StatementActions } from '@/app/pharmacy/_ui/StatementActions';
import { SupplierTabs } from '@/app/pharmacy/_ui/SupplierTabs';
import { statement } from '@/server/pharmacy/queries/payables';
import { get } from '@/server/pharmacy/queries/suppliers';
import { query } from '@/server/studio/framework/invoke';
import { phDate } from '@/app/pharmacy/_ui/ph-date';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { buttonClasses } from '@/studio/ui/Button';
import { todayInStudioZone } from '@/app/pharmacy/_ui/ph-date';
import { PageHeader } from '@/studio/ui/PageHeader';
import { purchasingGate } from '../../../gate';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('pharmacy.purchasing.m.st.title') };
}

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY = 86_400_000;
const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const LINKS: Record<'INVOICE' | 'PAYMENT' | 'CREDIT_NOTE', string> = { INVOICE: 'invoices', PAYMENT: 'payments', CREDIT_NOTE: 'credits' };

/**
 * A supplier's statement in one currency over a date range: the balance before the range, every record in day order with a
 * running balance, and the closing balance, with a check that the figure agrees with the invoices. Print uses the browser's
 * print stylesheet; Download CSV builds the file from the rows shown.
 */
export default async function StatementPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ id }, raw, g] = await Promise.all([params, searchParams, purchasingGate('pharmacy.purchasing.m.st.title', { href: '/pharmacy/purchasing/suppliers', labelKey: 'pharmacy.purchasing.suppliers.back' })]);
  if (g.blocked) return g.blocked;
  if (!/^[\w-]{1,64}$/.test(id)) notFound();
  const { access, t, locale } = g;
  const supplier = await query(get, { ...access.placeInput, supplierId: id });
  const today = todayInStudioZone();
  const currencyText = one(raw.currency);
  const currency = currencyText === 'IQD' || currencyText === 'USD' ? currencyText : supplier.defaultCurrency;
  const to = DATE.test(one(raw.to) ?? '') ? one(raw.to)! : today;
  const from = DATE.test(one(raw.from) ?? '') ? one(raw.from)! : day(Date.parse(`${to}T00:00:00.000Z`) - 90 * DAY);
  const span = (Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / DAY;
  const badRange = Number.isNaN(span) || span < 0 || span > 365;
  const view = badRange ? null : await query(statement, { ...access.placeInput, supplierId: id, currency, from, to });
  return (
    <>
      <PageHeader className="max-sm:px-4" above={g.back} title={<span dir="auto">{supplier.name}</span>} description={t('pharmacy.purchasing.m.st.title')} />
      <div className="flex min-w-0 flex-col gap-6 px-4 pb-10 sm:px-8">
        <SupplierTabs supplierId={id} current="statement" t={t} />
        <form method="get" role="search" className="flex flex-wrap items-end gap-2 print:hidden" data-testid="statement-form">
          <label className="flex min-w-0 flex-col gap-1 text-sm text-text">
            {t('pharmacy.purchasing.po.currency')}
            <select name="currency" defaultValue={currency} data-testid="statement-currency" className="min-h-11 w-full rounded-md border border-line-strong bg-raised px-3 text-base text-text sm:w-32">
              <option value="IQD">IQD</option>
              <option value="USD">USD</option>
            </select>
          </label>
          <label className="flex min-w-0 flex-col gap-1 text-sm text-text">
            {t('pharmacy.purchasing.m.st.from')}
            <input type="date" name="from" defaultValue={from} dir="ltr" data-testid="statement-from" className="min-h-11 w-full rounded-md border border-line-strong bg-raised px-3 text-base text-text sm:w-44" />
          </label>
          <label className="flex min-w-0 flex-col gap-1 text-sm text-text">
            {t('pharmacy.purchasing.m.st.to')}
            <input type="date" name="to" defaultValue={to} dir="ltr" data-testid="statement-to" className="min-h-11 w-full rounded-md border border-line-strong bg-raised px-3 text-base text-text sm:w-44" />
          </label>
          <button type="submit" data-testid="statement-go" className={buttonClasses('primary', 'lg', 'min-h-11')}>
            {t('pharmacy.purchasing.m.st.show')}
          </button>
        </form>
        {badRange || !view ? (
          <p role="alert" data-testid="statement-range-error" className="flex items-start gap-2.5 rounded-md bg-danger-wash px-3 py-2.5 text-sm text-danger">
            <CircleAlert aria-hidden className="mt-px size-4 shrink-0" />
            {t('pharmacy.purchasing.m.st.badRange')}
          </p>
        ) : (
          <>
            <p className="text-sm text-muted">
              <bdi dir="ltr">{currency}</bdi> · <bdi dir="ltr">{phDate(`${view.from}T00:00:00.000Z`, locale)}</bdi> – <bdi dir="ltr">{phDate(`${view.to}T00:00:00.000Z`, locale)}</bdi>
            </p>
            {view.opening !== undefined && view.closing !== undefined ? (
              <>
                <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5 text-sm text-text sm:max-w-md" data-testid="statement-figures">
                  <dt className="text-muted">{t('pharmacy.purchasing.m.st.opening')}</dt>
                  <dd className="text-end" data-testid="statement-opening">
                    <Amount amount={view.opening} currency={currency} locale={locale} />
                  </dd>
                  <dt className="font-semibold">{t('pharmacy.purchasing.m.st.closing')}</dt>
                  <dd className="text-end font-semibold" data-testid="statement-closing">
                    <Amount amount={view.closing} currency={currency} locale={locale} />
                  </dd>
                </dl>
                <p className="text-sm text-text" data-testid="statement-direction">
                  <Direction netMinor={view.closing} currency={currency} t={t} locale={locale} />
                </p>
                {view.invariant ? (
                  view.invariant.ok ? (
                    <p data-testid="statement-invariant-ok" className="flex items-start gap-2.5 text-sm text-text">
                      <CircleCheck aria-hidden className="mt-px size-4 shrink-0 text-success" />
                      {t('pharmacy.purchasing.m.st.checkOk')}
                    </p>
                  ) : (
                    <p role="alert" data-testid="statement-invariant-bad" className="flex items-start gap-2.5 rounded-md bg-danger-wash px-3 py-2.5 text-sm text-danger">
                      <CircleAlert aria-hidden className="mt-px size-4 shrink-0" />
                      <span>
                        {t('pharmacy.purchasing.m.st.checkBad')} <Amount amount={view.invariant.difference} currency={currency} locale={locale} />
                      </span>
                    </p>
                  )
                ) : (
                  <p className="flex items-start gap-2.5 text-sm text-muted">
                    <Info aria-hidden className="mt-px size-4 shrink-0" />
                    {t('pharmacy.purchasing.m.st.checkPast')}
                  </p>
                )}
                <StatementActions
                  rows={view.rows.map((r) => ({ date: r.date, ref: r.ref, kind: t(`pharmacy.purchasing.m.st.kind.${r.kind}`), amountMinor: r.amountMinor ?? '0', balanceMinor: r.balanceMinor ?? '0' }))}
                  currency={currency}
                  opening={view.opening}
                  closing={view.closing}
                  fileName={`statement-${id}-${currency}-${view.from}-${view.to}.csv`}
                />
              </>
            ) : (
              <p className="flex items-start gap-2.5 text-sm text-muted">
                <Info aria-hidden className="mt-px size-4 shrink-0" />
                {t('pharmacy.purchasing.m.st.noCost')}
              </p>
            )}
            {view.rows.length === 0 ? (
              <p data-testid="statement-empty" className="flex items-start gap-2.5 text-sm text-muted">
                <Info aria-hidden className="mt-px size-4 shrink-0" />
                {t('pharmacy.purchasing.m.st.empty')}
              </p>
            ) : (
              <ol aria-label={t('pharmacy.purchasing.m.st.title')} className="flex flex-col border-t border-line" data-testid="statement-rows">
                {view.rows.map((r) => (
                  <li key={r.id} data-testid="statement-row" className="grid min-w-0 grid-cols-1 gap-x-6 gap-y-1 border-b border-line py-3 text-sm text-text md:grid-cols-[minmax(0,7rem)_minmax(0,1fr)_minmax(0,10rem)_minmax(0,9rem)_minmax(0,9rem)] md:items-center">
                    <span>
                      <bdi dir="ltr">{phDate(`${r.date}T00:00:00.000Z`, locale)}</bdi>
                    </span>
                    <span className="min-w-0 break-words [overflow-wrap:anywhere]">
                      <Link href={`/pharmacy/purchasing/${LINKS[r.entity]}/${r.recordId}`} className="inline-flex min-h-11 items-center underline underline-offset-2 print:no-underline">
                        {r.ref ? <bdi dir="ltr">{r.ref}</bdi> : t(`pharmacy.purchasing.m.st.kind.${r.kind}`)}
                      </Link>
                    </span>
                    <span>{t(`pharmacy.purchasing.m.st.kind.${r.kind}`)}</span>
                    <span className="md:text-end">{r.amountMinor !== undefined && <Amount amount={r.amountMinor} currency={currency} locale={locale} />}</span>
                    <span className="md:text-end">{r.balanceMinor !== undefined && <Amount amount={r.balanceMinor} currency={currency} locale={locale} className="font-medium" />}</span>
                  </li>
                ))}
              </ol>
            )}
          </>
        )}
      </div>
    </>
  );
}
