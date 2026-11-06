'use client';

import { useState } from 'react';
import { useT } from '@/studio/i18n';
import type { CashierKey } from '../sell-keys';
import { parseQtyText, type CartLine, type Currency } from '../sell-logic';
import type { OpenReceipt } from '../sell-receipts';
import { frozenWhy, unitKeyEffect, type CashierAction } from './cashier-logic';
import type { PadFunctions } from './Keypad';
import type { Message } from './use-adding';
import type { SaleFlow } from './use-sale-flow';

/**
 * The prototype's controls the first build left out (Task 17), wired to what the screen already does, so CashierScreen stays a
 * frame: the toolbar's answers (nothing to discard, no earlier receipt), return mode as a toggle, the keypad's function keys
 * (calculator, inquiry, return, cart), the card button (the cash panel on the card method) and the editable cells of the lines.
 * Every change to the receipt goes through `edit` (refused and said while the receipt is frozen by its sale or its hold); the
 * calculator and the captions change nothing.
 */
export function useTillExtras(o: {
  receipt: OpenReceipt;
  currency: Currency;
  sale: SaleFlow;
  /** The mirror of the receipts, for the frozen message. */
  frozenNow: () => Parameters<typeof frozenWhy>[0];
  inquiryOn: boolean;
  edit: (action: CashierAction) => boolean;
  say: (m: Message | null) => void;
  run: (key: CashierKey) => boolean;
  closeFlow: () => void;
}) {
  const t = useT();
  const { receipt, sale } = o;
  // The receipt whose cash panel the card button opened (the panel opens on the card method).
  const [cardFor, setCardFor] = useState<string | null>(null);
  const card = cardFor === receipt.key && sale.flow === 'cash';
  const empty = receipt.done || receipt.cart.lines.length === 0;

  const pay = (kind: 'cash' | 'credit' | 'card') => {
    if (kind !== 'credit' && !receipt.done && receipt.cart.lines.length === 0) return void o.say({ tone: 'danger', text: t('pharmacy.sell.blocked.empty') });
    // The cash panel is keyed by its first method, so switching between the cash and card buttons opens it afresh on that method.
    setCardFor(kind === 'card' ? receipt.key : null);
    o.run({ kind: kind === 'card' ? 'cash' : kind });
  };
  const toggleReturn = () => (sale.flow === 'return' ? o.closeFlow() : sale.open('return'));

  const fn: PadFunctions = {
    onCalc: () => sale.open('calc'),
    inquiry: o.inquiryOn,
    onInquiry: () => void o.run({ kind: 'inquiry' }),
    returning: sale.flow === 'return',
    onReturn: toggleReturn,
    onCart: () => pay('cash'),
  };

  return {
    fn,
    card,
    pay,
    toggleReturn,
    /** Discard with nothing to discard, or on a receipt being paid or held: says why. */
    discardRefused: () => o.say(empty ? { tone: 'info', text: t('pharmacy.cashier.tools.nothingToDiscard') } : { tone: 'danger', text: t(frozenWhy(o.frozenNow())) }),
    /** The copy of the last receipt, or "no earlier receipt in this shift". */
    reprint: () => (sale.last ? sale.open('copy') : o.say({ tone: 'info', text: t('pharmacy.cashier.tools.noLastReceipt') })),
    /** Escape with no panel open leaves inquiry mode (the prototype's Esc); true when it did. */
    escapeMode: (): boolean => sale.flow === null && sale.sold === null && o.inquiryOn && o.run({ kind: 'inquiry' }),
    table: {
      onQty: (key: string, text: string): boolean => {
        const qty = parseQtyText(text);
        return qty !== null && qty > 0 && o.edit({ type: 'line', action: { type: 'qty', key, qty } });
      },
      onUnit: (line: CartLine) => {
        const effect = unitKeyEffect(line, o.currency);
        if ('set' in effect) o.edit({ type: 'line', action: { type: 'unit', ...effect.set } });
        else o.say({ tone: 'info', text: t('pharmacy.cashier.unit.none') });
      },
      onDiscount: (key: string, text: string): boolean => {
        const value = text.replace(/,/g, '').trim();
        if (value !== '' && !/^\d+(\.\d+)?$/.test(value)) return false;
        return o.edit({ type: 'line', action: { type: 'discount', key, discount: value === '' || Number(value) === 0 ? null : { kind: 'amount', value } } });
      },
    },
  };
}
