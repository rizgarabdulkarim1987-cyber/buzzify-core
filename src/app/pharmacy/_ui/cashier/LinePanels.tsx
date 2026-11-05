'use client';

import { Ban, CircleAlert, EyeOff, Hourglass, Replace, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import type { InfoBatch } from '@/server/pharmacy/sell-info';
import type { SellItem } from '@/server/pharmacy/sell-search';
import { useT } from '@/studio/i18n';
import { formatMinor, startUnit, type CartLine, type Currency } from '../sell-logic';
import { FieldInput, Num, PH_FIELD } from '../sell-parts';
import { expiryText, lineBatchId } from './panels-logic';
import type { LineCost } from './SaleLinesTable';
import { useProductInfo, type ProductInfoState } from './use-product-info';

const CARD = 'flex min-w-0 flex-col gap-2 rounded-ph-xl border border-ph-line bg-ph-card p-3';
const TITLE = 'text-sm font-bold text-ph-text';
const MUTED = 'px-1 py-2 text-sm text-ph-muted';

/** How a batch reads (expiry at its precision, near or expired in words, never a colour alone), shared by the inquiry panel. */
export function BatchMarks({ batch }: { batch: Pick<InfoBatch, 'expiryDate' | 'expiryPrecision' | 'expired' | 'near'> }) {
  const t = useT();
  return (
    <>
      <Num>{expiryText(batch.expiryDate, batch.expiryPrecision)}</Num>
      {batch.expired ? (
        <span className="inline-flex items-center gap-1 text-ph-red">
          <Ban aria-hidden className="size-3.5" />
          {t('pharmacy.cashier.batch.expired')}
        </span>
      ) : batch.near ? (
        <span className="inline-flex items-center gap-1">
          <TriangleAlert aria-hidden className="size-3.5" />
          {t('pharmacy.cashier.batch.soon')}
        </span>
      ) : null}
    </>
  );
}

/** One substitute as a 44px button: its name, the price of its start unit and its stock here. */
export function SubButton({ item, currency, testId, onPick }: { item: SellItem; currency: Currency; testId: string; onPick: (item: SellItem) => void }) {
  const t = useT();
  const unit = startUnit(item);
  return (
    <button type="button" className="flex min-h-11 w-full min-w-0 flex-col items-start rounded-ph-xl border border-ph-line bg-ph-card px-3 py-1.5 text-start text-ph-text hover:bg-ph-canvas" data-testid={testId} onClick={() => onPick(item)}>
      <span className="max-w-full truncate font-semibold" dir="auto">
        {item.tradeName}
      </span>
      <small className="text-xs text-ph-muted">
        {t('pharmacy.cashier.subs.price', { price: unit?.priceMinor ? `${formatMinor(BigInt(unit.priceMinor), currency)} ${currency}` : '—', unit: unit?.label ?? '', qty: item.sellableQty })}
      </small>
    </button>
  );
}

export interface BatchOverride {
  /** A batch of the line's product, or null for automatic (soonest expiry first). */
  onPick: (batch: { batchId: string; lot: string } | null) => void;
  onReason: (reason: string) => void;
}

const CHOICE = 'flex min-h-11 min-w-0 flex-col items-start justify-center rounded-ph-xl border px-3 py-1 text-start text-sm';
const choiceTone = (on: boolean) => (on ? 'border-ph-g8 bg-ph-g8 text-ph-on-green' : 'border-ph-line bg-ph-card text-ph-text hover:bg-ph-canvas');

/**
 * The old sale screen's batch override (`batch.override`), as buttons under the batch list (never a dropdown): automatic, or one
 * of the line's batches; a chosen batch needs a reason of at least three characters, and Pay says so until it is written.
 */
function BatchChoice({ line, override }: { line: CartLine; override: BatchOverride }) {
  const t = useT();
  const short = line.batchId !== null && line.batchReason.trim().length < 3;
  return (
    <div className="flex min-w-0 flex-col gap-1.5 border-t border-ph-line pt-2" data-testid="batch-override">
      <p className="text-xs text-ph-muted">{t('pharmacy.sell.batch.hint')}</p>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('pharmacy.sell.batch.label')}>
        <button type="button" className={`${CHOICE} ${choiceTone(line.batchId === null)}`} aria-pressed={line.batchId === null} data-testid="batch-auto" onClick={() => override.onPick(null)}>
          {t('pharmacy.sell.batch.auto')}
        </button>
        {line.batches.map((b) => (
          <button key={b.batchId} type="button" className={`${CHOICE} ${choiceTone(line.batchId === b.batchId)}`} aria-pressed={line.batchId === b.batchId} data-testid="batch-pick" data-batch={b.batchId} onClick={() => override.onPick({ batchId: b.batchId, lot: b.lot })}>
            <bdi dir="auto">{b.lot}</bdi>
            <small className="text-xs">
              <Num>{b.expiryDate.slice(0, 7)}</Num> · {t('pharmacy.cashier.batch.left', { qty: b.available })}
            </small>
          </button>
        ))}
      </div>
      {line.batchId !== null && (
        <label className="flex min-w-0 flex-col gap-1 text-sm font-semibold text-ph-text">
          {t('pharmacy.sell.batch.reason')}
          <FieldInput className={PH_FIELD} dir="auto" autoComplete="off" maxLength={300} aria-invalid={short || undefined} data-testid="batch-reason" value={line.batchReason} onChange={(event) => override.onReason(event.target.value)} />
          {short && <span className="text-xs font-normal text-ph-red">{t('pharmacy.sell.batch.reasonNeeded')}</span>}
        </label>
      )}
    </div>
  );
}

/** Loading or failed in words, else the body. */
function Body({ state, children }: { state: ProductInfoState; children: (info: Extract<ProductInfoState, { status: 'ready' }>['info']) => ReactNode }) {
  const t = useT();
  if (state.status === 'ready') return <>{children(state.info)}</>;
  if (state.status === 'failed')
    return (
      <p className={`${MUTED} flex items-center gap-2 text-ph-red`} role="status">
        <CircleAlert aria-hidden className="size-4 shrink-0" />
        {t('pharmacy.cashier.panels.failed')}
      </p>
    );
  if (state.status === 'loading')
    return (
      <p className={`${MUTED} flex items-center gap-2`} role="status">
        <Hourglass aria-hidden className="size-4 shrink-0" />
        {t('pharmacy.cashier.panels.loading')}
      </p>
    );
  return <p className={MUTED}>{t('pharmacy.cashier.panels.pick')}</p>;
}

/**
 * The three panels under the sale lines (layout A's `.insp`) for the SELECTED line: its batches here nearest expiry first (the one
 * the sale takes from is marked; an expired or recalled batch is listed and marked "not sold"), its details (last three sale
 * prices, last purchase, barcode, active ingredient; the line's cost and profit from the cart's own `ph.sell.costs` answer for a
 * role that may see cost, "hidden" for anyone else), and its substitutes by active ingredient (a press replaces the line, keeping its quantity). Read only, no motion.
 */
export function LinePanels({ line, currency, canSeeCost, cost, refresh = '', onSubstitute, override }: { line: CartLine | null; currency: Currency; canSeeCost: boolean; /** The selected line's cost and profit (only ever passed when `canSeeCost`). */ cost?: LineCost; /** Changes after a sale: the product is read again (its batches moved). */ refresh?: string; onSubstitute: (item: SellItem) => void; /** batch.override: choosing the batch the line sells from (with a reason). */ override?: BatchOverride }) {
  const t = useT();
  const state = useProductInfo(line?.productId ?? null, currency, refresh);
  return (
    <section className="grid min-w-0 gap-2 lg:grid-cols-3" aria-label={t('pharmacy.cashier.panels.region')} data-testid="line-panels">
      <section className={CARD} data-testid="panel-batches">
        <h3 className={TITLE}>{t('pharmacy.cashier.panels.batches')}</h3>
        <Body state={state}>
          {(info) => {
            if (info.batches.length === 0) return <p className={MUTED}>{t('pharmacy.cashier.panels.noBatches')}</p>;
            const used = line ? lineBatchId(line, info.batches) : null;
            return (
              <ul className="flex flex-col gap-1">
                {info.batches.map((b) => (
                  <li
                    key={b.batchId}
                    data-testid="panel-batch"
                    data-lot={b.lot}
                    data-expired={b.expired}
                    aria-current={b.batchId === used ? 'true' : undefined}
                    className={`flex min-h-11 flex-col justify-center rounded-ph-xl border px-3 py-1 text-sm ${b.batchId === used ? 'border-ph-accent bg-ph-canvas' : 'border-ph-line'} ${b.sellable ? 'text-ph-text' : 'text-ph-muted'}`}
                  >
                    <span className="flex flex-wrap items-center gap-x-2">
                      <BatchMarks batch={b} />
                      {!b.sellable && <span className="text-ph-red">· {t('pharmacy.cashier.batch.notSold')}</span>}
                    </span>
                    <small className="text-xs text-ph-muted">
                      <bdi dir="auto">{b.lot}</bdi> · {t('pharmacy.cashier.batch.left', { qty: b.available })}
                    </small>
                  </li>
                ))}
              </ul>
            );
          }}
        </Body>
        {override && line && line.batches.length > 0 && <BatchChoice line={line} override={override} />}
      </section>
      <section className={CARD} data-testid="panel-details">
        <h3 className={TITLE}>{t('pharmacy.cashier.panels.details')}</h3>
        <Body state={state}>
          {(info) => (
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm text-ph-text">
              <dt className="text-ph-muted">{t('pharmacy.cashier.panels.lastSales')}</dt>
              <dd className="text-end">{info.details.lastSales.length ? <Num>{info.details.lastSales.map((s) => `${formatMinor(BigInt(s.unitPriceMinor), info.currency)} ${s.unitLabel}`).join(' · ')}</Num> : '—'}</dd>
              <dt className="text-ph-muted">{t('pharmacy.cashier.panels.lastBuy')}</dt>
              <dd className="min-w-0 break-words text-end">
                {info.details.lastPurchase ? (
                  <>
                    <Num>{info.details.lastPurchase.at}</Num>
                    {info.details.lastPurchase.supplierName && <> · <bdi dir="auto">{info.details.lastPurchase.supplierName}</bdi></>}
                  </>
                ) : (
                  '—'
                )}
              </dd>
              <dt className="text-ph-muted">{t('pharmacy.cashier.panels.code')}</dt>
              <dd className="text-end">{info.details.code ? <Num>{info.details.code}</Num> : '—'}</dd>
              <dt className="text-ph-muted">{t('pharmacy.cashier.panels.ingredient')}</dt>
              <dd className="min-w-0 break-words text-end" dir="auto">
                {info.details.activeIngredient || '—'}
              </dd>
              {!canSeeCost && (
                <>
                  <dt className="text-ph-muted">{t('pharmacy.cashier.panels.prices')}</dt>
                  <dd className="inline-flex items-center justify-end gap-1.5 text-ph-muted" data-testid="panel-cost-hidden">
                    <EyeOff aria-hidden className="size-3.5" />
                    {t('pharmacy.cashier.panels.costHidden')}
                  </dd>
                </>
              )}
            </dl>
          )}
        </Body>
        {/* The line's cost comes with the cart (not with the product read), so it shows whatever that read does. */}
        {canSeeCost && line && (
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm text-ph-text">
            <dt className="text-ph-muted">{t('pharmacy.cashier.col.cost')}</dt>
            <dd className="text-end" data-testid="panel-cost">{cost ? <Num>{formatMinor(BigInt(cost.costMinor), currency)}</Num> : '—'}</dd>
            <dt className="text-ph-muted">{t('pharmacy.cashier.col.profit')}</dt>
            <dd className="text-end" data-testid="panel-profit">{cost?.profitMinor !== undefined ? <Num>{formatMinor(BigInt(cost.profitMinor), currency)}</Num> : '—'}</dd>
          </dl>
        )}
      </section>
      <section className={CARD} data-testid="panel-subs">
        <h3 className={`${TITLE} inline-flex items-center gap-1.5`}>
          <Replace aria-hidden className="size-4" />
          {t('pharmacy.cashier.panels.subs')}
        </h3>
        <Body state={state}>
          {(info) =>
            info.substitutes.length === 0 ? (
              <p className={MUTED}>{t('pharmacy.cashier.subs.none')}</p>
            ) : (
              <div className="flex flex-col gap-1">
                {info.substitutes.map((s) => (
                  <SubButton key={s.productId} item={s} currency={currency} testId="panel-sub" onPick={onSubstitute} />
                ))}
              </div>
            )
          }
        </Body>
      </section>
    </section>
  );
}
