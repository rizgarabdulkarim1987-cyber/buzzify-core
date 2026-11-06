'use client';

import { Banknote, UserRound } from 'lucide-react';
import { useT } from '@/studio/i18n';
import { CustomerPicker, type PickedCustomer } from '../CustomerPicker';
import { formatMinor, type Currency } from '../sell-logic';
import { Num } from '../sell-parts';
import { usdEquivalent } from './cashier-logic';
import { Keypad, type PadLineKey } from './Keypad';
import type { PayFlow, WorkFlow } from './sale-flow-logic';

const PAY = 'inline-flex min-h-14 min-w-11 items-center justify-center gap-2 rounded-ph-xl px-3 text-base font-bold disabled:cursor-not-allowed disabled:opacity-45';

/**
 * The side column (layout A): the total box, the customer, the receipt number, the keypad and the cash / credit buttons. The work
 * panel (the payment flows, the receipt after a sale) opens in the main column, so this column never grows; on a wide screen it
 * scrolls in itself with the pay buttons held at its bottom. Credit is off without its permission.
 */
export function SideColumn({
  currency,
  totalMinor,
  discountMinor,
  lineCount,
  usdRate,
  receiptNo,
  canCredit,
  customer,
  onCustomer,
  customerVersion = 0,
  stockLeft,
  pad,
  flow,
  payable,
  onPay,
}: {
  currency: Currency;
  totalMinor: bigint;
  discountMinor: bigint;
  lineCount: number;
  /** IQD per 1 USD from the header pulse; null hides the dollar line. */
  usdRate: number | null;
  receiptNo: number;
  canCredit: boolean;
  customer: PickedCustomer | null;
  onCustomer: (customer: PickedCustomer | null) => void;
  /** Bumped after a credit sale: the picker's list is read again. */
  customerVersion?: number;
  /** What is left of the selected line's product in its unit; null with no selection. */
  stockLeft: number | null;
  pad: { text: string; onKey: (key: string) => void; onEnter: () => void; canEnter: boolean; onLine: (key: PadLineKey) => void };
  flow: WorkFlow | null;
  /** The receipt has lines to pay for. */
  payable: boolean;
  onPay: (flow: PayFlow) => void;
}) {
  const t = useT();
  const usd = usdEquivalent(totalMinor, currency, usdRate);
  const small = 'flex items-baseline justify-between gap-2 text-sm text-ph-on-green-muted';
  return (
    <aside className="flex min-w-0 flex-col gap-1.5 lg:min-h-0 lg:overflow-y-auto lg:[grid-area:side]" aria-label={t('pharmacy.cashier.side.region')} data-testid="cashier-side">
      <div className="flex flex-col gap-0.5 rounded-ph-2xl bg-ph-g8 px-4 py-2.5 text-ph-on-green" data-testid="cashier-total">
        {/* The receipt number shares the label's line: one row less in a column that must fit the screen. */}
        <span className="flex items-baseline justify-between gap-2 text-sm text-ph-on-green-muted">
          {t('pharmacy.cashier.total.due')}
          <span data-testid="receipt-no">
            {t('pharmacy.cashier.receipt.no')}{' '}
            <b className="tabular-nums text-ph-on-green">
              <Num>{receiptNo}</Num>
            </b>
          </span>
        </span>
        <span className="break-words text-[40px] font-extrabold leading-tight tabular-nums">
          <Num>{formatMinor(totalMinor, currency)}</Num> <span className="text-base font-semibold">{currency}</span>
        </span>
        {usd !== null && (
          <span className="text-sm tabular-nums text-ph-on-green-muted" data-testid="cashier-usd">
            {t('pharmacy.cashier.total.usd', { amount: usd })}
          </span>
        )}
        <div className="mt-1 grid gap-0.5 border-t border-ph-on-green-muted/30 pt-1.5 tabular-nums">
          <span className={small} data-testid="cashier-discount">
            {t('pharmacy.cashier.total.discount')}
            <b className="text-ph-on-green">
              <Num>{formatMinor(discountMinor, currency)}</Num>
            </b>
          </span>
          <span className={small} data-testid="cashier-count">
            {t('pharmacy.cashier.total.count')}
            <b className="text-ph-on-green">
              <Num>{lineCount}</Num>
            </b>
          </span>
          {customer && (
            <span className={small} data-testid="cashier-balance">
              {t('pharmacy.cashier.total.balance')}
              <b className="text-ph-on-green">
                <Num>{formatMinor(BigInt(customer.balanceMinor), customer.currency)}</Num>
              </b>
            </span>
          )}
          {stockLeft !== null && (
            <span className={small} data-testid="cashier-stock">
              {t('pharmacy.cashier.total.stock')}
              <b className="text-ph-on-green">
                <Num>{stockLeft}</Num>
              </b>
            </span>
          )}
        </div>
      </div>

      <div className="flex min-w-0 flex-col gap-2 rounded-ph-2xl border border-ph-line bg-ph-card p-2.5" data-testid="cashier-customer">
        {canCredit ? (
          <CustomerPicker saleCurrency={currency} picked={customer} onPick={onCustomer} typeFirst version={customerVersion} />
        ) : (
          <p className="flex items-center gap-2 text-sm font-semibold text-ph-text">
            <UserRound aria-hidden className="size-4 shrink-0 text-ph-muted" />
            {t('pharmacy.cashier.customer.cash')}
          </p>
        )}
      </div>

      <Keypad {...pad} />

      {/* Last in the column and held at its bottom while the column scrolls: the pay buttons are never off screen. */}
      <div className="grid grid-cols-[2fr_1fr] gap-1.5 bg-ph-canvas lg:sticky lg:bottom-0 lg:z-10 lg:mt-auto" data-testid="cashier-pay">
        <button
          type="button"
          aria-pressed={flow === 'cash'}
          disabled={!payable}
          className={`${PAY} ${flow === 'cash' ? 'bg-ph-g9 text-ph-on-green' : 'bg-ph-g8 text-ph-on-green hover:bg-ph-g9'}`}
          data-testid="pay-cash"
          onClick={() => onPay('cash')}
        >
          <Banknote aria-hidden className="size-5" />
          {t('pharmacy.cashier.pay.cash')}
        </button>
        <button
          type="button"
          aria-pressed={flow === 'credit'}
          disabled={!payable || !canCredit}
          className={`${PAY} border border-ph-line ${flow === 'credit' ? 'bg-ph-canvas text-ph-text' : 'bg-ph-card text-ph-text hover:bg-ph-canvas'}`}
          data-testid="pay-credit"
          onClick={() => onPay('credit')}
        >
          {t('pharmacy.cashier.pay.credit')}
        </button>
      </div>
    </aside>
  );
}
