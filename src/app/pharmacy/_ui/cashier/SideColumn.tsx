'use client';

import { Banknote, CreditCard, UserRound } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useT } from '@/studio/i18n';
import { CustomerPicker, type PickedCustomer } from '../CustomerPicker';
import { formatMinor, type Currency } from '../sell-logic';
import { Num } from '../sell-parts';
import { usdEquivalent } from './cashier-logic';
import { Keypad, type PadFunctions, type PadLineKey } from './Keypad';
import type { PayFlow, WorkFlow } from './sale-flow-logic';

// Under 820px high (a 1366x768 or 1280x800 laptop) the pay buttons are 48px instead of 56px: still well over the 44px target.
const PAY = 'inline-flex min-h-14 [@media(max-height:820px)]:min-h-12 min-w-11 items-center justify-center gap-2 rounded-ph-xl px-3 text-base font-bold disabled:cursor-not-allowed disabled:opacity-45';
const KEY = 'text-[11px] font-normal';

/** Today as the prototype's meta line writes it (dd/mm/yyyy), read after mount so the server's clock never shows. */
function useToday(): string {
  const [today, setToday] = useState('');
  useEffect(() => {
    const two = (n: number) => String(n).padStart(2, '0');
    // Read again every minute (as the header clock), so a till left open past midnight shows the new day.
    const tick = () => {
      const now = new Date();
      setToday(`${two(now.getDate())}/${two(now.getMonth() + 1)}/${now.getFullYear()}`);
    };
    tick();
    const timer = setInterval(tick, 60_000);
    return () => clearInterval(timer);
  }, []);
  return today;
}

/**
 * The side column (layout A): the total box, the customer, the receipt number, the keypad and the cash / credit buttons. The work
 * panel (the payment flows, the receipt after a sale) opens in the main column, so this column never grows. On a wide screen the
 * column itself never scrolls: the total, the keypad and the pay row keep their size, and only the customer card gives way (it
 * scrolls inside itself when a long name, its figures or the search results need more room than is left). Credit is off without
 * its permission.
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
  card = false,
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
  pad: { text: string; typed: boolean; onKey: (key: string) => void; onEnter: () => void; canEnter: boolean; onLine: (key: PadLineKey) => void; fn: PadFunctions };
  flow: WorkFlow | null;
  /** The cash panel was opened on the card method (the card button is the pressed one). */
  card?: boolean;
  /** The receipt has lines to pay for. */
  payable: boolean;
  onPay: (flow: PayFlow | 'card') => void;
}) {
  const t = useT();
  const today = useToday();
  const usd = usdEquivalent(totalMinor, currency, usdRate);
  const small = 'flex items-baseline justify-between gap-2 text-sm text-ph-on-green-muted';
  return (
    <aside className="flex min-w-0 flex-col gap-1.5 lg:min-h-0 lg:overflow-hidden lg:[grid-area:side]" aria-label={t('pharmacy.cashier.side.region')} data-testid="cashier-side">
      <div className="flex flex-col gap-0.5 rounded-ph-2xl bg-ph-g8 px-4 py-2.5 text-ph-on-green lg:shrink-0 [@media(max-height:820px)]:py-2" data-testid="cashier-total">
        {/* The receipt number shares the label's line: one row less in a column that must fit the screen. */}
        <span className="flex items-baseline justify-between gap-2 text-sm text-ph-on-green-muted">
          {t('pharmacy.cashier.total.due')}
          <span className="flex flex-wrap items-baseline justify-end gap-x-3">
            <span data-testid="receipt-no">
              {t('pharmacy.cashier.receipt.no')}{' '}
              <b className="tabular-nums text-ph-on-green">
                <Num>{receiptNo}</Num>
              </b>
            </span>
            <span data-testid="receipt-date">
              {t('pharmacy.cashier.receipt.date')}{' '}
              <b className="tabular-nums text-ph-on-green">
                <Num>{today}</Num>
              </b>
            </span>
          </span>
        </span>
        {/* On a short screen the dollar line sits beside the total: one row more for the customer card. */}
        <div className="flex flex-col gap-x-3 [@media(max-height:820px)]:flex-row [@media(max-height:820px)]:flex-wrap [@media(max-height:820px)]:items-baseline [@media(max-height:820px)]:justify-between">
          <span className="break-words text-[40px] font-extrabold leading-tight tabular-nums [@media(max-height:820px)]:text-[32px]">
            <Num>{formatMinor(totalMinor, currency)}</Num> <span className="text-base font-semibold">{currency}</span>
          </span>
          {usd !== null && (
            <span className="text-sm tabular-nums text-ph-on-green-muted" data-testid="cashier-usd">
              {t('pharmacy.cashier.total.usd', { amount: usd })}
            </span>
          )}
        </div>
        <div className="mt-1 grid gap-0.5 border-t border-ph-on-green-muted/30 pt-1.5 tabular-nums [@media(max-height:820px)]:grid-cols-2 [@media(max-height:820px)]:gap-x-4">
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
          {/* Always shown, as in the prototype: a walk-in owes 0, and with no line selected the stock reads "-". */}
          <span className={small} data-testid="cashier-balance">
            {t('pharmacy.cashier.total.balance')}
            <b className="text-ph-on-green">
              <Num>{customer ? formatMinor(BigInt(customer.balanceMinor), customer.currency) : formatMinor(0n, currency)}</Num>
            </b>
          </span>
          <span className={small} data-testid="cashier-stock">
            {t('pharmacy.cashier.total.stock')}
            <b className="text-ph-on-green">
              <Num>{stockLeft ?? '-'}</Num>
            </b>
          </span>
        </div>
      </div>

      <div className="flex min-w-0 flex-col gap-2 rounded-ph-2xl border border-ph-line bg-ph-card p-2.5 lg:min-h-0 lg:shrink lg:overflow-y-auto" data-testid="cashier-customer">
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

      {/* Last in the column, right under the keypad (which takes any spare room above it): the pay buttons are never off screen. */}
      {/* The prototype's pay row: نقدي (F2), آجل (F3), بطاقة (the cash panel on the card method). */}
      <div className="grid grid-cols-[2fr_1.2fr_1fr] gap-1.5 bg-ph-canvas lg:sticky lg:bottom-0 lg:z-10 lg:shrink-0" data-testid="cashier-pay">
        <button
          type="button"
          aria-pressed={flow === 'cash' && !card}
          disabled={!payable}
          className={`${PAY} ${flow === 'cash' && !card ? 'bg-ph-g9 text-ph-on-green' : 'bg-ph-g8 text-ph-on-green hover:bg-ph-g9'}`}
          data-testid="pay-cash"
          onClick={() => onPay('cash')}
        >
          <Banknote aria-hidden className="size-5 shrink-0" />
          <span className="flex flex-col items-start leading-tight">
            {t('pharmacy.cashier.pay.cash')}
            <small className={`${KEY} text-ph-on-green-muted`}>F2</small>
          </span>
        </button>
        <button
          type="button"
          aria-pressed={flow === 'credit'}
          disabled={!payable || !canCredit}
          className={`${PAY} border border-ph-line ${flow === 'credit' ? 'bg-ph-canvas text-ph-text' : 'bg-ph-card text-ph-text hover:bg-ph-canvas'}`}
          data-testid="pay-credit"
          onClick={() => onPay('credit')}
        >
          <span className="flex flex-col items-start leading-tight">
            {t('pharmacy.cashier.pay.credit')}
            <small className={`${KEY} text-ph-muted`}>F3</small>
          </span>
        </button>
        <button
          type="button"
          aria-pressed={flow === 'cash' && card}
          disabled={!payable}
          className={`${PAY} border border-ph-line ${flow === 'cash' && card ? 'bg-ph-canvas text-ph-text' : 'bg-ph-card text-ph-text hover:bg-ph-canvas'}`}
          data-testid="pay-card"
          onClick={() => onPay('card')}
        >
          <CreditCard aria-hidden className="size-5 shrink-0" />
          {t('pharmacy.cashier.pay.card')}
        </button>
      </div>
    </aside>
  );
}
