import { CircleAlert, CircleCheck } from 'lucide-react';
import type { ReactNode } from 'react';
import type { Translate } from '@/lib/i18n';
import type { DiscountsReport, ReturnsReport, SalesReport } from '@/server/pharmacy/reports';
import type { MarginReport } from '@/server/pharmacy/reports-margin';
import type { ReportLabels } from '@/server/pharmacy/report-labels';
import { Day, Figures, Money, Name, Num, Pct, Section, Tbl } from './reports-parts';
import type { Currency } from './reports-logic';

/**
 * The sales-side reports as screens (phase 6, task 6): sales, returns, discounts and margin. Totals come first, per currency (never
 * added across currencies), then the breakdowns, then the rows. Every id is shown as a name from `labels`; a gated key that is
 * absent is not drawn (no blank cell).
 */

export interface ViewCtx {
  t: Translate;
  locale: string;
}
type Data<T> = T & { labels: ReportLabels };

const key = (k: string) => `pharmacy.reports.${k}`;
const name = (map: Record<string, string>, id: string, t: Translate, missing = 'unknown'): ReactNode => (map[id] ? <Name>{map[id]}</Name> : <span className="text-muted">{t(key(missing))}</span>);
const hint = (t: Translate) => t('pharmacy.reports.table.scroll');

function CurrencyFigures({ currency, children }: { currency: Currency; children: ReactNode }) {
  return (
    <div data-testid={`totals-${currency}`} className="flex min-w-0 flex-col gap-3 rounded-md border border-line p-3 sm:p-4">
      <h3 className="text-sm font-semibold text-text">
        <bdi dir="ltr">{currency}</bdi>
      </h3>
      {children}
    </div>
  );
}

const METHODS = ['CASH', 'CARD_MANUAL', 'TRANSFER_MANUAL'] as const;

// Sales ----------------------------------------------------------------------------------------------------------------------

export function SalesView({ r, ctx }: { r: Data<SalesReport>; ctx: ViewCtx }) {
  const { t } = ctx;
  const none = t(key('noValue'));
  const rowName = (k: string): ReactNode => {
    switch (r.groupBy) {
      case 'day':
        return <Day day={k} />;
      case 'branch':
        return name(r.labels.branch, k, t, 'otherBranch');
      case 'user':
        return name(r.labels.user, k, t);
      case 'method':
        return t(key(`method.${k}`));
      case 'product':
        return name(r.labels.product, k, t);
      case 'category':
        return k === '' ? t(key('uncategorised')) : name(r.labels.category, k, t);
    }
  };
  const productLevel = r.groupBy === 'product' || r.groupBy === 'category';
  const cols = [
    { h: t(key(`group.${r.groupBy}`)) },
    { h: t(key('col.count')), num: true },
    ...(productLevel ? [{ h: t(key('col.qty')), num: true }] : []),
    { h: t(key('col.gross')), num: true },
    { h: t(key('col.discount')), num: true },
    ...(productLevel || r.groupBy === 'method' ? [] : [{ h: t(key('col.rounding')), num: true }]),
    { h: t(key('col.sales')), num: true },
    { h: t(key('col.refunds')), num: true },
    { h: t(key('col.net')), num: true },
    { h: t(key('col.avgTicket')), num: true },
  ];
  return (
    <>
      <Section title={t(key('totals'))} hint={t(key('sales.returnsNote'))} testid="report-totals">
        {r.totals.map((x) => (
          <CurrencyFigures key={x.currency} currency={x.currency}>
            <Figures
              items={[
                { label: t(key('col.net')), value: <Money minor={x.netMinor} currency={x.currency} testid={`net-${x.currency}`} />, strong: true },
                { label: t(key('col.sales')), value: <Money minor={x.salesMinor} currency={x.currency} testid={`sales-${x.currency}`} /> },
                { label: t(key('col.refunds')), value: <Money minor={x.refundsMinor} currency={x.currency} testid={`refunds-${x.currency}`} /> },
                { label: t(key('col.count')), value: <Num value={x.count} testid={`count-${x.currency}`} /> },
                { label: t(key('col.gross')), value: <Money minor={x.grossMinor} currency={x.currency} /> },
                { label: t(key('col.discount')), value: <Money minor={x.discountMinor} currency={x.currency} /> },
                { label: t(key('col.rounding')), value: <Money minor={x.roundingMinor} currency={x.currency} /> },
                { label: t(key('col.avgTicket')), value: x.avgTicketMinor === null ? none : <Money minor={x.avgTicketMinor} currency={x.currency} /> },
              ]}
            />
          </CurrencyFigures>
        ))}
      </Section>
      {r.byBranch.length > 1 && (
        <Section title={t(key('byBranch'))}>
          <Tbl
            testid="sales-by-branch"
            scrollHint={hint(t)}
            caption={t(key('byBranch'))}
            cols={[{ h: t(key('col.branch')) }, { h: t(key('col.count')), num: true }, { h: t(key('col.sales')), num: true }, { h: t(key('col.refunds')), num: true }, { h: t(key('col.net')), num: true }]}
            rows={r.byBranch.map((b) => [name(r.labels.branch, b.branchId, t, 'otherBranch'), <Num key="n" value={b.count} />, <Money key="s" minor={b.salesMinor} currency={b.currency} />, <Money key="r" minor={b.refundsMinor} currency={b.currency} />, <Money key="x" minor={b.netMinor} currency={b.currency} />])}
          />
        </Section>
      )}
      {r.payments.length > 0 && (
        <Section title={t(key('payments'))} hint={t(key('sales.paymentsNote'))}>
          <Tbl
            testid="sales-payments"
            scrollHint={hint(t)}
            caption={t(key('payments'))}
            cols={[{ h: t(key('col.method')) }, { h: t(key('col.currency')) }, { h: t(key('col.count')), num: true }, { h: t(key('col.amount')), num: true }]}
            rows={r.payments.map((p) => [t(key(`method.${p.method}`)), <bdi key="c" dir="ltr">{p.currency}</bdi>, <Num key="n" value={p.count} />, <Money key="a" minor={p.amountMinor} currency={p.currency} />])}
          />
        </Section>
      )}
      <Section title={t(key(`group.${r.groupBy}.title`))}>
        <Tbl
          testid="report-rows"
          scrollHint={hint(t)}
          caption={t(key(`group.${r.groupBy}.title`))}
          cols={[...cols.slice(0, 1), { h: t(key('col.currency')) }, ...cols.slice(1)]}
          rows={r.rows.map((x) => [
            rowName(x.key),
            <bdi key="cur" dir="ltr">{x.currency}</bdi>,
            <Num key="n" value={x.count} />,
            ...(productLevel ? [<Num key="q" value={x.qty ?? 0} />] : []),
            <Money key="g" minor={x.grossMinor} currency={x.currency} />,
            <Money key="d" minor={x.discountMinor} currency={x.currency} />,
            ...(productLevel || r.groupBy === 'method' ? [] : [<Money key="rd" minor={x.roundingMinor ?? '0'} currency={x.currency} />]),
            <Money key="s" minor={x.salesMinor} currency={x.currency} />,
            <Money key="rf" minor={x.refundsMinor} currency={x.currency} />,
            <Money key="net" minor={x.netMinor} currency={x.currency} />,
            x.avgTicketMinor === null ? none : <Money key="a" minor={x.avgTicketMinor} currency={x.currency} />,
          ])}
        />
        {productLevel && <p className="text-sm text-muted">{t(key('sales.productNote'))}</p>}
        {r.groupBy === 'method' && <p className="text-sm text-muted">{t(key('sales.methodNote'))}</p>}
      </Section>
    </>
  );
}

// Returns --------------------------------------------------------------------------------------------------------------------

export function ReturnsView({ r, ctx, date }: { r: Data<ReturnsReport>; ctx: ViewCtx; date: (iso: string) => string }) {
  const { t } = ctx;
  return (
    <>
      <Section title={t(key('totals'))} testid="report-totals">
        <Figures
          items={r.totals.flatMap((x) => [
            { label: `${t(key('col.refund'))} (${x.currency})`, value: <Money minor={x.refundMinor} currency={x.currency} testid={`refund-${x.currency}`} />, strong: true },
            { label: `${t(key('col.count'))} (${x.currency})`, value: <Num value={x.count} testid={`count-${x.currency}`} /> },
          ])}
        />
      </Section>
      {r.byBranch.length > 1 && (
        <Section title={t(key('byBranch'))}>
          <Tbl
            scrollHint={hint(t)}
            caption={t(key('byBranch'))}
            cols={[{ h: t(key('col.branch')) }, { h: t(key('col.count')), num: true }, { h: t(key('col.refund')), num: true }]}
            rows={r.byBranch.map((b) => [name(r.labels.branch, b.branchId, t, 'otherBranch'), <Num key="n" value={b.count} />, <Money key="m" minor={b.refundMinor} currency={b.currency} />])}
          />
        </Section>
      )}
      {r.byReason.length > 0 && (
        <Section title={t(key('returns.byReason'))}>
          <Tbl scrollHint={hint(t)} caption={t(key('returns.byReason'))} cols={[{ h: t(key('col.reason')) }, { h: t(key('col.count')), num: true }]} rows={r.byReason.map((x) => [<Name key="r">{x.reason}</Name>, <Num key="n" value={x.count} />])} />
        </Section>
      )}
      {r.byMethod.length > 0 && (
        <Section title={t(key('returns.byMethod'))}>
          <Tbl
            scrollHint={hint(t)}
            caption={t(key('returns.byMethod'))}
            cols={[{ h: t(key('col.method')) }, { h: t(key('col.count')), num: true }, { h: t(key('col.refund')), num: true }]}
            rows={r.byMethod.map((x) => [t(key(`method.${x.method}`)), <Num key="n" value={x.count} />, <Money key="m" minor={x.refundMinor} currency={x.currency} />])}
          />
        </Section>
      )}
      <Section title={t(key('returns.rows'))}>
        <Tbl
          testid="report-rows"
          scrollHint={hint(t)}
          caption={t(key('returns.rows'))}
          cols={[{ h: t(key('col.number')) }, { h: t(key('col.sale')) }, { h: t(key('col.date')) }, { h: t(key('col.branch')) }, { h: t(key('col.reason')) }, { h: t(key('col.approvedBy')) }, { h: t(key('col.method')) }, { h: t(key('col.refund')), num: true }]}
          rows={r.rows.map((x) => [
            <bdi key="n" dir="ltr">{x.number ?? '-'}</bdi>,
            <bdi key="s" dir="ltr">{x.saleNumber ?? '-'}</bdi>,
            <bdi key="d" dir="ltr">{date(x.createdAt)}</bdi>,
            name(r.labels.branch, x.branchId, t, 'otherBranch'),
            <Name key="r">{x.reason}</Name>,
            x.approverName ? <Name key="a">{x.approverName}</Name> : t(key('unknown')),
            t(key(`method.${x.method}`)),
            <Money key="m" minor={x.refundMinor} currency={x.currency} />,
          ])}
        />
      </Section>
    </>
  );
}

// Discounts ------------------------------------------------------------------------------------------------------------------

export function DiscountsView({ r, ctx, date }: { r: Data<DiscountsReport>; ctx: ViewCtx; date: (iso: string) => string }) {
  const { t } = ctx;
  const none = t(key('noValue'));
  return (
    <>
      <Section title={t(key('totals'))} testid="report-totals" hint={r.maxDiscountPercent === null ? undefined : t(key('discounts.limit'), { percent: String(r.maxDiscountPercent) })}>
        {r.totals.map((x) => (
          <CurrencyFigures key={x.currency} currency={x.currency}>
            <Figures
              items={[
                { label: t(key('col.discount')), value: <Money minor={x.discountMinor} currency={x.currency} testid={`discount-${x.currency}`} />, strong: true },
                { label: t(key('col.percent')), value: <Pct bp={x.discountBp} none={none} /> },
                { label: t(key('col.gross')), value: <Money minor={x.grossMinor} currency={x.currency} /> },
                { label: t(key('discounts.discountedCount')), value: <Num value={x.discountedCount} testid={`discounted-${x.currency}`} /> },
                { label: t(key('discounts.salesCount')), value: <Num value={x.salesCount} /> },
              ]}
            />
          </CurrencyFigures>
        ))}
      </Section>
      {r.byBranch.length > 1 && (
        <Section title={t(key('byBranch'))}>
          <Tbl
            scrollHint={hint(t)}
            caption={t(key('byBranch'))}
            cols={[{ h: t(key('col.branch')) }, { h: t(key('discounts.discountedCount')), num: true }, { h: t(key('col.discount')), num: true }, { h: t(key('col.percent')), num: true }]}
            rows={r.byBranch.map((b) => [name(r.labels.branch, b.branchId, t, 'otherBranch'), <Num key="n" value={b.discountedCount} />, <Money key="m" minor={b.discountMinor} currency={b.currency} />, <Pct key="p" bp={b.discountBp} none={none} />])}
          />
        </Section>
      )}
      {r.topUsers.length > 0 && (
        <Section title={t(key('discounts.topUsers'))}>
          <Tbl
            scrollHint={hint(t)}
            caption={t(key('discounts.topUsers'))}
            cols={[{ h: t(key('col.seller')) }, { h: t(key('discounts.discountedCount')), num: true }, { h: t(key('col.discount')), num: true }, { h: t(key('col.percent')), num: true }]}
            rows={r.topUsers.map((u) => [u.userName ? <Name key="u">{u.userName}</Name> : t(key('unknown')), <Num key="n" value={u.discountedCount} />, <Money key="m" minor={u.discountMinor} currency={u.currency} />, <Pct key="p" bp={u.discountBp} none={none} />])}
          />
        </Section>
      )}
      <Section title={t(key('discounts.rows'))}>
        <Tbl
          testid="report-rows"
          scrollHint={hint(t)}
          caption={t(key('discounts.rows'))}
          cols={[{ h: t(key('col.number')) }, { h: t(key('col.date')) }, { h: t(key('col.branch')) }, { h: t(key('col.seller')) }, { h: t(key('col.gross')), num: true }, { h: t(key('col.discount')), num: true }, { h: t(key('col.percent')), num: true }, { h: t(key('discounts.limitCol')) }]}
          rows={r.rows.map((x) => [
            <bdi key="n" dir="ltr">{x.number ?? '-'}</bdi>,
            <bdi key="d" dir="ltr">{date(x.completedAt)}</bdi>,
            name(r.labels.branch, x.branchId, t, 'otherBranch'),
            name(r.labels.user, x.soldById, t),
            <Money key="g" minor={x.grossMinor} currency={x.currency} />,
            <Money key="m" minor={x.discountMinor} currency={x.currency} />,
            <Pct key="p" bp={x.discountBp} none={none} />,
            x.overLimit ? (
              <span key="o" className="inline-flex items-center gap-1.5 font-medium">
                <CircleAlert aria-hidden className="size-3.5 shrink-0" />
                {t(key('discounts.over'))}
              </span>
            ) : (
              <span key="o" className="inline-flex items-center gap-1.5 text-muted">
                <CircleCheck aria-hidden className="size-3.5 shrink-0" />
                {t(key('discounts.within'))}
              </span>
            ),
          ])}
        />
      </Section>
    </>
  );
}

// Margin ---------------------------------------------------------------------------------------------------------------------

export function MarginView({ r, ctx }: { r: Data<MarginReport>; ctx: ViewCtx }) {
  const { t } = ctx;
  const none = t(key('margin.noSales'));
  const rowName = (k: string): ReactNode => (r.groupBy === 'day' ? <Day day={k} /> : r.groupBy === 'branch' ? name(r.labels.branch, k, t, 'otherBranch') : r.groupBy === 'product' ? name(r.labels.product, k, t) : k === '' ? t(key('uncategorised')) : name(r.labels.category, k, t));
  return (
    <>
      <Section title={t(key('totals'))} testid="report-totals">
        {r.totals.map((x) => (
          <CurrencyFigures key={x.currency} currency={x.currency}>
            <Figures
              items={[
                { label: `${t(key('col.margin'))} (${t(key('estimated'))})`, value: <Money minor={x.marginMinor} currency={x.currency} testid={`margin-${x.currency}`} />, strong: true },
                { label: `${t(key('col.marginPct'))} (${t(key('estimated'))})`, value: <Pct bp={x.marginBp} none={none} /> },
                { label: t(key('col.net')), value: <Money minor={x.netMinor} currency={x.currency} /> },
                { label: t(key('col.cost')), value: <Money minor={x.costMinor} currency={x.currency} /> },
              ]}
            />
          </CurrencyFigures>
        ))}
        {r.excluded.length > 0 && (
          <Figures items={r.excluded.map((e) => ({ label: `${t(key('margin.excluded'))} (${e.currency})`, value: <Money minor={e.netMinor} currency={e.currency} testid={`excluded-${e.currency}`} /> }))} />
        )}
      </Section>
      {r.byBranch.length > 1 && (
        <Section title={t(key('byBranch'))}>
          <Tbl
            scrollHint={hint(t)}
            caption={t(key('byBranch'))}
            cols={[{ h: t(key('col.branch')) }, { h: t(key('col.net')), num: true }, { h: t(key('col.margin')), num: true }, { h: t(key('col.marginPct')), num: true }, { h: t(key('margin.leftOut')), num: true }]}
            rows={r.byBranch.map((b) => [
              name(r.labels.branch, b.branchId, t, 'otherBranch'),
              <Money key="n" minor={b.netMinor} currency={b.currency} />,
              <Money key="m" minor={b.marginMinor} currency={b.currency} />,
              <Pct key="p" bp={b.marginBp} none={none} />,
              <Num key="l" value={b.incompleteCostRows + b.mixedCurrencyRows} />,
            ])}
          />
        </Section>
      )}
      <Section title={t(key(`group.${r.groupBy}.title`))}>
        <Tbl
          testid="report-rows"
          scrollHint={hint(t)}
          caption={t(key(`group.${r.groupBy}.title`))}
          cols={[{ h: t(key(`group.${r.groupBy}`)) }, { h: t(key('col.currency')) }, { h: t(key('col.net')), num: true }, { h: t(key('col.cost')), num: true }, { h: t(key('col.margin')), num: true }, { h: t(key('col.marginPct')), num: true }]}
          rows={r.rows.map((x) => [rowName(x.key), <bdi key="c" dir="ltr">{x.currency}</bdi>, <Money key="n" minor={x.netMinor} currency={x.currency} />, <Money key="co" minor={x.costMinor} currency={x.currency} />, <Money key="m" minor={x.marginMinor} currency={x.currency} />, <Pct key="p" bp={x.marginBp} none={none} />])}
        />
      </Section>
    </>
  );
}

export { METHODS };
