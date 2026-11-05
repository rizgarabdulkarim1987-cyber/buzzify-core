'use client';

import { CircleCheck, Plus, X } from 'lucide-react';
import { useT } from '@/studio/i18n';
import { estimateCart, formatMinor, type Currency } from '../sell-logic';
import { Num } from '../sell-parts';
import { canClose, MAX_RECEIPTS, type OpenReceipt } from '../sell-receipts';

/**
 * One tab per open receipt: its number, running total (the estimate) and item count, and an X that is off while the receipt
 * has items (finish, hold or discard it first). `＋` opens another receipt and is gone at MAX_RECEIPTS. A paid receipt shows ✓.
 */
export function ReceiptTabs({
  receipts,
  active,
  currency,
  roundingStep,
  onSwitch,
  onClose,
  onOpen,
}: {
  receipts: OpenReceipt[];
  active: number;
  currency: Currency;
  roundingStep: number;
  onSwitch: (index: number) => void;
  onClose: (index: number) => void;
  onOpen: () => void;
}) {
  const t = useT();
  return (
    <div className="flex min-w-0 flex-wrap items-stretch gap-1.5" role="tablist" aria-label={t('pharmacy.cashier.tabs.region')} data-testid="receipt-tabs">
      {receipts.map((receipt, index) => {
        const selected = index === active;
        const count = receipt.cart.lines.length;
        const closable = canClose(receipt);
        const n = index + 1;
        return (
          <div
            key={receipt.key}
            role="presentation"
            className={`flex min-h-12 items-center gap-1 rounded-ph-xl border ps-3 pe-1 ${selected ? 'border-ph-g8 bg-ph-g8 text-ph-on-green' : 'border-ph-line bg-ph-canvas text-ph-text'}`}
          >
            <button
              type="button"
              role="tab"
              aria-selected={selected}
              tabIndex={selected ? 0 : -1}
              className="flex min-h-11 flex-col items-start justify-center text-start"
              data-testid="receipt-tab"
              onClick={() => onSwitch(index)}
            >
              <b className="flex items-center gap-1 text-[13px]">
                {t('pharmacy.cashier.tabs.receipt', { n })}
                {receipt.done && (
                  <>
                    <CircleCheck aria-hidden className="size-3.5" />
                    <span className="sr-only">{t('pharmacy.cashier.tabs.done')}</span>
                  </>
                )}
              </b>
              <small className={`text-[11px] ${selected ? 'text-ph-on-green-muted' : 'text-ph-muted'}`}>
                {count === 0 ? (
                  t('pharmacy.cashier.tabs.empty')
                ) : (
                  <>
                    <Num>{formatMinor(estimateCart(receipt.cart, currency, roundingStep).totalMinor, currency)}</Num> {currency} · {t('pharmacy.cashier.tabs.items', { count })}
                  </>
                )}
              </small>
            </button>
            <button
              type="button"
              className="grid min-h-11 min-w-11 place-items-center rounded-md disabled:cursor-not-allowed disabled:opacity-40"
              aria-label={t('pharmacy.cashier.tabs.close', { n })}
              title={closable ? undefined : t('pharmacy.cashier.tabs.closeBlocked')}
              disabled={!closable}
              data-testid="receipt-close"
              onClick={() => onClose(index)}
            >
              <X aria-hidden className="size-4" />
            </button>
          </div>
        );
      })}
      {receipts.length < MAX_RECEIPTS && (
        <button
          type="button"
          className="grid min-h-12 min-w-12 place-items-center rounded-ph-xl border border-dashed border-ph-accent text-ph-accent hover:bg-ph-canvas"
          aria-label={t('pharmacy.cashier.tabs.new')}
          title={t('pharmacy.cashier.tabs.new')}
          data-testid="receipt-new"
          onClick={onOpen}
        >
          <Plus aria-hidden className="size-6" />
        </button>
      )}
    </div>
  );
}
