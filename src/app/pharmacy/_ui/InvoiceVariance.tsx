import { ArrowDownRight, ArrowUpRight, Equal, EyeOff, Scale, Slash } from 'lucide-react';
import type { ReactNode } from 'react';
import type { Translate } from '@/lib/i18n';
import type { Locale } from '@/lib/locale';
import type { InvoiceVariance as Variance } from '@/server/pharmacy/supplier-invoices';
import { Amount } from './money-status';

/** A signed difference in words and an icon: higher, lower or the same. Null is "not comparable". */
function Diff({ minor, currency, locale, t }: { minor: string | null; currency: 'IQD' | 'USD'; locale: Locale; t: Translate }): ReactNode {
  if (minor === null) {
    return (
      <span className="inline-flex items-center gap-1.5 text-muted">
        <Slash aria-hidden className="size-3.5 shrink-0" />
        {t('pharmacy.purchasing.m.var.na')}
      </span>
    );
  }
  const value = BigInt(minor);
  if (value === 0n) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <Equal aria-hidden className="size-3.5 shrink-0" />
        {t('pharmacy.purchasing.m.var.same')}
      </span>
    );
  }
  const up = value > 0n;
  return (
    <span className={`inline-flex items-center gap-1.5 font-medium ${up ? 'text-danger' : 'text-success'}`}>
      {up ? <ArrowUpRight aria-hidden className="size-3.5 shrink-0" /> : <ArrowDownRight aria-hidden className="size-3.5 shrink-0" />}
      {t(up ? 'pharmacy.purchasing.m.var.higher' : 'pharmacy.purchasing.m.var.lower')} <Amount amount={up ? value : -value} currency={currency} locale={locale} />
    </span>
  );
}

/**
 * What the invoice charged against what was ordered and what was received, per line (unit cost), then the net above and
 * below the cost booked on receipt. Positive and negative are words and arrows, never colour alone; a line whose order is
 * in another currency says it cannot be compared; a line of another branch shows only its invoiced cost.
 */
export function InvoiceVariance({ variance, t, locale }: { variance: Variance; t: Translate; locale: Locale }) {
  const c = variance.currency;
  return (
    <section aria-labelledby="inv-var" className="flex min-w-0 flex-col gap-3" data-testid="invoice-variance">
      <h2 id="inv-var" className="flex items-center gap-2 text-md font-semibold text-text">
        <Scale aria-hidden className="size-4 shrink-0" />
        {t('pharmacy.purchasing.m.var.title')}
      </h2>
      <p className="max-w-[72ch] text-sm text-muted">{t('pharmacy.purchasing.m.var.intro')}</p>
      <ul className="flex flex-col border-t border-line">
        {variance.lines.map((l) => {
          const otherCurrency = l.orderCurrency !== null && l.orderCurrency !== c;
          return (
            <li key={l.lineNo} data-testid="variance-line" className="flex min-w-0 flex-col gap-1.5 border-b border-line py-3 text-sm text-text">
              <p dir="auto" className="min-w-0 break-words font-medium [overflow-wrap:anywhere]">
                {l.productName} <span className="font-normal text-muted">· {l.unitLabel}</span>
              </p>
              {l.redacted ? (
                <p className="flex items-start gap-2 text-muted">
                  <EyeOff aria-hidden className="mt-px size-4 shrink-0" />
                  <span>
                    {t('pharmacy.purchasing.m.inv.otherBranch')} · {t('pharmacy.purchasing.m.var.invoiced')}: <Amount amount={l.invoicedUnitCostMinor} currency={c} locale={locale} />
                  </span>
                </p>
              ) : (
                <dl className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-3">
                  <div>
                    <dt className="text-muted">{t('pharmacy.purchasing.m.var.ordered')}</dt>
                    <dd>{l.orderedUnitCostMinor !== null && l.orderCurrency ? <Amount amount={l.orderedUnitCostMinor} currency={l.orderCurrency} locale={locale} /> : otherCurrency ? t('pharmacy.purchasing.m.var.otherCurrency') : t('pharmacy.purchasing.m.var.noOrder')}</dd>
                  </div>
                  <div>
                    <dt className="text-muted">{t('pharmacy.purchasing.m.var.received')}</dt>
                    <dd>{l.receivedUnitCostMinor !== null ? <Amount amount={l.receivedUnitCostMinor} currency={c} locale={locale} /> : '—'}</dd>
                  </div>
                  <div>
                    <dt className="text-muted">{t('pharmacy.purchasing.m.var.invoiced')}</dt>
                    <dd>
                      <Amount amount={l.invoicedUnitCostMinor} currency={c} locale={locale} />
                    </dd>
                  </div>
                  <div className="sm:col-span-3">
                    <p className="flex flex-wrap gap-x-6 gap-y-1">
                      <span>
                        <span className="text-muted">{t('pharmacy.purchasing.m.var.orderVsInvoiced')}: </span>
                        {otherCurrency ? <Diff minor={null} currency={c} locale={locale} t={t} /> : l.orderCurrency === null ? <span className="text-muted">—</span> : <Diff minor={l.orderVsInvoiced} currency={c} locale={locale} t={t} />}
                      </span>
                      <span>
                        <span className="text-muted">{t('pharmacy.purchasing.m.var.receivedVsInvoiced')}: </span>
                        <Diff minor={l.receivedVsInvoiced} currency={c} locale={locale} t={t} />
                      </span>
                    </p>
                  </div>
                </dl>
              )}
            </li>
          );
        })}
      </ul>
      <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5 text-sm text-text sm:max-w-md" data-testid="variance-totals">
        <dt className="text-muted">{t('pharmacy.purchasing.m.var.positive')}</dt>
        <dd className="text-end">
          <Amount amount={variance.positiveMinor} currency={c} locale={locale} />
        </dd>
        <dt className="text-muted">{t('pharmacy.purchasing.m.var.negative')}</dt>
        <dd className="text-end">
          <Amount amount={variance.negativeMinor} currency={c} locale={locale} />
        </dd>
        <dt className="font-semibold">{t('pharmacy.purchasing.m.var.net')}</dt>
        <dd className="text-end font-semibold">
          <Amount amount={variance.netMinor} currency={c} locale={locale} />
        </dd>
      </dl>
    </section>
  );
}
