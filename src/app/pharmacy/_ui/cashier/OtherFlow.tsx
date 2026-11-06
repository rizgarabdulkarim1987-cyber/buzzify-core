'use client';

import type { SaleResult } from '@/server/pharmacy/sales';
import { rxLevelOfLines } from '../prescription-logic';
import type { CartLine, Currency, DiscountDraft, Estimate } from '../sell-logic';
import type { OpenReceipt } from '../sell-receipts';
import type { CashierAction } from './cashier-logic';
import { DiscountFlow } from './DiscountFlow';
import type { CashierOp } from './flows-logic';
import { HeldList } from './HeldList';
import { OpsPanel } from './OpsPanel';
import { ReceiptCopy } from './ReceiptCopy';
import { ReturnFlow } from './ReturnFlow';
import { RxFlow } from './RxFlow';
import { rxLinesOf, type WorkFlow } from './sale-flow-logic';
import type { HoldFlow } from './use-hold-flow';
import type { ReturnFlowState } from './use-return-flow';
import type { PadSlot } from './WorkParts';

/** The body of a work-panel flow that is not a payment: the receipt discount, the held list, the prescription, all operations, the copy, a return. */
export function OtherFlow({
  flow,
  receipt,
  estimate,
  currency,
  maxPercent,
  selectedLine,
  edit,
  holds,
  ops,
  last,
  place,
  onRxSaved,
  close,
  canReturn,
  returns,
  padSlot,
}: {
  flow: WorkFlow | null;
  /** Where the side keypad types while the discount is open. */
  padSlot?: PadSlot;
  receipt: OpenReceipt;
  estimate: Estimate;
  currency: Currency;
  maxPercent: number;
  selectedLine: CartLine | null;
  /** A change to the active receipt (refused and said while it is frozen). */
  edit: (action: CashierAction) => boolean;
  holds: HoldFlow;
  ops: CashierOp[];
  last: SaleResult | null;
  place: { restaurantId: string; branchId: string };
  onRxSaved: (receiptKey: string, saved: { id: string; number: string }) => void;
  close: () => void;
  /** return.approve: the server refuses a return from anyone else. */
  canReturn: boolean;
  /** The return being sent or waiting for its answer: it outlives this panel. */
  returns: ReturnFlowState;
}) {
  const line = (action: Extract<CashierAction, { type: 'line' }>['action']) => edit({ type: 'line', action });
  if (flow === 'discount') {
    return (
      <DiscountFlow
        cart={receipt.cart}
        estimate={estimate}
        currency={currency}
        maxPercent={maxPercent}
        line={selectedLine}
        onInvoice={(discount: DiscountDraft | null) => line({ type: 'invoiceDiscount', discount })}
        onLine={(key, discount) => line({ type: 'discount', key, discount })}
        onReason={(reason) => line({ type: 'discountReason', reason })}
        onApply={close}
        padSlot={padSlot}
      />
    );
  }
  if (flow === 'held') return <HeldList holds={holds} />;
  if (flow === 'ops') return <OpsPanel ops={ops} />;
  if (flow === 'return') return <ReturnFlow canReturn={canReturn} shiftCurrency={currency} returns={returns} />;
  if (flow === 'copy' && last) return <ReceiptCopy key={last.id} sale={last} onClose={close} />;
  if (flow === 'rx') {
    const key = receipt.key;
    return (
      <RxFlow
        key={key}
        level={rxLevelOfLines(rxLinesOf(receipt.cart)) ?? 'RX'}
        restaurantId={place.restaurantId}
        branchId={place.branchId}
        frozen={receipt.attempt !== null}
        onSaved={(saved) => onRxSaved(key, saved)}
      />
    );
  }
  return null;
}
