'use client';

import {
  Barcode,
  Ban,
  CalendarClock,
  CircleAlert,
  CircleCheck,
  CircleDollarSign,
  CloudOff,
  Hourglass,
  Minus,
  Pause,
  Pill,
  Plus,
  Search,
  SearchX,
  ShieldAlert,
  ShoppingCart,
  Tag,
  Trash2,
  TriangleAlert,
  Undo2,
  PackageX,
  ListChecks,
  X,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { discardHold, holdSale, createSale, resumeHold, sellSearch } from '@/app/pharmacy/_actions/sales';
import type { SellItem, SellSettings } from '@/server/pharmacy/sell-search';
import type { SaleResult } from '@/server/pharmacy/sales';
import type { HoldResult } from '@/server/pharmacy/holds';
import type { StudioFailure } from '@/server/studio/framework/result';
import { formatDateTime } from '@/studio/format';
import { useLocale, useT } from '@/studio/i18n';
import { NETWORK_FAILURE, settle } from '@/studio/settle';
import { Field } from '@/studio/ui/Field';
import { OpenShiftPanel, type OpenShift } from './OpenShiftPanel';
import { phMessage } from './ph-failure';
import { AskDialog, HoldsDialog, PayDialog, ReceiptDialog } from './SellDialogs';
import { Chip, FIELD, Note, Num, TOUCH, TOUCH_BTN, TOUCH_PRIMARY, FieldInput, FieldSelect } from './sell-parts';
import {
  blockedLines,
  buildCartRequest,
  buildPayment,
  cartFromResume,
  cartReducer,
  createScanQueue,
  draftKey,
  emptyCart,
  estimateCart,
  formatMinor,
  holdSignature,
  isAddable,
  keyFor,
  normalizeDigits,
  outcomeUnknown,
  overSellable,
  parseDraft,
  parseQtyText,
  plainMinor,
  refreshCart,
  saleAttemptFor,
  saleSignature,
  scanOutcome,
  serializeDraft,
  shortcutOf,
  TOTAL_MOVED_CODES,
  unitOf,
  type AddableItem,
  type CartLine,
  type CartState,
  type Currency,
  type DiscountDraft,
  type KeyedAttempt,
  type PayDraft,
  type SaleAttempt,
  type ScanOutcome,
} from './sell-logic';
import { useOnline } from './use-online';
import { useScannerCapture } from './useScannerCapture';

export interface SellPerms {
  /** discount.apply */
  discount: boolean;
  /** batch.override */
  batchOverride: boolean;
  /** rx.dispense */
  rx: boolean;
}

export interface SellWorkspaceProps {
  restaurantId: string;
  branchId: string;
  userId: string;
  shift: OpenShift | null;
  settings: SellSettings;
  perms: SellPerms;
}

type View =
  | { kind: 'idle' }
  | { kind: 'results'; q: string; items: SellItem[] }
  | { kind: 'error'; message: string };

/** A scan that was not simply added: said on screen until the cashier dismisses it (several can wait at once). */
type ScanIssue = { id: number; outcome: Exclude<ScanOutcome, { kind: 'add' }> | { kind: 'failed'; code: string; message: string } };

const SEARCH_DELAY_MS = 140;
const SOON_DAYS = 90;
const MAX_ISSUES = 50;

function expirySoon(expiryDate: string): boolean {
  const ms = Date.parse(`${expiryDate}T00:00:00Z`) - Date.now();
  return ms < SOON_DAYS * 86_400_000;
}

/**
 * The sale workspace. A shift gate first (no open shift, no sale), then one screen: a search and scan box with the
 * results next to the cart. Everything is a button or a key: F2 search, Enter adds the top result, a scanner adds the
 * scanned item, F4 pays, F8 holds, Escape clears. The cart's totals are an ESTIMATE from the prices shown; the sale
 * prices, discounts, rounds and takes stock again on the server, and the receipt shows what it stored.
 *
 * Retries are safe by keys, not by hope. A sale is sent with a sale key and a payment key made for THAT sale (cart,
 * payment, hold): the same sale sends the same keys, a changed one gets new ones. A dropped connection leaves the outcome
 * unknown, so the attempt (keys and payment) is kept with the cart on this device, also across a reload, and the screen
 * says the sale may or may not have been recorded. A definite refusal drops the attempt. A sale is never queued.
 */
export function SellWorkspace(props: SellWorkspaceProps) {
  const { restaurantId, branchId, userId, settings, perms } = props;
  const t = useT();
  const { locale } = useLocale();
  const router = useRouter();
  const online = useOnline();
  const [shift, setShift] = useState<OpenShift | null>(props.shift);
  const [cart, dispatch] = useReducer(cartReducer, undefined, emptyCart);
  const [fromHoldId, setFromHoldId] = useState<string | null>(null);

  const [query, setQuery] = useState('');
  const [view, setView] = useState<View>({ kind: 'idle' });
  const [searching, setSearching] = useState(false);
  const searchBox = useRef<HTMLInputElement>(null);
  const searchSeq = useRef(0);
  const latest = useRef<{ q: string; items: SellItem[] } | null>(null);
  const typingPause = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [issues, setIssues] = useState<ScanIssue[]>([]);
  const issueSeq = useRef(0);

  const [payOpen, setPayOpen] = useState(false);
  const [paying, setPaying] = useState(false);
  const payLock = useRef(false);
  const [payProblem, setPayProblem] = useState<string | null>(null);
  const attempt = useRef<SaleAttempt | null>(null);
  const [pending, setPending] = useState<SaleAttempt | null>(null);
  const holdAttempt = useRef<KeyedAttempt | null>(null);
  const [sale, setSale] = useState<SaleResult | null>(null);

  const [holdsOpen, setHoldsOpen] = useState(false);
  const [askClear, setAskClear] = useState(false);
  const [leaveTo, setLeaveTo] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: 'success' | 'info' | 'danger'; text: string } | null>(null);
  const [notSent, setNotSent] = useState(false);
  const [holding, setHolding] = useState(false);
  const [restored, setRestored] = useState(false);
  const [draftChecked, setDraftChecked] = useState(false);

  const currency: Currency = shift?.currency ?? settings.defaultCurrency;
  const step = Number(settings.roundingStepMinor);
  const estimate = useMemo(() => estimateCart(cart, currency, step), [cart, currency, step]);
  const over = useMemo(() => overSellable(cart), [cart]);
  const heldBlocked = useMemo(() => blockedLines(cart), [cart]);
  const hasRx = cart.lines.some((l) => l.rxLevel === 'RX');
  const rxBlocked = hasRx && !perms.rx;
  const anyDiscount = cart.invoiceDiscount !== null || cart.lines.some((l) => l.discount !== null);
  const dialogOpen = payOpen || holdsOpen || sale !== null || askClear || leaveTo !== null;

  // Why the pay button is off, in words (never a silent grey button).
  const blocked: string | null = !shift
    ? null
    : cart.lines.length === 0
      ? t('pharmacy.sell.blocked.empty')
      : heldBlocked.length > 0
        ? t('pharmacy.sell.blocked.heldLines')
        : estimate.unpricedCount > 0
          ? t('pharmacy.sell.blocked.unpriced')
          : estimate.invalidCount > 0
            ? t('pharmacy.sell.blocked.invalid')
            : rxBlocked
              ? t('pharmacy.sell.blocked.rx')
              : cart.lines.some((l) => l.batchId && l.batchReason.trim().length < 3)
                ? t('pharmacy.sell.batch.reasonNeeded')
                : estimate.totalMinor <= 0n
                  ? t('pharmacy.sell.blocked.zero')
                  : null;
  const canPay = shift !== null && blocked === null;
  // A held cart's marked lines stop the hold too (an Rx or an empty total does not: a cart can be held for the pharmacist).
  const canHold = cart.lines.length > 0 && heldBlocked.length === 0 && !holding;

  /**
   * A refusal in words. A dropped connection (and, for a write, an unexpected server error) is said with `unknownKey`: for a
   * write it means the work may or may not have been recorded.
   */
  const failure = useCallback(
    (error: StudioFailure, unknownKey: string = 'pharmacy.sell.offline.searchFailed') => {
      const write = unknownKey !== 'pharmacy.sell.offline.searchFailed';
      const unknown = write ? outcomeUnknown(error) : error.message === NETWORK_FAILURE;
      return unknown ? t(unknownKey) : phMessage(t, locale, error, 'pharmacy.sell');
    },
    [t, locale],
  );

  // The draft cart lives on this device ------------------------------------------------------------------------------
  const storageKey = draftKey(restaurantId, branchId, userId, currency);
  const writeDraft = useCallback(() => {
    try {
      if (cart.lines.length === 0) window.localStorage.removeItem(storageKey);
      else window.localStorage.setItem(storageKey, serializeDraft(currency, cart, attempt.current, fromHoldId));
    } catch {
      /* the draft is a convenience */
    }
  }, [cart, currency, fromHoldId, storageKey]);
  const setAttempt = (next: SaleAttempt | null) => {
    attempt.current = next;
    setPending(next);
  };
  useEffect(() => {
    if (!shift || draftChecked) return;
    try {
      const draft = parseDraft(window.localStorage.getItem(storageKey));
      if (draft) {
        dispatch({ type: 'load', cart: draft.cart });
        attempt.current = draft.attempt;
        // eslint-disable-next-line react-hooks/set-state-in-effect -- the draft is read from this device's storage once, after the shift is known
        setPending(draft.attempt);
        setFromHoldId(draft.fromHoldId);
        setRestored(true);
      }
    } catch {
      /* storage can be blocked: the cart simply starts empty */
    }
    setDraftChecked(true);
  }, [shift, draftChecked, storageKey]);
  useEffect(() => {
    if (!shift || !draftChecked) return;
    writeDraft();
  }, [shift, draftChecked, writeDraft, pending]);

  // A cart emptied line by line is no longer the held cart it came from: a later hold or sale must not touch that hold.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- follows the cart: an empty cart has no source hold
    if (draftChecked && cart.lines.length === 0 && fromHoldId !== null) setFromHoldId(null);
  }, [draftChecked, cart.lines.length, fromHoldId]);

  // Leaving with a cart ------------------------------------------------------------------------------------------------
  useEffect(() => {
    if (cart.lines.length === 0) return;
    const before = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    const click = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
      const anchor = (event.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!anchor || anchor.target === '_blank' || anchor.origin !== window.location.origin || anchor.pathname === window.location.pathname) return;
      event.preventDefault();
      event.stopPropagation();
      setLeaveTo(anchor.pathname + anchor.search);
    };
    window.addEventListener('beforeunload', before);
    document.addEventListener('click', click, true);
    return () => {
      window.removeEventListener('beforeunload', before);
      document.removeEventListener('click', click, true);
    };
  }, [cart.lines.length]);

  // Search (typing). Scans never come through here: they have their own queue below. ---------------------------------------
  const runSearch = useCallback(
    async (q: string): Promise<SellItem[] | null> => {
      const mine = ++searchSeq.current;
      setSearching(true);
      const result = await settle(() => sellSearch({ q, currency }));
      if (mine !== searchSeq.current) return null;
      setSearching(false);
      if (!result.ok) {
        if (result.error.message === NETWORK_FAILURE) setNotSent(true);
        setView({ kind: 'error', message: failure(result.error) });
        return null;
      }
      setNotSent(false);
      return (result.data as { items: SellItem[] }).items;
    },
    [currency, failure],
  );

  useEffect(() => {
    const q = query.trim();
    if (q === '') {
      searchSeq.current += 1;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- an emptied box drops the pending search and its results
      setSearching(false);
      setView((v) => (v.kind === 'results' || v.kind === 'error' ? { kind: 'idle' } : v));
      latest.current = null;
      return;
    }
    const timer = setTimeout(() => {
      typingPause.current = null;
      void runSearch(q).then((items) => {
        if (!items) return;
        latest.current = { q, items };
        setView({ kind: 'results', q, items });
      });
    }, SEARCH_DELAY_MS);
    typingPause.current = timer;
    return () => clearTimeout(timer);
  }, [query, runSearch]);

  // Adding ---------------------------------------------------------------------------------------------------------------
  const addable = isAddable;
  const add = (item: AddableItem, unitId?: string) => {
    dispatch({ type: 'add', item, unitId });
    setNotice(null);
  };

  const addTop = async () => {
    const q = query.trim();
    if (q === '') return;
    // Enter searches by itself: the typing pause must not fire a second search that would supersede this one (a slow first answer then added nothing).
    if (typingPause.current) clearTimeout(typingPause.current);
    typingPause.current = null;
    let items = latest.current?.q === q ? latest.current.items : null;
    if (!items) {
      items = await runSearch(q);
      if (items) {
        latest.current = { q, items };
        setView({ kind: 'results', q, items });
      }
    }
    const top = items?.find(addable);
    if (top) {
      add(top);
      setQuery('');
      searchBox.current?.focus();
    }
  };

  // Scans: one at a time, in order, each added or said ---------------------------------------------------------------------
  const report = useCallback((outcome: ScanIssue['outcome']) => {
    issueSeq.current += 1;
    const id = issueSeq.current;
    setIssues((list) => [...list, { id, outcome }].slice(-MAX_ISSUES));
  }, []);
  const handleScan = async (code: string) => {
    const result = await settle(() => sellSearch({ q: code, currency }));
    if (!result.ok) {
      if (result.error.message === NETWORK_FAILURE) setNotSent(true);
      report({ kind: 'failed', code, message: result.error.message === NETWORK_FAILURE ? t('pharmacy.sell.scan.failed', { code }) : phMessage(t, locale, result.error, 'pharmacy.sell') });
      return;
    }
    setNotSent(false);
    const outcome = scanOutcome(code, (result.data as { items: SellItem[] }).items);
    if (outcome.kind === 'add') {
      dispatch({ type: 'add', item: outcome.item });
      setNotice(null);
    } else report(outcome);
  };
  const scanHandler = useRef(handleScan);
  useEffect(() => {
    scanHandler.current = handleScan;
  });
  const scanQueue = useRef<ReturnType<typeof createScanQueue> | null>(null);
  useEffect(() => {
    scanQueue.current = createScanQueue((code) => scanHandler.current(code));
  }, []);
  useScannerCapture((code) => scanQueue.current?.push(code), { enabled: shift !== null && !dialogOpen });
  const dismissIssue = (id: number) => setIssues((list) => list.filter((i) => i.id !== id));

  // Keys -----------------------------------------------------------------------------------------------------------------
  const openPay = () => {
    if (!canPay) return;
    setPayProblem(null);
    setPayOpen(true);
  };
  const holdCart = async () => {
    if (holding || cart.lines.length === 0 || !shift) return;
    if (heldBlocked.length > 0) {
      setNotice({ tone: 'danger', text: t('pharmacy.sell.blocked.heldLines') });
      return;
    }
    // The same cart held again after a dropped connection sends the same key, so the server holds it once.
    const sig = holdSignature(cart, currency);
    if (sig) holdAttempt.current = keyFor(holdAttempt.current, sig, 'hold');
    const req = sig && holdAttempt.current ? buildCartRequest(cart, currency, holdAttempt.current.key) : null;
    if (!req) {
      setNotice({ tone: 'danger', text: t('pharmacy.sell.blocked.invalid') });
      return;
    }
    setHolding(true);
    const result = await settle(() => holdSale(req));
    setHolding(false);
    if (!result.ok) {
      if (result.error.message === NETWORK_FAILURE) setNotSent(true);
      if (!outcomeUnknown(result.error)) holdAttempt.current = null;
      setNotice({ tone: 'danger', text: failure(result.error, 'pharmacy.sell.offline.holdUnknown') });
      return;
    }
    const held = result.data as HoldResult;
    holdAttempt.current = null;
    // A resumed cart held again is a new hold: the old one is dropped so the shelf does not double.
    if (fromHoldId) await settle(() => discardHold({ saleId: fromHoldId }));
    setFromHoldId(null);
    setAttempt(null);
    dispatch({ type: 'clear' });
    setNotice({ tone: 'success', text: t('pharmacy.sell.held', { time: formatDateTime(held.heldUntil, locale) }) });
    searchBox.current?.focus();
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const inSearch = event.target === searchBox.current;
      const key = shortcutOf(event, inSearch);
      if (!key || key === 'addTop' || !shift) return;
      if (dialogOpen) return;
      event.preventDefault();
      if (key === 'search') {
        searchBox.current?.focus();
        searchBox.current?.select();
      } else if (key === 'pay') openPay();
      else if (key === 'hold') void holdCart();
      else if (key === 'escape') {
        setQuery('');
        setView({ kind: 'idle' });
        setIssues([]);
        searchBox.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // Paying ---------------------------------------------------------------------------------------------------------------
  /**
   * The prices behind a refused payment moved (or the rounding did): read the cart's products again BY ID, fit every line to
   * the fresh prices and units, and say what the server's total is, so the cashier checks the cart and tries again.
   */
  const refreshAfterRefusal = async (error: StudioFailure, base: string) => {
    const ids = [...new Set(cart.lines.map((l) => l.productId))];
    const fresh = new Map<string, SellItem>();
    let failed = false;
    for (let i = 0; i < ids.length && !failed; i += 30) {
      const read = await settle(() => sellSearch({ q: '', currency, productIds: ids.slice(i, i + 30) }));
      if (!read.ok) failed = true;
      else for (const item of (read.data as { items: SellItem[] }).items) fresh.set(item.productId, item);
    }
    if (failed) {
      setPayProblem(`${base} ${t('pharmacy.sell.pay.refreshFailed')}`);
      return;
    }
    const next = refreshCart(cart, fresh);
    dispatch({ type: 'load', cart: next });
    const total = error.fields?.totalMinor;
    const totalText = total && /^\d+$/.test(total) ? ` ${t('pharmacy.sell.pay.serverTotal', { total: `${formatMinor(BigInt(total), currency)} ${currency}` })}` : '';
    const stopped = blockedLines(next);
    if (stopped.length > 0) {
      setPayOpen(false);
      setNotice({ tone: 'danger', text: `${base}${totalText}` });
      return;
    }
    setPayProblem(`${base}${totalText}`);
  };

  const submitPay = async (draft: PayDraft, amountMinor: bigint) => {
    if (payLock.current) return;
    const base = buildCartRequest(cart, currency, '');
    const sig = saleSignature(cart, currency, draft, amountMinor, fromHoldId);
    if (!base || !sig) {
      setPayProblem(t('pharmacy.sell.blocked.invalid'));
      return;
    }
    // One key pair per attempt: a retry of the same sale (same cart, payment and hold) sends the same keys, so the server
    // records it once, also after a reload (the attempt is kept in the draft). Anything changed is a different sale.
    const next = saleAttemptFor(attempt.current, sig, draft, amountMinor, fromHoldId);
    attempt.current = next;
    setPending(next);
    try {
      window.localStorage.setItem(storageKey, serializeDraft(currency, cart, next, fromHoldId));
    } catch {
      /* the draft is a convenience */
    }
    payLock.current = true;
    setPaying(true);
    setPayProblem(null);
    const result = await settle(() =>
      createSale({ ...base, clientKey: next.key, payments: [buildPayment(draft, amountMinor, next.paymentKey)], ...(fromHoldId ? { fromHoldId } : {}) }),
    );
    payLock.current = false;
    setPaying(false);
    if (!result.ok) {
      if (result.error.message === NETWORK_FAILURE) setNotSent(true);
      // An unknown outcome keeps the attempt (and its keys); a refusal is the server's definite "no": a new try is a new sale.
      if (outcomeUnknown(result.error)) {
        setPayProblem(failure(result.error, 'pharmacy.sell.offline.notSent'));
        return;
      }
      setAttempt(null);
      const said = failure(result.error, 'pharmacy.sell.offline.notSent');
      if (TOTAL_MOVED_CODES.includes(result.error.fields?.phCode ?? '')) await refreshAfterRefusal(result.error, said);
      else setPayProblem(said);
      return;
    }
    setNotSent(false);
    setAttempt(null);
    setFromHoldId(null);
    dispatch({ type: 'clear' });
    setPayOpen(false);
    setSale(result.data as SaleResult);
    setNotice(null);
  };

  // Holds ----------------------------------------------------------------------------------------------------------------
  const resume = async (id: string): Promise<string | null> => {
    const result = await settle(() => resumeHold({ saleId: id }));
    if (!result.ok) return failure(result.error);
    const held = result.data as { currency: Currency; invoiceDiscount?: unknown; lines: Record<string, unknown>[]; items: SellItem[] };
    if (held.currency !== currency) return t('pharmacy.sell.holds.otherCurrency');
    // The server sends the held products with their units, current prices and stock: no search by name, nothing dropped.
    const items = new Map(held.items.map((item) => [item.productId, item]));
    const { cart: next } = cartFromResume({ ...held, currency }, items);
    if (next.lines.length === 0) return t('pharmacy.sell.holds.nothing');
    setAttempt(null);
    holdAttempt.current = null;
    dispatch({ type: 'load', cart: next });
    setFromHoldId(id);
    setHoldsOpen(false);
    setNotice(blockedLines(next).length > 0 ? null : { tone: 'info', text: t('pharmacy.sell.holds.resumed') });
    return null;
  };
  const discard = async (id: string): Promise<string | null> => {
    const result = await settle(() => discardHold({ saleId: id }));
    return result.ok ? null : failure(result.error);
  };

  const clearAll = () => {
    setAttempt(null);
    holdAttempt.current = null;
    setFromHoldId(null);
    dispatch({ type: 'clear' });
    setNotice(null);
    setIssues([]);
    searchBox.current?.focus();
  };

  // Render ---------------------------------------------------------------------------------------------------------------
  if (!shift) {
    return <OpenShiftPanel currencies={settings.enabledCurrencies as Currency[]} defaultCurrency={settings.defaultCurrency} onOpened={setShift} />;
  }

  const showOffline = !online || notSent;
  const money = (minor: bigint) => (
    <>
      <Num>{formatMinor(minor, currency)}</Num> {currency}
    </>
  );

  return (
    <div className="flex min-w-0 flex-col gap-3 px-3 pb-24 pt-3 sm:px-6 lg:pb-6" data-testid="sell-workspace">
      <h1 className="sr-only">{t('pharmacy.sell.title')}</h1>
      <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted" data-testid="shift-line">
        <span className="inline-flex items-center gap-1.5 text-text">
          <CircleCheck aria-hidden className="size-4 text-success" />
          {t('pharmacy.sell.shift.openNow', { currency })}
        </span>
        <span>
          {t('pharmacy.sell.shift.float', { currency })}: <Num>{formatMinor(BigInt(shift.openingFloatMinor), currency)}</Num>
        </span>
        <span>
          <Num>{formatDateTime(shift.openedAt, locale)}</Num>
        </span>
      </p>

      {showOffline && (
        <Note icon={<CloudOff aria-hidden />} tone="danger" role="alert" testId="sell-offline">
          {t('pharmacy.sell.offline.banner')}
        </Note>
      )}
      {restored && cart.lines.length > 0 && (
        <Note icon={<Undo2 aria-hidden />} tone="info" role="status" testId="draft-restored">
          {t('pharmacy.sell.draft.restored')}
        </Note>
      )}
      {pending && !payOpen && !sale && (
        <Note icon={<TriangleAlert aria-hidden />} tone="danger" role="alert" testId="attempt-unknown">
          {t('pharmacy.sell.attempt.unknown')}
        </Note>
      )}
      {heldBlocked.length > 0 && (
        <Note icon={<Ban aria-hidden />} tone="danger" role="alert" testId="held-blocked">
          {t('pharmacy.sell.holds.blocked', { count: heldBlocked.length, names: heldBlocked.map((l) => l.name).join(', ') })}
        </Note>
      )}
      {notice && (
        <Note icon={notice.tone === 'danger' ? <CircleAlert aria-hidden /> : <CircleCheck aria-hidden />} tone={notice.tone} role="status" testId="sell-notice">
          {notice.text}
        </Note>
      )}

      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,27rem)] lg:items-start">
        {/* Search and results */}
        <section aria-label={t('pharmacy.sell.search.region')} className="flex min-w-0 flex-col gap-3">
          <Field label={t('pharmacy.sell.search.label')} hint={t('pharmacy.sell.search.hint')}>
            <div className="relative">
              <Search aria-hidden className="pointer-events-none absolute start-3 top-1/2 size-5 -translate-y-1/2 text-muted" />
              <FieldInput
                ref={searchBox}
                type="search"
                dir="auto"
                autoComplete="off"
                enterKeyHint="search"
                autoFocus
                data-testid="sell-search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  // A scanner's closing Enter was already taken by the scan capture (default prevented): it must not also add the top result.
                  if (event.nativeEvent.defaultPrevented) return;
                  if (shortcutOf(event.nativeEvent, true) === 'addTop') {
                    event.preventDefault();
                    void addTop();
                  }
                }}
                className={`${FIELD} min-h-12 ps-10 text-md`}
              />
            </div>
          </Field>

          <div aria-live="polite" className="flex min-w-0 flex-col gap-2" data-testid="sell-results">
            {searching && (
              <Note icon={<Hourglass aria-hidden />} role="status">
                {t('pharmacy.sell.searching')}
              </Note>
            )}
            {view.kind === 'idle' && !searching && (
              <p className="flex items-center gap-2.5 py-3 text-sm text-muted" data-testid="sell-idle">
                <Barcode aria-hidden className="size-4 shrink-0" />
                {t('pharmacy.sell.idle')}
              </p>
            )}
            {view.kind === 'error' && (
              <Note icon={<CircleAlert aria-hidden />} tone="danger" role="alert" testId="search-error">
                {view.message}
              </Note>
            )}
            {issues.map((issue) => (
              <ScanIssueCard key={issue.id} issue={issue} currency={currency} add={add} dismiss={() => dismissIssue(issue.id)} t={t} />
            ))}
            {view.kind === 'results' &&
              (view.items.length === 0 ? (
                <p className="flex items-center gap-2.5 py-3 text-sm text-text" data-testid="sell-empty">
                  <SearchX aria-hidden className="size-4 shrink-0 text-muted" />
                  {t('pharmacy.sell.empty', { q: view.q })}
                </p>
              ) : (
                <ResultList items={view.items} currency={currency} onAdd={add} addable={addable} t={t} />
              ))}
          </div>
        </section>

        {/* Cart */}
        <section aria-labelledby="cart-title" className="flex min-w-0 flex-col gap-3 rounded-lg border border-line bg-raised p-3 lg:sticky lg:top-3" data-testid="cart">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="cart-title" className="flex items-center gap-2 text-md font-semibold text-text">
              <ShoppingCart aria-hidden className="size-4 shrink-0" />
              {t('pharmacy.sell.cart.title')}
              <span className="text-sm font-normal text-muted" data-testid="cart-count">
                ({cart.lines.length})
              </span>
            </h2>
            <span className="flex flex-wrap gap-2">
              <button type="button" className={TOUCH_BTN} data-testid="open-holds" onClick={() => setHoldsOpen(true)}>
                <Pause aria-hidden className="size-4" />
                {t('pharmacy.sell.holds.open')}
              </button>
              <button type="button" className={TOUCH_BTN} data-testid="clear-cart" disabled={cart.lines.length === 0} onClick={() => setAskClear(true)}>
                <Trash2 aria-hidden className="size-4" />
                {t('pharmacy.sell.cart.clear')}
              </button>
            </span>
          </div>

          {cart.lines.length === 0 ? (
            <p className="flex items-center gap-2.5 py-6 text-sm text-muted" data-testid="cart-empty">
              <ShoppingCart aria-hidden className="size-4 shrink-0" />
              {t('pharmacy.sell.cart.empty')}
            </p>
          ) : (
            <ul className="flex flex-col divide-y divide-line" data-testid="cart-lines">
              {cart.lines.map((line) => (
                <CartRow
                  key={line.key}
                  line={line}
                  currency={currency}
                  total={estimate.lines.find((l) => l.key === line.key)}
                  over={over.has(line.productId)}
                  perms={perms}
                  t={t}
                  dispatch={dispatch}
                />
              ))}
            </ul>
          )}

          {cart.lines.length > 0 && (
            <div className="flex flex-col gap-3 border-t border-line pt-3">
              {perms.discount && (
                <div className="flex flex-col gap-2">
                  <DiscountEditor
                    label={t('pharmacy.sell.discount.invoice')}
                    value={cart.invoiceDiscount}
                    currency={currency}
                    testId="invoice-discount"
                    t={t}
                    onChange={(discount) => dispatch({ type: 'invoiceDiscount', discount })}
                  />
                  {anyDiscount && (
                    <Field label={t('pharmacy.sell.discount.reason')} hint={t('pharmacy.sell.discount.reasonHint', { percent: settings.maxDiscountPercent })} optional>
                      <FieldInput className={FIELD} dir="auto" autoComplete="off" maxLength={300} data-testid="discount-reason" value={cart.discountReason} onChange={(event) => dispatch({ type: 'discountReason', reason: event.target.value })} />
                    </Field>
                  )}
                </div>
              )}
              <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm text-text" data-testid="cart-totals">
                <dt className="text-muted">{t('pharmacy.sell.totals.subtotal')}</dt>
                <dd className="text-end">{money(estimate.grossMinor)}</dd>
                {estimate.lineDiscountMinor + estimate.invoiceDiscountMinor > 0n && (
                  <>
                    <dt className="text-muted">{t('pharmacy.sell.totals.discount')}</dt>
                    <dd className="text-end">−{money(estimate.lineDiscountMinor + estimate.invoiceDiscountMinor)}</dd>
                  </>
                )}
                {estimate.roundingMinor !== 0n && (
                  <>
                    <dt className="text-muted">{t('pharmacy.sell.totals.rounding')}</dt>
                    <dd className="text-end">{money(estimate.roundingMinor)}</dd>
                  </>
                )}
                <dt className="text-md font-semibold">
                  {t('pharmacy.sell.totals.total')}
                  <span className="ms-2 inline-flex items-center gap-1 text-xs font-normal text-muted" data-testid="estimate-mark">
                    <Tag aria-hidden className="size-3" />
                    {t('pharmacy.sell.estimate')}
                  </span>
                </dt>
                <dd className="text-end text-lg font-semibold" data-testid="cart-total">
                  {money(estimate.totalMinor)}
                </dd>
              </dl>
              {blocked && (
                <Note icon={<TriangleAlert aria-hidden />} role="status" testId="pay-blocked">
                  {blocked}
                </Note>
              )}
              <div className="hidden gap-2 lg:flex">
                <button type="button" className={`${TOUCH_BTN} flex-1`} data-testid="hold-cart" disabled={!canHold} onClick={() => void holdCart()}>
                  <Pause aria-hidden className="size-4" />
                  {t('pharmacy.sell.hold')} <kbd className="text-xs text-muted">F8</kbd>
                </button>
                <button type="button" className={`${TOUCH_PRIMARY} flex-[2]`} data-testid="pay-open" disabled={!canPay} onClick={openPay}>
                  <CircleDollarSign aria-hidden className="size-4" />
                  {t('pharmacy.sell.pay')} <kbd className="text-xs opacity-80">F4</kbd>
                </button>
              </div>
            </div>
          )}
        </section>
      </div>

      {/* The phone's bar: the total and the two actions stay in reach. */}
      {cart.lines.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-30 flex items-center gap-2 border-t border-line bg-raised px-3 py-2 lg:hidden" data-testid="sell-bar">
          <span className="min-w-0 flex-1 text-md font-semibold text-text">{money(estimate.totalMinor)}</span>
          <button type="button" className={TOUCH_BTN} data-testid="hold-cart-bar" disabled={!canHold} onClick={() => void holdCart()}>
            <Pause aria-hidden className="size-4" />
            {t('pharmacy.sell.hold')}
          </button>
          <button type="button" className={TOUCH_PRIMARY} data-testid="pay-open-bar" disabled={!canPay} onClick={openPay}>
            <CircleDollarSign aria-hidden className="size-4" />
            {t('pharmacy.sell.pay')}
          </button>
        </div>
      )}

      <PayDialog
        open={payOpen}
        onOpenChange={setPayOpen}
        currency={currency}
        totalMinor={estimate.totalMinor}
        busy={paying}
        problem={payProblem}
        offline={!online}
        initial={pending ? { method: pending.method, tendered: plainMinor(BigInt(pending.amountMinor), currency), reference: pending.reference } : null}
        onSubmit={(d, a) => void submitPay(d, a)}
      />
      <HoldsDialog open={holdsOpen} onOpenChange={setHoldsOpen} cartEmpty={cart.lines.length === 0} onResume={resume} onDiscard={discard} />
      <ReceiptDialog
        sale={sale}
        onClose={() => {
          setSale(null);
          searchBox.current?.focus();
        }}
      />
      <AskDialog
        open={askClear}
        onOpenChange={setAskClear}
        title={t('pharmacy.sell.cart.clearTitle')}
        body={t('pharmacy.sell.cart.clearBody')}
        confirmLabel={t('pharmacy.sell.cart.clear')}
        cancelLabel={t('pharmacy.sell.pay.cancel')}
        icon={<Trash2 aria-hidden className="size-4" />}
        onConfirm={clearAll}
      />
      <AskDialog
        open={leaveTo !== null}
        onOpenChange={(open) => !open && setLeaveTo(null)}
        title={t('pharmacy.sell.leave.title')}
        body={t('pharmacy.sell.leave.body')}
        confirmLabel={t('pharmacy.sell.leave.go')}
        cancelLabel={t('pharmacy.sell.leave.stay')}
        icon={<Undo2 aria-hidden className="size-4" />}
        onConfirm={() => {
          if (leaveTo) router.push(leaveTo);
        }}
      />
    </div>
  );
}

// Results -------------------------------------------------------------------------------------------------------------

/** What a result row needs of a product: the cart's item plus the flags the search sets (a `SellItem` is one). */
type ResultItem = AddableItem & { notSellable: boolean; noPrice: boolean };

function ResultList({
  items,
  currency,
  onAdd,
  addable,
  t,
  onDone,
}: {
  items: ResultItem[];
  currency: Currency;
  onAdd: (item: ResultItem, unitId?: string) => void;
  addable: (item: ResultItem) => boolean;
  t: ReturnType<typeof useT>;
  onDone?: () => void;
}) {
  return (
    <ul className="grid min-w-0 gap-2 xl:grid-cols-2" data-testid="result-list">
      {items.map((item) => {
        const ok = addable(item);
        return (
          <li key={item.productId} data-testid="result" className="flex min-w-0 flex-col gap-2 rounded-lg border border-line bg-raised p-3">
            <div className="flex min-w-0 flex-col gap-0.5">
              <p className="break-words text-base font-semibold text-text" dir="auto">
                {item.tradeName}
              </p>
              <p className="break-words text-sm text-muted" dir="auto">
                {[item.strength, item.form, item.packLabel].filter((p) => p.trim() !== '').join(' · ')}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {item.rxLevel === 'RX' && (
                <Chip icon={<Pill aria-hidden />} testId="chip-rx">
                  {t('pharmacy.sell.chip.rx')}
                </Chip>
              )}
              {item.notSellable && (
                <Chip icon={<ShieldAlert aria-hidden />} tone="danger" testId="chip-notSellable">
                  {t('pharmacy.sell.chip.notSellable')}
                </Chip>
              )}
              {item.noPrice && (
                <Chip icon={<Ban aria-hidden />} tone="danger" testId="chip-noPrice">
                  {t('pharmacy.sell.chip.noPrice')}
                </Chip>
              )}
              {item.sellableQty <= 0 && !item.notSellable && (
                <Chip icon={<PackageX aria-hidden />} tone="danger" testId="chip-outOfStock">
                  {t('pharmacy.sell.chip.outOfStock')}
                </Chip>
              )}
              {item.sellableQty > 0 && (
                <span className="text-sm text-text" data-testid="sellable-qty">
                  {t('pharmacy.sell.sellable')}: <Num>{item.sellableQty}</Num>
                </span>
              )}
            </div>
            {item.batches.length > 0 && (
              <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted" data-testid="batch-strip">
                <CalendarClock aria-hidden className="size-3.5 shrink-0" />
                {item.batches.slice(0, 3).map((b) => (
                  <span key={b.batchId} className={expirySoon(b.expiryDate) ? 'font-medium text-text' : ''}>
                    <Num>{b.lot}</Num> · <Num>{b.expiryDate.slice(0, 7)}</Num> · <Num>{b.available}</Num>
                    {expirySoon(b.expiryDate) ? ` · ${t('pharmacy.sell.chip.soon')}` : ''}
                  </span>
                ))}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              {item.units.map((unit) => {
                const priced = unit.priceMinor !== null;
                return (
                  <button
                    key={unit.id}
                    type="button"
                    data-testid="add-unit"
                    disabled={!ok || !priced}
                    onClick={() => {
                      onAdd(item, unit.id);
                      onDone?.();
                    }}
                    className={`${TOUCH} flex-1 basis-28 border border-line-strong bg-raised text-text hover:bg-hover active:bg-pressed disabled:cursor-not-allowed disabled:opacity-45`}
                  >
                    <Plus aria-hidden className="size-4" />
                    <span dir="auto">{unit.label}</span>
                    <span className="font-semibold">{priced ? <Num>{formatMinor(BigInt(unit.priceMinor!), currency)}</Num> : t('pharmacy.sell.chip.noPrice')}</span>
                  </button>
                );
              })}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

// Scans that were not simply added -----------------------------------------------------------------------------------------

/** One scan that needs the cashier: an unknown code, several matches, a product that cannot be sold now, or a lookup that failed. */
function ScanIssueCard({ issue, currency, add, dismiss, t }: { issue: ScanIssue; currency: Currency; add: (item: AddableItem, unitId?: string) => void; dismiss: () => void; t: ReturnType<typeof useT> }) {
  const o = issue.outcome;
  const dismissButton = (
    <button type="button" className={TOUCH_BTN} onClick={dismiss} data-testid="scan-dismiss">
      <X aria-hidden className="size-4" />
      {t('pharmacy.sell.scan.dismiss')}
    </button>
  );
  if (o.kind === 'pick') {
    return (
      <div className="flex flex-col gap-2" data-testid="scan-pick">
        <Note icon={<ListChecks aria-hidden />} tone="info" role="status">
          {t('pharmacy.sell.scan.pick', { code: o.code })}
        </Note>
        <ResultList items={o.items} currency={currency} onAdd={add} addable={isAddable} t={t} onDone={dismiss} />
        <div>{dismissButton}</div>
      </div>
    );
  }
  const text =
    o.kind === 'unknown' ? t('pharmacy.sell.scan.unknown', { code: o.code }) : o.kind === 'blocked' ? t('pharmacy.sell.scan.blocked', { code: o.code, name: o.item.tradeName }) : o.message;
  return (
    <div className="flex flex-wrap items-start gap-2" data-testid={`scan-${o.kind}`}>
      <div className="min-w-0 flex-1 basis-60">
        <Note icon={o.kind === 'unknown' ? <SearchX aria-hidden /> : <CircleAlert aria-hidden />} tone="danger" role="alert">
          {text}
        </Note>
      </div>
      {dismissButton}
    </div>
  );
}

// Cart rows ------------------------------------------------------------------------------------------------------------

/**
 * A quantity field that can be emptied and retyped: while the field has focus it shows what was typed (Arabic digits are
 * turned into Latin ones as they go in, anything else is dropped); a number from 1 is passed on, an empty field waits, and
 * leaving the field shows the line's real quantity again.
 */
function QtyInput({ value, label, onCommit }: { value: number; label: string; onCommit: (qty: number) => void }) {
  const [typed, setTyped] = useState<string | null>(null);
  return (
    <input
      className="min-h-11 w-14 min-w-0 border-y border-line-strong bg-raised text-center text-base font-semibold text-text"
      dir="ltr"
      inputMode="numeric"
      autoComplete="off"
      aria-label={label}
      data-testid="qty-input"
      value={typed ?? String(value)}
      onFocus={(event) => event.target.select()}
      onChange={(event) => {
        const text = normalizeDigits(event.target.value).replace(/D/g, '');
        setTyped(text);
        const qty = parseQtyText(text);
        if (qty !== null) onCommit(qty);
      }}
      onBlur={() => setTyped(null)}
    />
  );
}

function DiscountEditor({
  label,
  value,
  currency,
  testId,
  t,
  onChange,
}: {
  label: string;
  value: DiscountDraft | null;
  currency: Currency;
  testId: string;
  t: ReturnType<typeof useT>;
  onChange: (discount: DiscountDraft | null) => void;
}) {
  const draft = value ?? { kind: 'percent' as const, value: '' };
  return (
    <div className="flex flex-wrap items-end gap-2" data-testid={testId}>
      <Field label={label} className="min-w-0 flex-1 basis-32">
        <FieldInput
          className={FIELD}
          dir="ltr"
          inputMode="decimal"
          autoComplete="off"
          value={draft.value}
          onChange={(event) => onChange(event.target.value === '' ? null : { ...draft, value: event.target.value })}
        />
      </Field>
      <div role="group" aria-label={t('pharmacy.sell.discount.kind')} className="flex gap-1">
        {(['percent', 'amount'] as const).map((kind) => (
          <button
            key={kind}
            type="button"
            aria-pressed={draft.kind === kind}
            onClick={() => onChange({ ...draft, kind })}
            className={`${TOUCH} border ${draft.kind === kind ? 'border-ink bg-ink text-on-ink' : 'border-line-strong bg-raised text-text hover:bg-hover'}`}
          >
            {kind === 'percent' ? '%' : currency}
          </button>
        ))}
      </div>
    </div>
  );
}

function CartRow({
  line,
  currency,
  total,
  over,
  perms,
  t,
  dispatch,
}: {
  line: CartLine;
  currency: Currency;
  total: { totalMinor: bigint; unpriced: boolean; invalid: boolean } | undefined;
  over: boolean;
  perms: SellPerms;
  t: ReturnType<typeof useT>;
  dispatch: (action: Parameters<typeof cartReducer>[1]) => void;
}) {
  const unit = unitOf(line);
  return (
    <li data-testid="cart-line" data-blocked={line.blocked ?? undefined} className="flex min-w-0 flex-col gap-2 py-3 first:pt-0">
      <div className="flex min-w-0 items-start justify-between gap-2">
        <p className="min-w-0">
          <span className="block break-words text-base font-semibold text-text" dir="auto">
            {line.name}
          </span>
          {line.detail && (
            <span className="block break-words text-sm text-muted" dir="auto">
              {line.detail}
            </span>
          )}
        </p>
        <button type="button" className={TOUCH_BTN} aria-label={t('pharmacy.sell.cart.remove', { name: line.name })} data-testid="remove-line" onClick={() => dispatch({ type: 'remove', key: line.key })}>
          <Trash2 aria-hidden className="size-4" />
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {line.blocked && (
          <Chip icon={<Ban aria-hidden />} tone="danger" testId="chip-blocked">
            {t(`pharmacy.sell.line.blocked.${line.blocked}`)}
          </Chip>
        )}
        {line.rxLevel === 'RX' && (
          <Chip icon={<Pill aria-hidden />}>{t('pharmacy.sell.chip.rx')}</Chip>
        )}
        {unit.priceMinor === null && !line.blocked && (
          <Chip icon={<Ban aria-hidden />} tone="danger">
            {t('pharmacy.sell.chip.noPrice')}
          </Chip>
        )}
        {over && (
          <Chip icon={<TriangleAlert aria-hidden />} tone="danger" testId="chip-over">
            {t('pharmacy.sell.chip.over', { qty: line.sellableQty })}
          </Chip>
        )}
        {line.batchId && (
          <Chip icon={<CalendarClock aria-hidden />}>
            {t('pharmacy.sell.batch.chosen')} <Num>{line.batchLot}</Num>
          </Chip>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center" role="group" aria-label={t('pharmacy.sell.cart.qty')}>
          <button type="button" className={TOUCH_BTN} aria-label={t('pharmacy.sell.cart.less')} data-testid="qty-less" disabled={line.qty <= 1} onClick={() => dispatch({ type: 'step', key: line.key, delta: -1 })}>
            <Minus aria-hidden className="size-4" />
          </button>
          <QtyInput value={line.qty} label={t('pharmacy.sell.cart.qty')} onCommit={(qty) => dispatch({ type: 'qty', key: line.key, qty })} />
          <button type="button" className={TOUCH_BTN} aria-label={t('pharmacy.sell.cart.more')} data-testid="qty-more" onClick={() => dispatch({ type: 'step', key: line.key, delta: 1 })}>
            <Plus aria-hidden className="size-4" />
          </button>
        </div>
        <span className="ms-auto text-md font-semibold text-text" data-testid="line-total">
          {total && !total.unpriced ? (
            <>
              <Num>{formatMinor(total.totalMinor, currency)}</Num> {currency}
            </>
          ) : (
            '—'
          )}
        </span>
        {line.units.length > 1 ? (
          <select
            className={`${FIELD} basis-full pe-8`}
            aria-label={t('pharmacy.sell.cart.unit')}
            data-testid="unit-select"
            value={line.unitId}
            onChange={(event) => dispatch({ type: 'unit', key: line.key, unitId: event.target.value })}
          >
            {line.units.map((u) => (
              <option key={u.id} value={u.id}>
                {u.label}
                {u.priceMinor !== null ? ` · ${formatMinor(BigInt(u.priceMinor), currency)}` : ''}
              </option>
            ))}
          </select>
        ) : (
          <span className="text-sm text-muted" dir="auto">
            {unit.label}
          </span>
        )}
      </div>
      {(perms.discount || (perms.batchOverride && line.batches.length > 0)) && (
        <details className="min-w-0" data-testid="line-more">
          <summary className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-md px-2 text-sm font-medium text-text underline underline-offset-2 hover:bg-hover">
            <Tag aria-hidden className="size-4 shrink-0" />
            {t('pharmacy.sell.cart.more.open')}
          </summary>
          <div className="mt-2 flex flex-col gap-3 rounded-md border border-line bg-surface p-3">
            {perms.discount && (
              <DiscountEditor label={t('pharmacy.sell.discount.line')} value={line.discount} currency={currency} testId="line-discount" t={t} onChange={(discount) => dispatch({ type: 'discount', key: line.key, discount })} />
            )}
            {perms.batchOverride && line.batches.length > 0 && (
              <>
                <Field label={t('pharmacy.sell.batch.label')} hint={t('pharmacy.sell.batch.hint')}>
                  <FieldSelect
                    className={`${FIELD} pe-8`}
                    data-testid="batch-select"
                    value={line.batchId ?? ''}
                    onChange={(event) => {
                      const b = line.batches.find((x) => x.batchId === event.target.value);
                      dispatch({ type: 'batch', key: line.key, batchId: b?.batchId ?? null, lot: b?.lot ?? '', reason: line.batchReason });
                    }}
                  >
                    <option value="">{t('pharmacy.sell.batch.auto')}</option>
                    {line.batches.map((b) => (
                      <option key={b.batchId} value={b.batchId}>
                        {b.lot} · {b.expiryDate.slice(0, 7)} · {b.available}
                      </option>
                    ))}
                  </FieldSelect>
                </Field>
                {line.batchId && (
                  <Field label={t('pharmacy.sell.batch.reason')} error={line.batchReason.trim().length < 3 ? t('pharmacy.sell.batch.reasonNeeded') : undefined}>
                    <FieldInput
                      className={FIELD}
                      dir="auto"
                      autoComplete="off"
                      maxLength={300}
                      data-testid="batch-reason"
                      value={line.batchReason}
                      onChange={(event) => dispatch({ type: 'batch', key: line.key, batchId: line.batchId, lot: line.batchLot, reason: event.target.value })}
                    />
                  </Field>
                )}
              </>
            )}
          </div>
        </details>
      )}
    </li>
  );
}

export type { CartState };
