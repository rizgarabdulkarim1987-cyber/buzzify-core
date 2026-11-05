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
  /** There are more held receipts than the count (the list is one page). */
  more: boolean;
  held: HeldState;
  /** A hold is being sent. */
  holding: boolean;
  /** F8 / the Hold button: holds the active receipt. False when there is nothing to hold (the key keeps its browser meaning). */
  hold: () => boolean;
  /** Lets go of the receipt whose hold got no answer: it may be held already, and it may be sold or changed from now on. */
  release: () => void;
  load: () => Promise<void>;
  resume: (id: string) => Promise<void>;
  discard: (id: string) => Promise<void>;
}

/**
 * Holding receipts on the server, the old sale screen's way: `holdSale` with a key made for THAT cart (`holdSignature`), so the same
 * cart held again after a lost answer sends the same key and is held once; a second press while one is being sent does nothing. A
 * held receipt's tab is freed (a fresh empty receipt in its place); a receipt that came from a hold drops that hold once held again.
 * A receipt with a sale in flight is never held. The receipt being held is frozen (`holding` on the receipts: no edit, no sale) from
 * the press until the hold lands or is refused; after a lost answer it stays frozen until it is held again (same key) or the
 * cashier lets it go (`release`), so a cart that may already be held is never sold or changed without the cashier saying so. The held list is the old `listHolds`; a hold resumes into the active receipt when
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
  const listBusy = useRef(false);
  const [more, setMore] = useState(false);
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
    setMore(data.hasMore === true);
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
    // One hold at a time: another receipt whose hold got no answer is held again or let go first.
    const other = cur.holding && cur.holding !== r.key ? cur.receipts.findIndex((x) => x.key === cur.holding) : -1;
    if (other >= 0) {
      say({ tone: 'danger', text: t('pharmacy.cashier.hold.otherPending', { n: other + 1 }) });
      return true;
    }
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
    apply({ type: 'holding', receiptKey: r.key });
    void (async () => {
      const result = await settle(() => holdSale(req));
      if (!result.ok) {
        lock.current = false;
        setHolding(false);
        if (result.error.message === NETWORK_FAILURE) setNotSent(true);
        // A lost answer keeps the key and the freeze (the hold may be recorded); a refusal is a definite "no": the receipt is free
        // again and the next try is a new hold.
        if (!outcomeUnknown(result.error)) {
          attempts.current.delete(r.key);
          apply({ type: 'holding', receiptKey: null });
        }
        say({ tone: 'danger', text: failure(result.error, 'pharmacy.sell.offline.holdUnknown') });
        return;
      }
      attempts.current.delete(r.key);
      // A resumed receipt held again is a new hold: the one it came from is dropped so the list does not double.
      if (r.fromHoldId) await settle(() => discardHold({ saleId: r.fromHoldId }));
      lock.current = false;
      setHolding(false);
      apply({ type: 'holding', receiptKey: null });
      // The receipt is freed only while it is still the cart that was held (it was frozen, so it should be).
      const now = mirror.current.receipts.find((x) => x.key === r.key && !x.done);
      const time = phDateTime((result.data as HoldResult).heldUntil, locale);
      if (!now || holdSignature(now.cart, currency) !== sig) {
        say({ tone: 'info', text: t('pharmacy.cashier.hold.changed', { time }) });
      } else {
        apply({ type: 'reset', receiptKey: r.key });
        say({ tone: 'success', text: t('pharmacy.sell.held', { time }) });
      }
      void load();
    })();
    return true;
  };

  const release = () => {
    const key = mirror.current.holding;
    if (!key || lock.current) return;
    attempts.current.delete(key);
    apply({ type: 'holding', receiptKey: null });
    say({ tone: 'info', text: t('pharmacy.cashier.hold.released') });
  };

  const resume = async (id: string) => {
    if (listBusy.current) return;
    listBusy.current = true;
    try {
      await resumeNow(id);
    } finally {
      listBusy.current = false;
    }
  };
  const resumeNow = async (id: string) => {
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
    if (now === 'full') return problem(t('pharmacy.cashier.tabs.max', { max: MAX_RECEIPTS }));
    setHeld((h) => ({ ...h, busyId: null }));
    if (typeof now === 'object') {
      o.done();
      apply({ type: 'switch', index: now.switchTo });
      say({ tone: 'info', text: t('pharmacy.cashier.held.alreadyOpen', { n: now.switchTo + 1 }) });
      return;
    }
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
    if (listBusy.current) return;
    listBusy.current = true;
    setHeld((h) => ({ ...h, busyId: id, problem: null }));
    const result = await settle(() => discardHold({ saleId: id }));
    listBusy.current = false;
    setHeld((h) => ({ ...h, busyId: null, problem: result.ok ? null : failure(result.error) }));
    if (result.ok) await load();
  };

  return { count, more, held, holding, hold, release, load, resume, discard };
}
