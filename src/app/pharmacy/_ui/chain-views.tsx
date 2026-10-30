import Link from 'next/link';
import type { ReactNode } from 'react';
import type { Translate } from '@/lib/i18n';
import type { BranchCard, ChainDashboard, ChainTotal } from '@/server/pharmacy/chain';
import { Figures, Money, Name, NoticeLine, Num, Pct, Section, Tbl } from './reports-parts';
import { countParams, listParts, reportHref, specOf, type ChainFilters, type ReportId } from './reports-logic';

/**
 * The chain dashboard as a screen (phase 6, task 6; R6-8): the total card and one card per branch, a branch comparison ranked by net
 * sales per currency, and a sentence saying whose branches the total is the total of. Every figure links to the report that
 * answers it, with the same period and currency. Margin and values exist only for people who hold the permissions: absent, never
 * zero. A transfer on the road counts once in the total and twice over the cards (outgoing at the sender, incoming at the receiver).
 */

const key = (k: string) => `pharmacy.chain.${k}`;
const rkey = (k: string) => `pharmacy.reports.${k}`;

function linkTo(id: ReportId, f: ChainFilters, branchId: string | null): string {
  const spec = specOf(id);
  return reportHref(spec, { from: f.from, to: f.to, branchId, currency: spec.currency ? f.currency : null, groupBy: spec.groups?.[0] ?? null, status: null, pages: 1 });
}

function A({ href, children, testid }: { href: string; children: ReactNode; testid?: string }) {
  return (
    <Link href={href} data-testid={testid} className="inline-flex min-h-11 items-center underline underline-offset-2">
      {children}
    </Link>
  );
}

type Card = BranchCard | ChainTotal;
const isBranch = (c: Card): c is BranchCard => 'branchId' in c;

function CardView({ card, title, f, t, testid }: { card: Card; title: ReactNode; f: ChainFilters; t: Translate; testid: string }) {
  const branchId = isBranch(card) ? card.branchId : null;
  const none = t(rkey('noValue'));
  const items: Array<{ label: string; value: ReactNode; strong?: boolean; testid?: string }> = [];
  for (const s of card.sales) {
    items.push({
      label: `${t(rkey('col.net'))} (${s.currency})`,
      value: (
        <A href={linkTo('sales', f, branchId)}>
          <Money minor={s.netMinor} currency={s.currency} />
        </A>
      ),
      strong: true,
      testid: `net-${s.currency}`,
    });
    items.push({
      label: `${t(rkey('col.count'))} (${s.currency})`,
      value: (
        <A href={linkTo('sales', f, branchId)}>
          <Num value={s.count} />
        </A>
      ),
    });
  }
  if (card.sales.length === 0) items.push({ label: t(rkey('col.net')), value: <span className="text-muted">{t(key('noSales'))}</span> });
  for (const m of card.margin ?? []) {
    items.push({
      label: `${t(rkey('col.margin'))} (${m.currency}, ${t(rkey('estimated'))})`,
      value: (
        <A href={linkTo('margin', f, branchId)}>
          <Money minor={m.marginMinor} currency={m.currency} /> <Pct bp={m.marginBp} none={none} />
        </A>
      ),
    });
    if (m.incompleteCostRows + m.mixedCurrencyRows > 0) {
      items.push({
        label: `${t(rkey('margin.leftOut'))} (${m.currency})`,
        value: (
          <A href={linkTo('margin', f, branchId)}>
            <Num value={m.incompleteCostRows + m.mixedCurrencyRows} />
          </A>
        ),
      });
    }
  }
  items.push({
    label: t(key('stock')),
    value: (
      <A href={linkTo('stockValuation', f, branchId)}>
        <Num value={card.stock.available} />
      </A>
    ),
  });
  for (const v of card.stock.values ?? []) {
    items.push({
      label: `${t(rkey('valuation.value'))} (${v.currency})`,
      value: (
        <A href={linkTo('stockValuation', f, branchId)}>
          <Money minor={v.valueMinor} currency={v.currency} />
        </A>
      ),
    });
  }
  items.push({
    label: t(key('expired')),
    value: (
      <A href={linkTo('expiry', f, branchId)}>
        <Num value={card.expiry.expired.units} />
      </A>
    ),
  });
  items.push({
    label: t(key('expiring30')),
    value: (
      <A href={linkTo('expiry', f, branchId)}>
        <Num value={card.expiry.d30.units} />
      </A>
    ),
  });
  items.push({
    label: t(key('lowStock')),
    value: (
      <A href={linkTo('lowStock', f, branchId)}>
        <Num value={card.lowStock} />
      </A>
    ),
  });
  if (isBranch(card)) {
    items.push({
      label: t(key('transitIn')),
      value: (
        <A href={linkTo('transfers', f, card.branchId)}>
          <Num value={card.transit.incoming.units} />
        </A>
      ),
    });
    items.push({
      label: t(key('transitOut')),
      value: (
        <A href={linkTo('transfers', f, card.branchId)}>
          <Num value={card.transit.outgoing.units} />
        </A>
      ),
    });
    items.push({
      label: t(key('openIn')),
      value: (
        <A href={linkTo('transfers', f, card.branchId)}>
          {t(key('openCounts'), { requested: String(card.openTransfers.incoming.requested), sent: String(card.openTransfers.incoming.sent) })}
        </A>
      ),
    });
    items.push({
      label: t(key('openOut')),
      value: (
        <A href={linkTo('transfers', f, card.branchId)}>
          {t(key('openCounts'), { requested: String(card.openTransfers.outgoing.requested), sent: String(card.openTransfers.outgoing.sent) })}
        </A>
      ),
    });
  } else {
    items.push({
      label: t(key('transitTotal')),
      value: (
        <A href={linkTo('transfers', f, null)}>
          <Num value={card.transit.units} testid="transit-total" />
        </A>
      ),
    });
    items.push({
      label: t(key('openTotal')),
      value: (
        <A href={linkTo('transfers', f, null)}>
          {t(key('openCounts'), { requested: String(card.openTransfers.requested), sent: String(card.openTransfers.sent) })}
        </A>
      ),
    });
  }
  return (
    <article data-testid={testid} aria-labelledby={`${testid}-h`} className="flex min-w-0 flex-col gap-3 rounded-md border border-line bg-surface p-3 sm:p-4">
      <h3 id={`${testid}-h`} className="text-md font-semibold text-text">
        {title}
      </h3>
      <Figures items={items} />
      {card.stock.valuationComplete === false && <NoticeLine notice={{ key: 'valuation.incomplete', tone: 'warn', count: card.stock.noCostRows ?? 0 }} t={t} />}
    </article>
  );
}

export function ChainView({ d, f, t, locale }: { d: ChainDashboard; f: ChainFilters; t: Translate; locale: string }) {
  const hint = t(rkey('table.scroll'));
  const branchTitle = (id: string): ReactNode => <Name>{d.branches.find((b) => b.branchId === id)?.name ?? ''}</Name>;
  const withMargin = d.estimatedMargin === true;
  return (
    <>
      <p data-testid="chain-scope" className="max-w-[72ch] text-sm text-text">
        {t(key('scope'), countParams(d.branches.length))}{' '}
        {listParts(d.branches.map((b) => b.name), locale).map((part, i) => (part.kind === 'item' ? <Name key={i}>{part.value}</Name> : <span key={i}>{part.value}</span>))}
      </p>
      <div className="flex flex-col gap-2" data-testid="report-notices">
        <NoticeLine notice={{ key: 'chain.transit', tone: 'info' }} t={t} />
        {withMargin && <NoticeLine notice={{ key: 'margin.estimated', tone: 'info' }} t={t} />}
      </div>
      <Section title={t(key('total'))} testid="chain-total">
        <CardView card={d.total} title={t(key('totalTitle'))} f={f} t={t} testid="chain-card-total" />
      </Section>
      <Section title={t(key('branches'))}>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {d.branches.map((b) => (
            <CardView key={b.branchId} card={b} title={<Name>{b.name}</Name>} f={f} t={t} testid={`chain-card-${b.branchId}`} />
          ))}
        </div>
      </Section>
      {d.comparison.map((c) => (
        <Section key={c.currency} title={`${t(key('compare'))} (${c.currency})`} hint={t(key('compareNote'))} testid={`chain-compare-${c.currency}`}>
          <Tbl
            scrollHint={hint}
            caption={`${t(key('compare'))} (${c.currency})`}
            cols={[
              { h: t(rkey('col.branch')) },
              { h: t(key('rank')), num: true },
              { h: t(rkey('col.count')), num: true },
              { h: t(rkey('col.net')), num: true },
              { h: t(rkey('col.discount')), num: true },
              { h: t(rkey('col.refunds')), num: true },
              ...(withMargin ? [{ h: t(rkey('col.marginPct')), num: true }] : []),
              ...(c.rows.some((r) => r.stockValueMinor !== undefined) ? [{ h: t(rkey('valuation.value')), num: true }] : []),
            ]}
            rows={c.rows.map((r) => [
              branchTitle(r.branchId),
              <Num key="rk" value={r.rank} />,
              <Num key="n" value={r.count} />,
              <Money key="net" minor={r.netMinor} currency={c.currency} />,
              <Money key="d" minor={r.discountMinor} currency={c.currency} />,
              <Money key="rf" minor={r.refundsMinor} currency={c.currency} />,
              ...(withMargin ? [<Pct key="m" bp={r.marginBp ?? null} none={t(rkey('margin.noSales'))} />] : []),
              ...(c.rows.some((x) => x.stockValueMinor !== undefined) ? [r.stockValueMinor === undefined ? <span key="sv" className="text-muted">{t(rkey('noValue'))}</span> : <Money key="sv" minor={r.stockValueMinor} currency={c.currency} />] : []),
            ])}
          />
        </Section>
      ))}
    </>
  );
}
