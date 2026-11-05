'use client';

import { Info, Plus, ShieldAlert } from 'lucide-react';
import type { SellItem } from '@/server/pharmacy/sell-search';
import { useT } from '@/studio/i18n';
import { formatMinor, type Currency, type ScanItem } from '../sell-logic';
import { Chip, Note, Num, PH_PRIMARY } from '../sell-parts';
import { BatchMarks, SubButton } from './LinePanels';
import { stockBreakdown } from './panels-logic';
import { useProductInfo } from './use-product-info';

/** Why a shown item cannot go on the receipt, in the suggestion list's words; null when it can. */
const reasonOf = (item: ScanItem): string | null => (item.notSellable ? 'notSellable' : item.noPrice ? 'noPrice' : item.sellableQty <= 0 ? 'noStock' : null);

/**
 * Price inquiry (F7), under the scan field (layout A's `.inq`): a scanned or typed item is SHOWN here, never put on the receipt:
 * its price per unit of the ladder, its stock (in pieces and packs), its batches here nearest expiry first (expired marked) and its
 * substitutes by active ingredient (a press shows that one instead). "Add to receipt" is the only way from here to a receipt.
 * Cost is not shown (no role reads it here yet). No dialog, no motion.
 */
export function InquiryPanel({ item, currency, onAdd, onShow }: { item: ScanItem | null; currency: Currency; onAdd: (item: ScanItem) => void; onShow: (item: SellItem) => void }) {
  const t = useT();
  const state = useProductInfo(item?.productId ?? null, currency);
  const reason = item ? reasonOf(item) : null;
  const stock = item ? stockBreakdown(item.sellableQty, item.units) : null;
  return (
    <section className="flex min-w-0 flex-col gap-2.5 rounded-ph-2xl border-2 border-ph-g8 bg-ph-card p-3" aria-label={t('pharmacy.cashier.inquiry.region')} data-testid="inquiry-panel">
      <Note look="ph" icon={<Info aria-hidden />} tone="info" role="status" testId="inquiry-mode">
        {t('pharmacy.cashier.inquiry.mode')}
      </Note>
      {!item || !stock ? (
        <p className="px-1 py-2 text-sm text-ph-muted" data-testid="inquiry-empty">
          {t('pharmacy.cashier.inquiry.empty')}
        </p>
      ) : (
        <>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <b className="min-w-0 break-words text-base text-ph-text" dir="auto" data-testid="inquiry-name">
              {item.tradeName}
            </b>
            {item.rxLevel !== 'OTC' && (
              <Chip look="ph" icon={<ShieldAlert aria-hidden />} tone={item.rxLevel === 'RESTRICTED' ? 'danger' : 'plain'}>
                {t(item.rxLevel === 'RESTRICTED' ? 'pharmacy.cashier.sugg.mark.restricted' : 'pharmacy.cashier.sugg.mark.rx')}
              </Chip>
            )}
            <span className="flex-1" />
            {reason && <span className="text-sm text-ph-red">{t(`pharmacy.cashier.sugg.reason.${reason}`)}</span>}
            <button type="button" className={PH_PRIMARY} data-testid="inquiry-add" disabled={reason !== null} onClick={() => onAdd(item)}>
              <Plus aria-hidden className="size-4" />
              {t('pharmacy.cashier.inquiry.add')}
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {[...item.units]
              .sort((a, b) => a.baseQty - b.baseQty)
              .map((u) => (
                <div key={u.id} className="flex min-h-11 min-w-24 flex-col justify-center rounded-ph-xl border border-ph-line px-3 py-1 text-sm" data-testid="inquiry-price">
                  <span className="text-ph-muted">{u.label}</span>{' '}
                  <b className="tabular-nums text-ph-text">{u.priceMinor === null ? t('pharmacy.sell.chip.noPrice') : <><Num>{formatMinor(BigInt(u.priceMinor), currency)}</Num> {currency}</>}</b>
                </div>
              ))}
          </div>
          <p className="text-sm text-ph-text" data-testid="inquiry-stock">
            {t('pharmacy.cashier.inquiry.stock', { qty: stock.total, unit: stock.baseLabel })}
            {stock.pack && ' '}
            {stock.pack && (stock.pack.rest ? t('pharmacy.cashier.inquiry.stockPackRest', { packs: stock.pack.count, pack: stock.pack.label, rest: stock.pack.rest, unit: stock.baseLabel }) : t('pharmacy.cashier.inquiry.stockPack', { packs: stock.pack.count, pack: stock.pack.label }))}
          </p>
          {state.status === 'ready' && (
            <>
              <ul className="flex flex-wrap gap-1.5 text-sm" aria-label={t('pharmacy.cashier.panels.batches')}>
                {state.info.batches.map((b) => (
                  <li key={b.batchId} className={`inline-flex min-h-8 flex-wrap items-center gap-x-1.5 rounded-lg border px-2 ${b.expired ? 'border-transparent bg-ph-red-wash text-ph-red' : 'border-ph-line text-ph-text'}`} data-testid="inquiry-batch" data-expired={b.expired}>
                    <BatchMarks batch={b} /> · <bdi dir="auto">{b.lot}</bdi> · <Num>{b.available}</Num>
                  </li>
                ))}
              </ul>
              <div className="flex min-w-0 flex-col gap-1">
                <span className="text-sm font-semibold text-ph-text">{t('pharmacy.cashier.inquiry.subs')}</span>
                {state.info.substitutes.length === 0 ? (
                  <p className="text-sm text-ph-muted" data-testid="inquiry-subs-none">
                    {t('pharmacy.cashier.subs.none')}
                  </p>
                ) : (
                  <div className="grid gap-1 sm:grid-cols-2">
                    {state.info.substitutes.map((s) => (
                      <SubButton key={s.productId} item={s} currency={currency} testId="inquiry-sub" onPick={onShow} />
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
          {state.status === 'failed' && <p className="text-sm text-ph-red">{t('pharmacy.cashier.panels.failed')}</p>}
        </>
      )}
    </section>
  );
}
