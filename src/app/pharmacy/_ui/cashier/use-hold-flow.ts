'use client';

import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import { discardHold, holdSale, listHolds, resumeHold } from '@/app/pharmacy/_actions/sales';
import type { HoldResult, HoldSummary } from '@/server/pharmacy/holds';
import type { SellItem } from '@/server/pharmacy/sell-search';
import type { StudioFailure } from '@/server/studio/framework/result';
import { useLocale, useT } from '@/studio/i18n';
import { NETWORK_FAILURE, settle } from '@/studio/settle';
import { phDateTime } from '../ph-date';
import { phMessage } from '../ph-failure';
import { blockedLines, buildCartRequest, cartFromResume, holdSignature, keyFor, outcomeUnknown, type Currency, type KeyedAttempt } from '../sell-logic';
import { MAX_RECEIPTS, newReceipt, type ReceiptsState } from '../sell-receipts';
import type { CashierAction } from './cashier-logic';
import { holdBlockKey, resumePlace } from './flows-logic';
import type { Message } from './use-adding';

export interface HeldState {
  /** The branch's held receipts; null while they are read. */
  items: HoldSummary[] | null;
  hasMore: boolean;
  problem: string | null;
  /** The hold being resumed or discarded. */
  busyId: string | null;
}

export interface HoldFlow {
  /** How many receipts are held in this branch (as last read); null before the first answer. */
  count: number | null;
  held: HeldState;
  /** A hold is being sent. */
  holding: boolean;
  /** F8 / the Hold button: holds the active receipt. False when there is nothing to hold (the key keeps its browser meaning). */
  hold: () => boolean;
  load: () => Promise<void>;
  resume: (id: string) => Promise<void>;
  discard: (id: string) => Promise<void>;
}

/**
 * Holding receipts on the server, the old sale screen's way: `holdSale` with a key made for THAT cart (`holdSignature`), so the same
 * cart held again after a lost answer sends the same key and is held once; a second press while one is being sent does nothing. A
 * held receipt's tab is freed (a fresh empty receipt in its place); a receipt that came from a hold drops that hold once held again.
 * A receipt with a sale in flight is never held. The held list is the old `listHolds`; a hold resumes into the active receipt when
 * it is empty or paid, else into a new one, with `fromHoldId` and its lines fitted to today's products (lines that cannot be sold
 * as held are kept and marked). A hold already open on a receipt is switched to, not opened twice.
 */
export function useHoldFlow(o: {
  currency: Currency;
  enabled: boolean;
  mirror: MutableRefObject<ReceiptsState>;
  /** Changes the receipts now (the mirror too) and on screen. */
  apply: (action: CashierAction) => void;
  say: (message: Message) => void;
  setNotSent: (on: boolean) => void;
  /** Closes the held list (after a resume). */
  done: () => void;
}): HoldFlow {
  const { currency, mirror, apply, say, setNotSent } = o;
  const t = useT();
  const { locale } = useLocale();
  const [held, setHeld] = useState<HeldState>({ items: null, hasMore: false, problem: null, busyId: null });
  const [count, setCount] = useState<number | null>(null);
  const [holding, setHolding] = useState(false);
  const lock = useRef(false);
  const attempts = useRef(new Map<string, KeyedAttempt>());
  const failure = (error: StudioFailure, unknownKey?: string) => (unknownKey && outcomeUnknown(error) ? t(unknownKey) : phMessage(t, locale, error, 'pharmacy.sell'));

  const load = async () => {
    setHeld((h) => ({ ...h, items: null, hasMore: false }));
    const result = await settle(() => listHolds({}));
    if (!result.ok) {
      setHeld((h) => ({ ...h, items: [], problem: failure(result.error) }));
      return;
    }
    const data = result.data as { items: HoldSummary[]; hasMore?: boolean };
    setHeld((h) => ({ ...h, items: data.items, hasMore: data.hasMore === true, problem: null }));
    setCount(data.items.length);
  };
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the count of held receipts is read from the server once the screen is ready
    if (o.enabled) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- read once when the screen becomes ready
  }, [o.enabled]);

  const hold = (): boolean => {
    const cur = mirror.current;
    const r = cur.receipts[cur.active];
    if (!r) return false;
    const block = holdBlockKey(r);
    if (block === 'nothing') return false;
    if (lock.current) return true;
    if (block) {
      say({ tone: 'danger', text: t(block) });
      return true;
    }
    const sig = holdSignature(r.cart, currency);
    const attempt = sig ? keyFor(attempts.current.get(r.key) ?? null, sig, 'hold') : null;
    const req = attempt ? buildCartRequest(r.cart, currency, attempt.key) : null;
    if (!attempt || !req) {
      say({ tone: 'danger', text: t('pharmacy.sell.blocked.invalid') });
      return true;
    }
    attempts.current.set(r.key, attempt);
    lock.current = true;
    setHolding(true);
    void (async () => {
      const result = await settle(() => holdSale(req));
      if (!result.ok) {
        lock.current = false;
        setHolding(false);
        if (result.error.message === NETWORK_FAILURE) setNotSent(true);
        // A lost answer keeps the key (the hold may be recorded); a refusal is a definite "no": the next try is a new hold.
        if (!outcomeUnknown(result.error)) attempts.current.delete(r.key);
        say({ tone: 'danger', text: failure(result.error, 'pharmacy.sell.offline.holdUnknown') });
        return;
      }
      attempts.current.delete(r.key);
      // A resumed receipt held again is a new hold: the one it came from is dropped so the list does not double.
      if (r.fromHoldId) await settle(() => discardHold({ saleId: r.fromHoldId }));
      lock.current = false;
      setHolding(false);
      apply({ type: 'reset', receiptKey: r.key });
      say({ tone: 'success', text: t('pharmacy.sell.held', { time: phDateTime((result.data as HoldResult).heldUntil, locale) }) });
      void load();
    })();
    return true;
  };

  const resume = async (id: string) => {
    if (held.busyId) return;
    const problem = (text: string) => setHeld((h) => ({ ...h, busyId: null, problem: text }));
    const place = resumePlace(mirror.current, id);
    if (typeof place === 'object') {
      o.done();
      apply({ type: 'switch', index: place.switchTo });
      say({ tone: 'info', text: t('pharmacy.cashier.held.alreadyOpen', { n: place.switchTo + 1 }) });
      return;
    }
    if (place === 'full') return problem(t('pharmacy.cashier.tabs.max', { max: MAX_RECEIPTS }));
    setHeld((h) => ({ ...h, busyId: id, problem: null }));
    const result = await settle(() => resumeHold({ saleId: id }));
    if (!result.ok) return problem(failure(result.error));
    const data = result.data as { currency: Currency; invoiceDiscount?: unknown; lines: Record<string, unknown>[]; items: SellItem[] };
    if (data.currency !== currency) return problem(t('pharmacy.sell.holds.otherCurrency'));
    // The server sends the held products with their units, current prices and stock: nothing is dropped, a line that cannot be sold is marked.
    const { cart, blockedNames } = cartFromResume({ ...data, currency }, new Map(data.items.map((item) => [item.productId, item])));
    if (cart.lines.length === 0) return problem(t('pharmacy.sell.holds.nothing'));
    // The receipts may have changed while the hold was read: the place is decided again.
    const now = resumePlace(mirror.current, id);
    if (now === 'full' || typeof now === 'object') return problem(t('pharmacy.cashier.tabs.max', { max: MAX_RECEIPTS }));
    setHeld((h) => ({ ...h, busyId: null }));
    o.done();
    if (now === 'new') apply({ type: 'open' });
    apply({ type: 'replace', receipt: { ...newReceipt(), cart, fromHoldId: id } });
    say(
      blockedLines(cart).length > 0
        ? { tone: 'danger', text: t('pharmacy.sell.holds.blocked', { count: blockedNames.length, names: blockedNames.join(', ') }) }
        : { tone: 'info', text: t('pharmacy.sell.holds.resumed') },
    );
  };

  const discard = async (id: string) => {
    if (held.busyId) return;
    setHeld((h) => ({ ...h, busyId: id, problem: null }));
    const result = await settle(() => discardHold({ saleId: id }));
    setHeld((h) => ({ ...h, busyId: null, problem: result.ok ? null : failure(result.error) }));
    if (result.ok) await load();
  };

  return { count, held, holding, hold, load, resume, discard };
}
