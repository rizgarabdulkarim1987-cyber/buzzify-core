'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { readProductHistory } from '@/app/pharmacy/_actions/entry';
import type { ProductHistory as History } from '@/server/pharmacy/fast-entry';
import { useLocale, useT } from '@/studio/i18n';
import { phDate } from '../ph-date';
import { formatMinor, type Currency } from '../sell-logic';
import { Num } from '../sell-parts';

type Loaded = { productId: string; data: History | null };

const money = (minor: string | null | undefined, currency: Currency | null | undefined) => (minor && currency ? <Num>{`${formatMinor(BigInt(minor), currency)} ${currency}`}</Num> : '-');
/** 'MM/YYYY' for a month expiry, 'DD/MM/YYYY' for a day one (as the entered-now list shows it). */
const expiryText = (date: string, precision: 'DAY' | 'MONTH') => {
  const [y, m, d] = date.slice(0, 10).split('-');
  return precision === 'MONTH' ? `${m}/${y}` : `${d}/${m}/${y}`;
};

/**
 * The scanned product's history under the form (the prototype's three tables): purchases, sales and returns in this branch,
 * newest first (`ph.stock.history`). A purchase's price shows only for `cost.view`; the server leaves it out for anyone else.
 * A new product has no history yet, and the tables say so.
 */
export function ProductHistory({ productId, canSeeCost }: { productId: string | null; canSeeCost: boolean }) {
  const t = useT();
  const { locale } = useLocale();
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  useEffect(() => {
    if (!productId) return;
    let live = true;
    readProductHistory({ productId })
      .then((res) => live && setLoaded({ productId, data: res.ok ? res.data : null }))
      .catch(() => live && setLoaded({ productId, data: null }));
    return () => {
      live = false;
    };
  }, [productId]);

  const current = productId && loaded?.productId === productId ? loaded : null;
  const state: 'new' | 'loading' | 'failed' | 'ready' = !productId ? 'new' : !current ? 'loading' : current.data ? 'ready' : 'failed';
  const data = current?.data ?? null;
  const date = (iso: string) => <Num>{phDate(iso, locale)}</Num>;

  const table = (testId: string, title: string, head: string[], rows: ReactNode[][] | null, empty: string) => (
    <section data-testid={testId} className="flex min-w-0 flex-col gap-1.5">
      <h3 className="text-sm font-semibold text-ph-muted">{title}</h3>
      {rows && rows.length > 0 ? (
        <div className="min-w-0 overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr>
                {head.map((h) => (
                  <th key={h} scope="col" className="bg-ph-canvas px-1.5 py-1 text-start font-semibold text-ph-muted">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((cells, i) => (
                <tr key={i}>
                  {cells.map((c, j) => (
                    <td key={j} className="whitespace-nowrap border-t border-ph-line px-1.5 py-1 tabular-nums" dir="auto">
                      {c}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="px-2 py-3 text-center text-xs text-ph-muted">{empty}</p>
      )}
    </section>
  );

  const waiting = state === 'loading' ? t('pharmacy.entry.history.loading') : state === 'failed' ? t('pharmacy.entry.history.failed') : t('pharmacy.entry.history.none');
  const col = (k: string) => t(`pharmacy.entry.history.col.${k}`);
  const purchases = data?.purchases.map((p) => [
    date(p.receivedOn),
    p.supplierName || '-',
    <Num key="q">{`${p.qty}${p.bonusQty > 0 ? ` + ${p.bonusQty}` : ''} ${p.unitLabel}`}</Num>,
    ...(canSeeCost ? [money(p.unitCostMinor, p.currency)] : []),
    <Num key="e">{expiryText(p.expiryDate, p.expiryPrecision)}</Num>,
  ]);
  const sales = data?.sales.map((s) => [date(s.soldAt), s.unitLabel, <Num key="q">{s.qty}</Num>, money(s.unitPriceMinor, s.currency)]);
  const returns = data?.returns.map((r) => [date(r.returnedAt), r.unitLabel, <Num key="q">{r.qty ?? r.baseQty}</Num>, money(r.refundMinor, r.currency), r.reason || '-']);

  return (
    <section data-testid="entry-history" aria-label={t('pharmacy.entry.history.title')} className="flex min-w-0 flex-col gap-2 rounded-ph-2xl border border-ph-line bg-ph-card p-3">
      <h2 className="text-sm font-semibold text-ph-muted">{t('pharmacy.entry.history.title')}</h2>
      <div className="grid min-w-0 gap-3 2xl:grid-cols-3">
        {table(
          'history-purchases',
          t('pharmacy.entry.history.purchases'),
          [col('date'), col('supplier'), col('qty'), ...(canSeeCost ? [col('price')] : []), col('expiry')],
          purchases ?? null,
          state === 'new' ? t('pharmacy.entry.history.newProduct') : waiting,
        )}
        {table('history-sales', t('pharmacy.entry.history.sales'), [col('date'), col('unit'), col('qty'), col('price')], sales ?? null, state === 'new' ? t('pharmacy.entry.history.none') : waiting)}
        {table('history-returns', t('pharmacy.entry.history.returns'), [col('date'), col('unit'), col('qty'), col('price'), col('reason')], returns ?? null, state === 'new' ? t('pharmacy.entry.history.none') : waiting)}
      </div>
    </section>
  );
}
