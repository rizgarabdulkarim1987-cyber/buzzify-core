'use client';

import { TriangleAlert, Undo2 } from 'lucide-react';
import { useT } from '@/studio/i18n';
import type { PickedCustomer } from '../CustomerPicker';
import type { SellPerms } from '../sell-props';
import type { Currency, Estimate } from '../sell-logic';
import { Note, PH_BTN } from '../sell-parts';
import type { OpenReceipt } from '../sell-receipts';
import type { SellSettings } from '@/server/pharmacy/sell-search';
import { PayCash } from './PayCash';
import { PayCredit } from './PayCredit';
import { payBlockKey } from './sale-flow-logic';
import { SaleReceipt } from './SaleReceipt';
import type { SaleFlow } from './use-sale-flow';

/**
 * The work panel under the pay buttons (layout A's pay box): idle, the cash flow, the credit flow, or the receipt after a sale.
 * Everything is inline: no dialog, no motion, 44px controls; Esc or "Back" returns to idle (never while the sale is being sent).
 * Idle with a sale in flight on this receipt says so. Task 9b adds the other flows (discount, held receipts, prescription,
 * all operations) as more cases here.
 */
export function WorkPanel({
  sale,
  receipt,
  estimate,
  currency,
  settings,
  perms,
  offline,
  customer,
  onCustomer,
  onNext,
}: {
  sale: SaleFlow;
  receipt: OpenReceipt;
  estimate: Estimate;
  currency: Currency;
  settings: Pick<SellSettings, 'controlledMaxQty' | 'controlledEnabled'>;
  perms: SellPerms;
  offline: boolean;
  customer: PickedCustomer | null;
  onCustomer: (customer: PickedCustomer) => void;
  /** The next receipt (replaces this paid one). */
  onNext: () => void;
}) {
  const t = useT();
  const kind = sale.sold ? 'receipt' : (sale.flow ?? 'idle');
  if (kind === 'idle') {
    return (
      <section className="flex flex-col gap-2 empty:hidden" data-testid="work-panel" data-flow="idle" aria-label={t('pharmacy.cashier.flow.region')}>
        {receipt.attempt && !receipt.done && !sale.busy && (
          <Note look="ph" icon={<TriangleAlert aria-hidden />} tone="danger" role="alert" testId="attempt-unknown">
            {t('pharmacy.sell.attempt.unknown')}
          </Note>
        )}
      </section>
    );
  }
  const block = payBlockKey(receipt.cart, estimate, { mayDispense: perms.rx, prescriptionId: receipt.prescriptionId, controlledMaxQty: settings.controlledMaxQty, controlledEnabled: settings.controlledEnabled });
  const common = { busy: sale.busy, offline, blocked: sale.elsewhere ? t('pharmacy.cashier.flow.otherPaying') : block ? t(block) : null, onRetry: () => void sale.retry(customer?.name ?? ''), onDiscard: sale.discard, problem: sale.problem, pending: receipt.attempt !== null, elsewhere: sale.elsewhere, noPrint: sale.noPrint, onNoPrint: sale.setNoPrint };
  return (
    <section className="flex flex-col gap-2.5 rounded-ph-2xl border border-ph-line bg-ph-card p-3" data-testid="work-panel" data-flow={kind} aria-label={t('pharmacy.cashier.flow.region')}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-bold text-ph-text">{t(`pharmacy.cashier.flow.title.${kind}`)}</h2>
        {kind !== 'receipt' && (
          <button type="button" className={PH_BTN} data-testid="flow-back" disabled={sale.busy} onClick={sale.close}>
            <Undo2 aria-hidden className="size-4" />
            {t('pharmacy.cashier.flow.back')}
          </button>
        )}
      </div>
      {kind === 'cash' && <PayCash key={`${receipt.key}:cash`} currency={currency} totalMinor={estimate.totalMinor} attempt={receipt.attempt} onSubmit={(draft, amount) => void sale.pay(draft, amount, null)} {...common} />}
      {kind === 'credit' && (
        <PayCredit
          key={`${receipt.key}:credit`}
          currency={currency}
          totalMinor={estimate.totalMinor}
          attempt={receipt.attempt}
          customer={customer}
          customerId={receipt.customerId ?? receipt.attempt?.credit?.customerId ?? null}
          onCustomer={onCustomer}
          onSubmit={(draft, amount, onAccount) => void sale.pay(draft, amount, onAccount)}
          {...common}
        />
      )}
      {kind === 'receipt' && sale.sold && <SaleReceipt key={sale.sold.sale.id} sold={sale.sold} onNext={onNext} />}
    </section>
  );
}
