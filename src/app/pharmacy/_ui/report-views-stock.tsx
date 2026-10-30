import type { ReactNode } from 'react';
import type { Translate } from '@/lib/i18n';
import type { DamagedReport, TransfersReport } from '@/server/pharmacy/reports-ledger';
import type { ExpiryReport, LowStockReport, ValuationReport, ValueView } from '@/server/pharmacy/reports-stock';
import type { ReportLabels } from '@/server/pharmacy/report-labels';
import { Day, Figures, Money, Name, Num, Section, Tbl, Unavailable } from './reports-parts';
import { durationParts, type Currency } from './reports-logic';

/**
 * The stock-side reports as screens (phase 6, task 6): valuation, expiry, damaged, transfers and low stock. The cost keys exist
 * only with `cost.view`: a column or figure whose key is absent is not drawn at all (never blank, never zero).
 */

export interface StockCtx {
  t: Translate;
  /** A route to a transfer's own screen, when the person may open it. */
  transferHref: ((id: string) => string) | null;
}
type Data<T> = T & { labels: ReportLabels };

const key = (k: string) => `pharmacy.reports.${k}`;
const branchName = (labels: ReportLabels, id: string, t: Translate): ReactNode => (labels.branch[id] ? <Name>{labels.branch[id]}</Name> : <span className="text-muted">{t(key('otherBranch'))}</span>);
const hint = (t: Translate) => t('pharmacy.reports.table.scroll');
const values = (list: Array<{ currency: Currency }> | undefined, render: (v: never) => ReactNode): ReactNode => (list === undefined ? null : list.length === 0 ? '0' : list.map((v, i) => <span key={i} className="block">{render(v as never)}</span>));

/** The value and damaged value per currency of a valuation row, drawn one currency per line (never added). */
const valueCells = (v: ValueView[] | undefined) => (v === undefined ? null : v.length === 0 ? '0' : v.map((x) => <span key={x.currency} className="block"><Money minor={x.valueMinor} currency={x.currency} /></span>));

// Stock valuation ------------------------------------------------------------------------------------------------------------

export function ValuationView({ r, ctx }: { r: Data<ValuationReport>; ctx: StockCtx }) {
  const { t } = ctx;
  const withCost = r.totals.values !== undefined;
  const rowName = (row: ValuationReport['rows'][number]): ReactNode => (r.groupBy === 'branch' ? branchName(r.labels, row.key, t) : row.label ? <Name>{row.label}</Name> : r.groupBy === 'category' ? t(key('uncategorised')) : t(key('unknown')));
  return (
    <>
      <Section title={t(key('valuation.onHand'))} testid="report-totals">
        <Figures
          items={[
            { label: t(key('valuation.available')), value: <Num value={r.totals.available} testid="units-available" />, strong: true },
            { label: t(key('valuation.reserved.col')), value: <Num value={r.totals.reserved} testid="units-reserved" /> },
            { label: t(key('valuation.quarantine')), value: <Num value={r.totals.quarantine} testid="units-quarantine" /> },
            { label: t(key('valuation.damaged')), value: <Num value={r.totals.damaged} testid="units-damaged" /> },
          ]}
        />
        {withCost && (
          <Figures
            testid="valuation-values"
            items={(r.totals.values ?? []).flatMap((v) => [
              { label: `${t(key('valuation.value'))} (${v.currency})`, value: <Money minor={v.valueMinor} currency={v.currency} testid={`value-${v.currency}`} />, strong: true },
              { label: `${t(key('valuation.damagedValue'))} (${v.currency})`, value: <Money minor={v.damagedValueMinor} currency={v.currency} /> },
            ])}
          />
        )}
      </Section>
      <Section title={t(key('valuation.inTransit'))} hint={t(key('valuation.inTransitNote'))} testid="valuation-transit">
        <Figures
          items={[
            { label: t(key('col.units')), value: <Num value={r.inTransit.units} testid="transit-units" /> },
            { label: t(key('transfers.title')), value: <Num value={r.inTransit.transfers} /> },
            ...(r.inTransit.values ?? []).map((v) => ({ label: `${t(key('valuation.value'))} (${v.currency})`, value: <Money minor={v.valueMinor} currency={v.currency} /> })),
          ]}
        />
        {r.inTransit.byDestination.length > 0 && (
          <Tbl
            scrollHint={hint(t)}
            caption={t(key('valuation.byDestination'))}
            cols={[{ h: t(key('col.toBranch')) }, { h: t(key('col.units')), num: true }]}
            rows={r.inTransit.byDestination.map((d) => [d.branchId && r.labels.branch[d.branchId] ? <Name key="b">{r.labels.branch[d.branchId]}</Name> : t(key('otherBranch')), <Num key="u" value={d.units} />])}
          />
        )}
      </Section>
      {r.byBranch.length > 1 && (
        <Section title={t(key('byBranch'))}>
          <Tbl
            testid="valuation-by-branch"
            scrollHint={hint(t)}
            caption={t(key('byBranch'))}
            cols={[{ h: t(key('col.branch')) }, { h: t(key('valuation.available')), num: true }, { h: t(key('valuation.reserved.col')), num: true }, { h: t(key('valuation.quarantine')), num: true }, { h: t(key('valuation.damaged')), num: true }, ...(withCost ? [{ h: t(key('valuation.value')), num: true }] : [])]}
            rows={r.byBranch.map((b) => [branchName(r.labels, b.branchId, t), <Num key="a" value={b.available} />, <Num key="r" value={b.reserved} />, <Num key="q" value={b.quarantine} />, <Num key="d" value={b.damaged} />, ...(withCost ? [<span key="v">{valueCells(b.values)}</span>] : [])])}
          />
        </Section>
      )}
      <Section title={t(key(`valuation.group.${r.groupBy}`))}>
        <Tbl
          testid="report-rows"
          scrollHint={hint(t)}
          caption={t(key(`valuation.group.${r.groupBy}`))}
          cols={[{ h: t(key(`group.${r.groupBy}`)) }, { h: t(key('valuation.available')), num: true }, { h: t(key('valuation.reserved.col')), num: true }, { h: t(key('valuation.quarantine')), num: true }, { h: t(key('valuation.damaged')), num: true }, ...(withCost ? [{ h: t(key('valuation.value')), num: true }, { h: t(key('valuation.costMissing')), num: true }] : [])]}
          rows={r.rows.map((x) => [rowName(x), <Num key="a" value={x.available} />, <Num key="r" value={x.reserved} />, <Num key="q" value={x.quarantine} />, <Num key="d" value={x.damaged} />, ...(withCost ? [<span key="v">{valueCells(x.values)}</span>, <Num key="n" value={x.noCostRows ?? 0} />] : [])])}
        />
      </Section>
    </>
  );
}

// Expiry ---------------------------------------------------------------------------------------------------------------------

const BANDS = ['expired', 'd30', 'd60', 'd90'] as const;

export function ExpiryView({ r, ctx }: { r: Data<ExpiryReport>; ctx: StockCtx }) {
  const { t } = ctx;
  const withCost = r.totals.some((b) => b.values !== undefined);
  const bandCells = (b: ExpiryReport['totals'][number]): ReactNode[] => [<Num key="r" value={b.rows} />, <Num key="u" value={b.units} />, ...(withCost ? [<span key="v">{values(b.values, (v: { currency: Currency; valueMinor: string }) => <Money minor={v.valueMinor} currency={v.currency} />)}</span>] : [])];
  const cols = [{ h: t(key('expiry.band')) }, { h: t(key('expiry.stockRows')), num: true }, { h: t(key('col.units')), num: true }, ...(withCost ? [{ h: t(key('valuation.value')), num: true }] : [])];
  return (
    <>
      <Section title={t(key('expiry.bands'))} hint={t(key('expiry.bandsNote'))} testid="report-totals">
        <Tbl testid="expiry-bands" scrollHint={hint(t)} caption={t(key('expiry.bands'))} cols={cols} rows={BANDS.map((band) => [t(key(`expiry.band.${band}`)), ...bandCells(r.totals.find((b) => b.band === band) ?? { band, rows: 0, units: 0, ...(withCost ? { values: [] } : {}) })])} />
      </Section>
      {r.byBranch.length > 1 && (
        <Section title={t(key('byBranch'))}>
          <Tbl
            scrollHint={hint(t)}
            caption={t(key('byBranch'))}
            cols={[{ h: t(key('col.branch')) }, ...BANDS.map((b) => ({ h: t(key(`expiry.band.${b}`)), num: true }))]}
            rows={r.byBranch.map((b) => [branchName(r.labels, b.branchId, t), ...BANDS.map((band) => <Num key={band} value={b.bands.find((x) => x.band === band)?.units ?? 0} />)])}
          />
        </Section>
      )}
      {r.listTruncated ? (
        <p className="flex items-start gap-2.5 text-sm text-muted">
          <Unavailable t={t} />
          <span className="min-w-0">{t(key('expiry.noList'))}</span>
        </p>
      ) : (
        <Section title={t(key('expiry.rows'))}>
          <Tbl
            testid="report-rows"
            scrollHint={hint(t)}
            caption={t(key('expiry.rows'))}
            cols={[{ h: t(key('col.product')) }, { h: t(key('col.lot')) }, { h: t(key('col.expires')) }, { h: t(key('col.branch')) }, { h: t(key('col.units')), num: true }, { h: t(key('expiry.band')) }, { h: t(key('expiry.days')), num: true }]}
            rows={r.items.map((x) => [
              <Name key="p">{`${x.product.tradeName} ${x.product.strength}`.trim()}</Name>,
              <bdi key="l" dir="ltr">{x.batch.lot}</bdi>,
              <Day key="e" day={x.batch.expiryPrecision === 'MONTH' ? x.batch.expiryDate.slice(0, 7) : x.batch.expiryDate} />,
              branchName(r.labels, x.branchId, t),
              <Num key="u" value={x.buckets.available + x.buckets.reserved + x.buckets.quarantine} />,
              t(key(`expiry.band.${x.band}`)),
              <Num key="d" value={x.daysToExpiry} />,
            ])}
          />
        </Section>
      )}
    </>
  );
}

// Damaged and lost -----------------------------------------------------------------------------------------------------------

const MOVEMENT_TYPES = ['DAMAGE', 'ADJUST', 'SUPPLIER_RETURN'] as const;

export function DamagedView({ r, ctx }: { r: Data<DamagedReport>; ctx: StockCtx }) {
  const { t } = ctx;
  const cur = r.current.totals;
  return (
    <>
      <Section title={t(key('damaged.now'))} hint={t(key('damaged.nowNote'))} testid="report-totals">
        <Figures
          items={[
            { label: t(key('valuation.damaged')), value: <Num value={cur.damaged} testid="units-damaged" />, strong: true },
            { label: t(key('valuation.quarantine')), value: <Num value={cur.quarantine} testid="units-quarantine" /> },
            ...(cur.values ?? []).flatMap((v) => [
              { label: `${t(key('valuation.damagedValue'))} (${v.currency})`, value: <Money minor={v.damagedValueMinor} currency={v.currency} /> },
              { label: `${t(key('damaged.quarantineValue'))} (${v.currency})`, value: <Money minor={v.quarantineValueMinor} currency={v.currency} /> },
            ]),
          ]}
        />
        {r.current.byBranch.length > 1 && (
          <Tbl
            scrollHint={hint(t)}
            caption={t(key('byBranch'))}
            cols={[{ h: t(key('col.branch')) }, { h: t(key('valuation.damaged')), num: true }, { h: t(key('valuation.quarantine')), num: true }]}
            rows={r.current.byBranch.map((b) => [branchName(r.labels, b.branchId, t), <Num key="d" value={b.damaged} />, <Num key="q" value={b.quarantine} />])}
          />
        )}
      </Section>
      <Section title={t(key('damaged.movements'))} hint={t(key('damaged.movementsNote'))}>
        <Tbl
          testid="damaged-movements"
          scrollHint={hint(t)}
          caption={t(key('damaged.movements'))}
          cols={[{ h: t(key('col.type')) }, { h: t(key('col.units')), num: true }, ...(cur.values !== undefined ? [{ h: t(key('valuation.value')), num: true }, { h: t(key('valuation.costMissing')), num: true }] : [])]}
          rows={MOVEMENT_TYPES.map((type) => {
            const row = r.movements.totals.find((x) => x.type === type);
            return [t(key(`damaged.type.${type}`)), <Num key="u" value={row?.units ?? 0} />, ...(cur.values !== undefined ? [<span key="v">{values(row?.values ?? [], (v: { currency: Currency; valueMinor: string }) => <Money minor={v.valueMinor} currency={v.currency} />)}</span>, <Num key="n" value={row?.noCostRows ?? 0} />] : [])];
          })}
        />
        {r.movements.reasons.length > 0 && (
          <Tbl
            scrollHint={hint(t)}
            caption={t(key('damaged.reasons'))}
            cols={[{ h: t(key('col.type')) }, { h: t(key('col.reason')) }, { h: t(key('col.units')), num: true }]}
            rows={r.movements.reasons.map((x) => [t(key(`damaged.type.${x.type}`)), x.reason ? <Name key="r">{x.reason}</Name> : t(key('damaged.noReason')), <Num key="u" value={x.units} />])}
          />
        )}
      </Section>
      <Section title={t(key('damaged.transfers'))} hint={t(key('damaged.transfersNote'))}>
        <Figures
          items={[
            { label: t(key('transfers.lost')), value: <Num value={r.transfers.totals.lostQty} testid="transfer-lost" />, strong: true },
            { label: t(key('transfers.damagedQty')), value: <Num value={r.transfers.totals.damagedQty} testid="transfer-damaged" /> },
          ]}
        />
        {r.transfers.byRoute.length > 0 && (
          <Tbl
            scrollHint={hint(t)}
            caption={t(key('transfers.byRoute'))}
            cols={[{ h: t(key('col.fromBranch')) }, { h: t(key('col.toBranch')) }, { h: t(key('transfers.lost')), num: true }, { h: t(key('transfers.damagedQty')), num: true }]}
            rows={r.transfers.byRoute.map((x) => [branchName(r.labels, x.fromBranchId, t), branchName(r.labels, x.toBranchId, t), <Num key="l" value={x.lostQty} />, <Num key="d" value={x.damagedQty} />])}
          />
        )}
      </Section>
    </>
  );
}

// Transfers ------------------------------------------------------------------------------------------------------------------

const seconds = (s: number, t: Translate) => {
  const d = durationParts(s);
  return t(key(`transfers.${d.unit}`), { count: d.count, n: d.text });
};

export function TransfersView({ r, ctx, date }: { r: Data<TransfersReport>; ctx: StockCtx; date: (iso: string) => string }) {
  const { t } = ctx;
  return (
    <>
      <Section title={t(key('totals'))} testid="report-totals">
        <Figures
          items={[
            { label: t(key('transfers.total')), value: <Num value={r.total} testid="transfers-total" />, strong: true },
            { label: t(key('transfers.inTransit')), value: <Num value={r.inTransit.units} testid="transit-units" /> },
            { label: t(key('transfers.lost')), value: <Num value={r.lost.lostQty} testid="transfer-lost" /> },
            { label: t(key('transfers.damagedQty')), value: <Num value={r.lost.damagedQty} /> },
            { label: t(key('transfers.avgTransit')), value: r.avgTransitSeconds === null ? <span className="text-muted">{t(key('noValue'))}</span> : seconds(r.avgTransitSeconds, t) },
          ]}
        />
        <Tbl
          scrollHint={hint(t)}
          caption={t(key('transfers.byStatus'))}
          cols={[{ h: t(key('col.status')) }, { h: t(key('col.count')), num: true }]}
          rows={r.byStatus.map((s) => [t(`pharmacy.transfers.status.${s.status}`), <Num key="n" value={s.count} />])}
        />
      </Section>
      {r.byBranch.length > 1 && (
        <Section title={t(key('transfers.bySender'))}>
          <Tbl scrollHint={hint(t)} caption={t(key('transfers.bySender'))} cols={[{ h: t(key('col.fromBranch')) }, { h: t(key('col.count')), num: true }]} rows={r.byBranch.map((b) => [branchName(r.labels, b.branchId, t), <Num key="n" value={b.count} />])} />
        </Section>
      )}
      {r.byRoute.length > 0 && (
        <Section title={t(key('transfers.byRoute'))}>
          <Tbl
            scrollHint={hint(t)}
            caption={t(key('transfers.byRoute'))}
            cols={[{ h: t(key('col.fromBranch')) }, { h: t(key('col.toBranch')) }, { h: t(key('col.status')) }, { h: t(key('col.count')), num: true }]}
            rows={r.byRoute.map((x) => [branchName(r.labels, x.fromBranchId, t), branchName(r.labels, x.toBranchId, t), t(`pharmacy.transfers.status.${x.status}`), <Num key="n" value={x.count} />])}
          />
        </Section>
      )}
      <Section title={t(key('transfers.rows'))}>
        <Tbl
          testid="report-rows"
          scrollHint={hint(t)}
          caption={t(key('transfers.rows'))}
          cols={[{ h: t(key('col.number')) }, { h: t(key('col.fromBranch')) }, { h: t(key('col.toBranch')) }, { h: t(key('col.status')) }, { h: t(key('col.date')) }, { h: t(key('transfers.requested')), num: true }, { h: t(key('transfers.sent')), num: true }, { h: t(key('transfers.received')), num: true }, { h: t(key('transfers.lost')), num: true }, { h: t(key('transfers.damagedQty')), num: true }]}
          rows={r.rows.map((x) => [
            ctx.transferHref ? (
              <a key="n" href={ctx.transferHref(x.id)} className="inline-flex min-h-11 items-center underline underline-offset-2">
                <bdi dir="ltr">{x.number ?? '-'}</bdi>
              </a>
            ) : (
              <bdi key="n" dir="ltr">{x.number ?? '-'}</bdi>
            ),
            x.fromBranchName ? <Name key="f">{x.fromBranchName}</Name> : <span key="f" className="text-muted">{t(key('otherBranch'))}</span>,
            x.toBranchName ? <Name key="t">{x.toBranchName}</Name> : <span key="t" className="text-muted">{t(key('otherBranch'))}</span>,
            t(`pharmacy.transfers.status.${x.status}`),
            <bdi key="d" dir="ltr">{date(x.requestedAt)}</bdi>,
            <Num key="rq" value={x.requestedQty} />,
            <Num key="s" value={x.sentQty} />,
            <Num key="rc" value={x.receivedQty} />,
            <Num key="l" value={x.lostQty} />,
            <Num key="d2" value={x.damagedQty} />,
          ])}
        />
      </Section>
    </>
  );
}

// Low stock ------------------------------------------------------------------------------------------------------------------

export function LowStockView({ r, ctx }: { r: Data<LowStockReport>; ctx: StockCtx }) {
  const { t } = ctx;
  return (
    <>
      <Section title={t(key('totals'))} testid="report-totals" hint={t(key('lowStock.rule'))}>
        <Figures items={[{ label: t(key('lowStock.total')), value: <Num value={r.total} testid="low-total" />, strong: true }]} />
        {r.byBranch.length > 1 && (
          <Tbl scrollHint={hint(t)} caption={t(key('byBranch'))} cols={[{ h: t(key('col.branch')) }, { h: t(key('lowStock.total')), num: true }]} rows={r.byBranch.map((b) => [branchName(r.labels, b.branchId, t), <Num key="n" value={b.count} />])} />
        )}
      </Section>
      <Section title={t(key('lowStock.rows'))}>
        <Tbl
          testid="report-rows"
          scrollHint={hint(t)}
          caption={t(key('lowStock.rows'))}
          cols={[{ h: t(key('col.product')) }, { h: t(key('col.branch')) }, { h: t(key('lowStock.sellable')), num: true }, { h: t(key('lowStock.min')), num: true }, { h: t(key('lowStock.deficit')), num: true }, { h: t(key('lowStock.reorder')), num: true }]}
          rows={r.rows.map((x) => [<Name key="p">{`${x.tradeName} ${x.strength}`.trim()}</Name>, branchName(r.labels, x.branchId, t), <Num key="s" value={x.sellable} />, <Num key="m" value={x.minQty} />, <Num key="d" value={x.deficit} />, <Num key="r" value={x.reorderQty} />])}
        />
      </Section>
    </>
  );
}
