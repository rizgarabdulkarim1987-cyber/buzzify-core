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
import { blockedLines, formatMinor, outcomeUnknown, parseMoney, refreshCart, saleAttemptFor, saleSignature, TOTAL_MOVED_CODES, type Currency, type PayDraft } from '../sell-logic';
import type { OpenReceipt, ReceiptsState } from '../sell-receipts';
import { cashierReducer, type CashierAction } from './cashier-logic';
import { flowOfAttempt, isPayFlow, rxLinesOf, RX_DROP_CODES, saleRequestOf, type WorkFlow } from './sale-flow-logic';

/** A finished sale, shown on the receipt it was made for until the next receipt replaces it. */
export interface Sold {
  receiptKey: string;
  sale: SaleResult;
  /** The part put on a customer's account, with the customer's name (the printed receipt carries no name). */
  credit: { customerName: string; minor: string } | null;
  /** "No print" was ticked for this sale: no paper is printed by itself; the drawer still opens for a cash part. */
  noPrint: boolean;
}

/** What the screen needs to pay: the flow asked for on the active receipt, the sale call, its state and the receipt after it. */
export interface SaleFlow {
  flow: WorkFlow | null;
  /** Opens a flow on the active receipt; a payment on a receipt with a sale in flight opens that sale's own flow, filled in as it was sent. */
  open: (kind: WorkFlow) => void;
  /** Esc / back: closes the flow or the receipt panel of the active receipt (never while its sale is being sent). */
  close: () => void;
  pay: (draft: PayDraft, amountMinor: bigint, onAccount: { minor: bigint; customerName: string } | null) => Promise<void>;
  /** Sends the active receipt's attempt again exactly as it was sent (same keys, same body). */
  retry: (customerName: string) => Promise<void>;
  /**
   * Lets the active receipt's attempt go (its outcome stays unknown): the receipt can change again and the next pay has new keys.
   * False when it could not: this or another receipt's sale is being sent.
   */
  discard: () => boolean;
  /** The active receipt's sale is being sent. */
  busy: boolean;
  /** Another receipt's sale is being sent: this one waits (one sale at a time). */
  elsewhere: boolean;
  problem: string | null;
  sold: Sold | null;
  /** The last sale made on this screen (memory only, as the old screen's receipt): what "copy of the last receipt" prints. */
  last: SaleResult | null;
  noPrint: boolean;
  setNoPrint: (on: boolean) => void;
}

type SaleBody = NonNullable<ReturnType<typeof saleRequestOf>>;

/**
 * The sale path of the cashier, the old sale screen's `submitPay` moved onto receipts. One attempt (sale key and payment keys)
 * per receipt, written to the device BEFORE the call: the same sale sends the same keys, a changed one new keys. While a receipt has
 * an attempt it is frozen (`frozenEdit`): its lines are the lines being paid. A lost or unexpected answer keeps the attempt (the
 * sale may have been recorded): Retry sends it again with the same keys, or the cashier lets it go (Discard). A refusal drops it
 * (and the prescription when the refusal is about it); when prices moved the receipt stays frozen while they are read again and
 * the CURRENT lines are fitted to them. A sale marks its receipt done and turns "no print" off again. The header figures are read
 * again the way the other pharmacy screens refresh theirs: `router.refresh()` (the page reads `ph.pulse`).
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
  /** True (and says why) while the open flow must stay: a return being sent keeps return mode on screen. */
  stay?: () => boolean;
}): SaleFlow {
  const { receipt, currency, mirrorRef, dispatch, save, setNotSent, say, stay = () => false } = opts;
  const t = useT();
  const { locale } = useLocale();
  const router = useRouter();
  const [ask, setAsk] = useState<{ receiptKey: string; flow: WorkFlow } | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const lock = useRef(false);
  const [problem, setProblem] = useState<{ receiptKey: string; text: string } | null>(null);
  const [sold, setSold] = useState<Sold | null>(null);
  const [last, setLast] = useState<SaleResult | null>(null);
  // One "no print" tick for the screen, remembering the receipt it was set on: a finished sale clears it only when that sale's
  // receipt set it, so a tick made on another receipt while a sale was in flight stays.
  const [print, setPrint] = useState<{ off: boolean; by: string | null }>({ off: false, by: null });

  /** Changes the receipts now and on the device, ahead of the next render. */
  const act = (action: CashierAction) => {
    const next = cashierReducer(mirrorRef.current, action);
    mirrorRef.current = next;
    save(next);
    dispatch(action);
  };
  const current = (key: string) => mirrorRef.current.receipts.find((x) => x.key === key && !x.done) ?? null;
  /** Closes the flow only when it is the one of this receipt (a flow open on another receipt stays). */
  const closeAsk = (key: string) => setAsk((a) => (a?.receiptKey === key ? null : a));
  const failure = (error: StudioFailure) => (outcomeUnknown(error) ? t('pharmacy.sell.offline.notSent') : phMessage(t, locale, error, 'pharmacy.sell'));

  /**
   * The prices behind a refused payment moved (or the rounding did): read the receipt's products again BY ID while it stays frozen,
   * fit the receipt's CURRENT lines to the fresh prices and units, drop the attempt, and say the server's total (the old screen's).
   */
  const refreshAfterRefusal = async (key: string, error: StudioFailure, base: string, dropRx: boolean) => {
    const ids = [...new Set((current(key)?.cart.lines ?? []).map((l) => l.productId))];
    const fresh = new Map<string, SellItem>();
    let failed = false;
    for (let i = 0; i < ids.length && !failed; i += 30) {
      const read = await settle(() => sellSearch({ q: '', currency, productIds: ids.slice(i, i + 30) }));
      if (!read.ok) failed = true;
      else for (const item of (read.data as { items: SellItem[] }).items) fresh.set(item.productId, item);
    }
    const now = current(key);
    const rx = dropRx ? { prescriptionId: null } : {};
    if (failed || !now) {
      act({ type: 'refused', receiptKey: key, ...rx });
      setProblem({ receiptKey: key, text: `${base} ${t('pharmacy.sell.pay.refreshFailed')}` });
      return;
    }
    const next = refreshCart(now.cart, fresh);
    act({ type: 'refused', receiptKey: key, cart: next, ...rx });
    const total = error.fields?.totalMinor;
    const totalText = total && /^\d+$/.test(total) ? ` ${t('pharmacy.sell.pay.serverTotal', { total: `${formatMinor(BigInt(total), currency)} ${currency}` })}` : '';
    if (blockedLines(next).length > 0) {
      closeAsk(key);
      say(`${base}${totalText}`);
      return;
    }
    setProblem({ receiptKey: key, text: `${base}${totalText}` });
  };

  /** Sends the sale of the receipt `key` (its attempt is already on it, so it is frozen) and settles the answer. */
  const send = async (key: string, body: SaleBody, credit: Sold['credit']) => {
    const printOff = print.off;
    lock.current = true;
    setBusyKey(key);
    setProblem(null);
    try {
      const result = await settle(() => createSale(body));
      if (!result.ok) {
        if (result.error.message === NETWORK_FAILURE) setNotSent(true);
        // An unknown outcome keeps the attempt (and its keys); a refusal is the server's definite "no": a new try is a new sale.
        if (outcomeUnknown(result.error)) {
          setProblem({ receiptKey: key, text: failure(result.error) });
          return;
        }
        const code = result.error.fields?.phCode ?? '';
        const dropRx = RX_DROP_CODES.includes(code);
        const said = failure(result.error);
        if (TOTAL_MOVED_CODES.includes(code)) {
          await refreshAfterRefusal(key, result.error, said, dropRx);
          return;
        }
        act({ type: 'refused', receiptKey: key, ...(dropRx ? { prescriptionId: null } : {}) });
        setProblem({ receiptKey: key, text: said });
        return;
      }
      setNotSent(false);
      act({ type: 'sold', receiptKey: key });
      closeAsk(key);
      setSold({ receiptKey: key, sale: result.data as SaleResult, credit, noPrint: printOff });
      setLast(result.data as SaleResult);
      setPrint((p) => (p.by === key ? { off: false, by: null } : p));
      router.refresh();
    } finally {
      lock.current = false;
      setBusyKey(null);
    }
  };

  /** Sends the receipt's pending attempt again exactly as it was sent: the same keys and the same body. */
  const resend = async (r: OpenReceipt, a: NonNullable<OpenReceipt['attempt']>, customerName: string) => {
    const onAccount = a.credit ? parseMoney(a.credit.amount, currency) : null;
    const draft: PayDraft = { method: a.method, tendered: '', reference: a.reference, credit: a.credit ?? null };
    const body = a.credit && onAccount === null ? null : saleRequestOf(r.cart, currency, a, draft, BigInt(a.amountMinor), onAccount === null ? null : { minor: onAccount }, a.prescriptionId ?? null, a.fromHoldId);
    if (!body) {
      setProblem({ receiptKey: r.key, text: t('pharmacy.sell.blocked.invalid') });
      return;
    }
    await send(r.key, body, onAccount === null ? null : { customerName, minor: onAccount.toString() });
  };

  const pay: SaleFlow['pay'] = async (draft, amountMinor, onAccount) => {
    if (lock.current) return;
    const r = current(receipt.key);
    if (!r) return;
    // A pending attempt is only ever sent again as it was: a pay on a stuck receipt is its Retry, never a new sale over it.
    if (r.attempt) {
      await resend(r, r.attempt, onAccount?.customerName ?? '');
      return;
    }
    // A receipt whose hold is being sent (or got no answer) is never sold: it may already be held.
    if (mirrorRef.current.holding === r.key) {
      setProblem({ receiptKey: r.key, text: t('pharmacy.cashier.hold.sending') });
      return;
    }
    const rxId = prescriptionKept(r.prescriptionId, rxLinesOf(r.cart));
    const sig = saleSignature(r.cart, currency, draft, amountMinor, r.fromHoldId, rxId);
    // One key pair per attempt: a retry of the same sale (same cart, payment, hold and prescription) sends the same keys, so the
    // server records it once, also after a reload (the attempt is on the receipt, on the device). Anything changed is a new sale.
    const attempt = sig ? saleAttemptFor(r.attempt, sig, draft, amountMinor, r.fromHoldId, undefined, rxId) : null;
    const body = attempt ? saleRequestOf(r.cart, currency, attempt, draft, amountMinor, onAccount, rxId, r.fromHoldId) : null;
    if (!attempt || !body) {
      setProblem({ receiptKey: r.key, text: t('pharmacy.sell.blocked.invalid') });
      return;
    }
    act({ type: 'attempt', receiptKey: r.key, attempt });
    if (current(r.key)?.attempt !== attempt) return;
    await send(r.key, body, draft.credit && onAccount ? { customerName: onAccount.customerName, minor: onAccount.minor.toString() } : null);
  };

  const retry: SaleFlow['retry'] = async (customerName) => {
    if (lock.current) return;
    const r = current(receipt.key);
    if (r?.attempt) await resend(r, r.attempt, customerName);
  };

  const busy = busyKey === receipt.key;
  return {
    flow: ask?.receiptKey === receipt.key ? ask.flow : null,
    open: (kind) => {
      if (stay()) return;
      setAsk({ receiptKey: receipt.key, flow: receipt.attempt && isPayFlow(kind) ? flowOfAttempt(receipt.attempt) : kind });
      if (problem?.receiptKey === receipt.key && !busy) setProblem(null);
    },
    close: () => {
      if (busy || stay()) return;
      closeAsk(receipt.key);
      if (sold?.receiptKey === receipt.key) setSold(null);
    },
    pay,
    retry,
    discard: () => {
      if (busy || lock.current) return false;
      act({ type: 'attempt', receiptKey: receipt.key, attempt: null });
      setProblem(null);
      return true;
    },
    busy,
    elsewhere: busyKey !== null && !busy,
    problem: problem?.receiptKey === receipt.key ? problem.text : null,
    sold: sold?.receiptKey === receipt.key && receipt.done ? sold : null,
    last,
    noPrint: print.off,
    setNoPrint: (off) => setPrint({ off, by: receipt.key }),
  };
}
