'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState, type Dispatch, type MutableRefObject } from 'react';
import { createSale, sellSearch } from '@/app/pharmacy/_actions/sales';
import type { SaleResult } from '@/server/pharmacy/sales';
import type { SellItem } from '@/server/pharmacy/sell-search';
import type { StudioFailure } from '@/server/studio/framework/result';
import { useLocale, useT } from '@/studio/i18n';
import { NETWORK_FAILURE, settle } from '@/studio/settle';
import { phMessage } from '../ph-failure';
import { prescriptionKept } from '../prescription-logic';
import { blockedLines, formatMinor, outcomeUnknown, refreshCart, saleAttemptFor, saleSignature, TOTAL_MOVED_CODES, type Currency, type PayDraft } from '../sell-logic';
import type { OpenReceipt, ReceiptsState } from '../sell-receipts';
import { cashierReducer, type CashierAction } from './cashier-logic';
import { flowOfAttempt, rxLinesOf, RX_DROP_CODES, saleRequestOf, type WorkFlow } from './sale-flow-logic';

/** A finished sale, shown on the receipt it was made for until the next receipt replaces it. */
export interface Sold {
  receiptKey: string;
  sale: SaleResult;
  /** The part put on a customer's account, with the customer's name (the printed receipt carries no name). */
  credit: { customerName: string; minor: string } | null;
  /** "No print" was ticked when the sale was made: nothing is printed by itself and the drawer stays shut. */
  noPrint: boolean;
}

/** What the screen needs to pay: the flow asked for on the active receipt, the sale call, its state and the receipt after it. */
export interface SaleFlow {
  flow: WorkFlow | null;
  /** Opens a flow on the active receipt; a receipt with a sale in flight opens that sale's own flow, filled in as it was sent. */
  open: (kind: WorkFlow) => void;
  /** Esc / back: closes the flow or the receipt panel of the active receipt (never while its sale is being sent). */
  close: () => void;
  pay: (draft: PayDraft, amountMinor: bigint, onAccount: { minor: bigint; customerName: string } | null) => Promise<void>;
  busy: boolean;
  problem: string | null;
  sold: Sold | null;
  noPrint: boolean;
  setNoPrint: (on: boolean) => void;
}

/**
 * The sale path of the cashier, the old sale screen's `submitPay` moved onto receipts. One attempt (sale key and payment keys)
 * per receipt, written to the device BEFORE the call: the same sale sends the same keys, a changed one new keys. A lost or
 * unexpected answer keeps the attempt (the sale may have been recorded; a retry replays it); a refusal drops it (and the
 * prescription when the refusal is about it; prices that moved are read again). A sale marks its receipt done. The header
 * figures are read again the way the other pharmacy screens refresh theirs: `router.refresh()` (the page reads `ph.pulse`).
 */
export function useSaleFlow(opts: {
  receipt: OpenReceipt;
  currency: Currency;
  /** The receipts as they are right now, ahead of the next render (the screen's own mirror). */
  mirrorRef: MutableRefObject<ReceiptsState>;
  dispatch: Dispatch<CashierAction>;
  save: (state: ReceiptsState) => void;
  setNotSent: (on: boolean) => void;
  /** Says a sentence in the screen's message line (a refusal that closed the flow). */
  say: (text: string) => void;
}): SaleFlow {
  const { receipt, currency, mirrorRef, dispatch, save, setNotSent, say } = opts;
  const t = useT();
  const { locale } = useLocale();
  const router = useRouter();
  const [ask, setAsk] = useState<{ receiptKey: string; flow: WorkFlow } | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const lock = useRef(false);
  const [problem, setProblem] = useState<{ receiptKey: string; text: string } | null>(null);
  const [sold, setSold] = useState<Sold | null>(null);
  const [noPrint, setNoPrint] = useState(false);

  /** Changes the receipts now and on the device, ahead of the next render. */
  const act = (action: CashierAction) => {
    const next = cashierReducer(mirrorRef.current, action);
    mirrorRef.current = next;
    save(next);
    dispatch(action);
  };
  const failure = (error: StudioFailure) => (outcomeUnknown(error) ? t('pharmacy.sell.offline.notSent') : phMessage(t, locale, error, 'pharmacy.sell'));

  /**
   * The prices behind a refused payment moved (or the rounding did): read the receipt's products again BY ID, fit every line to
   * the fresh prices and units, and say the server's total, so the cashier checks the receipt and pays again (the old screen's).
   */
  const refreshAfterRefusal = async (r: OpenReceipt, error: StudioFailure, base: string) => {
    const ids = [...new Set(r.cart.lines.map((l) => l.productId))];
    const fresh = new Map<string, SellItem>();
    let failed = false;
    for (let i = 0; i < ids.length && !failed; i += 30) {
      const read = await settle(() => sellSearch({ q: '', currency, productIds: ids.slice(i, i + 30) }));
      if (!read.ok) failed = true;
      else for (const item of (read.data as { items: SellItem[] }).items) fresh.set(item.productId, item);
    }
    if (failed) {
      setProblem({ receiptKey: r.key, text: `${base} ${t('pharmacy.sell.pay.refreshFailed')}` });
      return;
    }
    const next = refreshCart(r.cart, fresh);
    act({ type: 'refused', receiptKey: r.key, cart: next });
    const total = error.fields?.totalMinor;
    const totalText = total && /^\d+$/.test(total) ? ` ${t('pharmacy.sell.pay.serverTotal', { total: `${formatMinor(BigInt(total), currency)} ${currency}` })}` : '';
    if (blockedLines(next).length > 0) {
      setAsk(null);
      say(`${base}${totalText}`);
      return;
    }
    setProblem({ receiptKey: r.key, text: `${base}${totalText}` });
  };

  const pay: SaleFlow['pay'] = async (draft, amountMinor, onAccount) => {
    if (lock.current) return;
    const r = mirrorRef.current.receipts.find((x) => x.key === receipt.key && !x.done);
    if (!r) return;
    const rxId = prescriptionKept(r.prescriptionId, rxLinesOf(r.cart));
    const sig = saleSignature(r.cart, currency, draft, amountMinor, r.fromHoldId, rxId);
    if (!sig) {
      setProblem({ receiptKey: r.key, text: t('pharmacy.sell.blocked.invalid') });
      return;
    }
    // One key pair per attempt: a retry of the same sale (same cart, payment, hold and prescription) sends the same keys, so the
    // server records it once, also after a reload (the attempt is on the receipt, on the device). Anything changed is a new sale.
    const attempt = saleAttemptFor(r.attempt, sig, draft, amountMinor, r.fromHoldId, undefined, rxId);
    const body = saleRequestOf(r.cart, currency, attempt, draft, amountMinor, onAccount, rxId, r.fromHoldId);
    if (!body) {
      setProblem({ receiptKey: r.key, text: t('pharmacy.sell.blocked.invalid') });
      return;
    }
    act({ type: 'attempt', receiptKey: r.key, attempt });
    lock.current = true;
    setBusyKey(r.key);
    setProblem(null);
    const result = await settle(() => createSale(body));
    lock.current = false;
    setBusyKey(null);
    if (!result.ok) {
      if (result.error.message === NETWORK_FAILURE) setNotSent(true);
      // An unknown outcome keeps the attempt (and its keys); a refusal is the server's definite "no": a new try is a new sale.
      if (outcomeUnknown(result.error)) {
        setProblem({ receiptKey: r.key, text: failure(result.error) });
        return;
      }
      const code = result.error.fields?.phCode ?? '';
      act({ type: 'refused', receiptKey: r.key, ...(RX_DROP_CODES.includes(code) ? { prescriptionId: null } : {}) });
      const said = failure(result.error);
      if (TOTAL_MOVED_CODES.includes(code)) await refreshAfterRefusal(r, result.error, said);
      else setProblem({ receiptKey: r.key, text: said });
      return;
    }
    setNotSent(false);
    act({ type: 'sold', receiptKey: r.key });
    setAsk(null);
    setSold({ receiptKey: r.key, sale: result.data as SaleResult, credit: draft.credit && onAccount ? { customerName: onAccount.customerName, minor: onAccount.minor.toString() } : null, noPrint });
    router.refresh();
  };

  const busy = busyKey === receipt.key;
  return {
    flow: ask?.receiptKey === receipt.key ? ask.flow : null,
    open: (kind) => {
      setAsk({ receiptKey: receipt.key, flow: receipt.attempt ? flowOfAttempt(receipt.attempt) : kind });
      if (problem?.receiptKey === receipt.key && !busy) setProblem(null);
    },
    close: () => {
      if (busy) return;
      setAsk(null);
      if (sold?.receiptKey === receipt.key) setSold(null);
    },
    pay,
    busy,
    problem: problem?.receiptKey === receipt.key ? problem.text : null,
    sold: sold?.receiptKey === receipt.key && receipt.done ? sold : null,
    noPrint,
    setNoPrint,
  };
}
