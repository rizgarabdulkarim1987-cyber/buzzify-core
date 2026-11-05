'use client';

import { Barcode, CircleAlert, CloudOff, Undo2 } from 'lucide-react';
import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { sellSearch } from '@/app/pharmacy/_actions/sales';
import type { SellItem } from '@/server/pharmacy/sell-search';
import { useLocale, useT } from '@/studio/i18n';
import { NETWORK_FAILURE, settle } from '@/studio/settle';
import { OpenShiftPanel, type OpenShift } from '../OpenShiftPanel';
import { phMessage } from '../ph-failure';
import { cashierKeyOf, type CashierKey } from '../sell-keys';
import { draftKey, estimateCart, formatMinor, scanOutcome, type Currency } from '../sell-logic';
import { Note, Num } from '../sell-parts';
import type { SellScreenProps } from '../sell-props';
import { initialReceipts, MAX_RECEIPTS, receiptsKey, serializeReceipts } from '../sell-receipts';
import { useOnline } from '../use-online';
import { cashierReducer, keyContextOf, restoreReceipts, type CashierPulse } from './cashier-logic';
import { PulseStrip } from './PulseStrip';
import { ReceiptTabs } from './ReceiptTabs';
import { useScanQueue } from './use-scan-queue';

export interface CashierScreenProps extends SellScreenProps {
  /** The header chips, read by the page (`ph.pulse`). */
  pulse: CashierPulse;
}

type Message = { tone: 'danger' | 'info'; text: string };

/**
 * The cashier (layout A of docs/pharmacy/prototypes/cashier-layouts-2026-11-05.html): the shift gate first, then the header
 * strip, and a grid whose FIRST child is the side column (370px), so in RTL it sits on the physical right (the keypad goes
 * there), with the main column beside it: receipt tabs, the scan field, an inline message line, the sale lines. No dialog,
 * no motion. Up to MAX_RECEIPTS receipts are open at once and kept on this device per pharmacy, branch, person and currency.
 * The lines table, side column, inline flows and inquiry come in later tasks; this is the frame they fill.
 */
export function CashierScreen(props: CashierScreenProps) {
  const { restaurantId, branchId, userId, settings, pulse } = props;
  const t = useT();
  const { locale } = useLocale();
  const online = useOnline();
  const [shift, setShift] = useState<OpenShift | null>(props.shift);
  const [state, dispatch] = useReducer(cashierReducer, undefined, initialReceipts);
  const [loaded, setLoaded] = useState(false);
  const [restored, setRestored] = useState(false);
  const [notSent, setNotSent] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);
  const [query, setQuery] = useState('');
  const searchBox = useRef<HTMLInputElement>(null);

  const currency: Currency = shift?.currency ?? settings.defaultCurrency;
  const step = Number(settings.roundingStepMinor);
  const receipt = state.receipts[state.active] ?? state.receipts[0]!;
  const estimate = useMemo(() => estimateCart(receipt.cart, currency, step), [receipt.cart, currency, step]);
  const anyLines = state.receipts.some((r) => !r.done && r.cart.lines.length > 0);

  // The receipts live on this device ------------------------------------------------------------------------------------
  const storeKey = receiptsKey(restaurantId, branchId, userId, currency);
  const legacyKey = draftKey(restaurantId, branchId, userId, currency);
  useEffect(() => {
    if (!shift || loaded) return;
    try {
      const kept = restoreReceipts(window.localStorage.getItem(storeKey), window.localStorage.getItem(legacyKey));
      dispatch({ type: 'load', state: kept.state });
      if (kept.migrated) {
        // Written first, then the old key removed: the old draft can never come back as a second copy of a cart sold here.
        window.localStorage.setItem(storeKey, serializeReceipts(kept.state));
        window.localStorage.removeItem(legacyKey);
      }
      // eslint-disable-next-line react-hooks/set-state-in-effect -- the receipts are read from this device's storage once, after the shift is known
      if (kept.state.receipts.some((r) => r.cart.lines.length > 0)) setRestored(true);
    } catch {
      /* storage can be blocked: the receipts simply start empty */
    }
    setLoaded(true);
  }, [shift, loaded, storeKey, legacyKey]);
  useEffect(() => {
    if (!shift || !loaded) return;
    try {
      window.localStorage.setItem(storeKey, serializeReceipts(state));
    } catch {
      /* the receipts on the device are a convenience */
    }
  }, [shift, loaded, state, storeKey]);

  useEffect(() => {
    if (!anyLines) return;
    const before = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', before);
    return () => window.removeEventListener('beforeunload', before);
  }, [anyLines]);

  // Scans go to the active receipt, one at a time, in order ------------------------------------------------------------
  useScanQueue(async (code) => {
    const result = await settle(() => sellSearch({ q: code, currency }));
    if (!result.ok) {
      const lost = result.error.message === NETWORK_FAILURE;
      if (lost) setNotSent(true);
      setMessage({ tone: 'danger', text: lost ? t('pharmacy.sell.scan.failed', { code }) : phMessage(t, locale, result.error, 'pharmacy.sell') });
      return;
    }
    setNotSent(false);
    const outcome = scanOutcome(code, (result.data as { items: SellItem[] }).items);
    if (outcome.kind === 'add') {
      dispatch({ type: 'line', action: { type: 'add', item: outcome.item } });
      setMessage(null);
    } else if (outcome.kind === 'blocked') setMessage({ tone: 'danger', text: t('pharmacy.sell.scan.blocked', { code, name: outcome.item.tradeName }) });
    else setMessage({ tone: 'danger', text: t(`pharmacy.sell.scan.${outcome.kind}`, { code }) });
  }, shift !== null && loaded);

  // Keys -----------------------------------------------------------------------------------------------------------------
  const focusSearch = () => {
    searchBox.current?.focus();
    searchBox.current?.select();
  };
  const openReceipt = () => {
    if (state.receipts.length >= MAX_RECEIPTS && !receipt.done) {
      setMessage({ tone: 'danger', text: t('pharmacy.cashier.tabs.max', { max: MAX_RECEIPTS }) });
      return;
    }
    dispatch({ type: 'open' });
    setMessage(null);
    searchBox.current?.focus();
  };
  const run = (key: CashierKey) => {
    if (key.kind === 'switch') dispatch({ type: 'switch', index: key.index });
    else if (key.kind === 'switchRel') dispatch({ type: 'switch', index: state.active + key.delta });
    else if (key.kind === 'new') openReceipt();
    else if (key.kind === 'focusScan') focusSearch();
    else if (key.kind === 'escape') {
      setQuery('');
      setMessage(null);
      searchBox.current?.focus();
    }
    // Pay, credit, unit, inquiry, hold, discount and the line keys arrive with the side column, table and work panel.
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!shift) return;
      const key = cashierKeyOf(event, keyContextOf(event.target, searchBox.current));
      if (!key || key.kind === 'addTop') return;
      // Every cashier key is ours: the browser must not search (F3), focus its address bar (F6), go back (Alt+Left) or switch its own tabs (Alt+1..6).
      event.preventDefault();
      run(key);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const find = (name: string) => {
    setQuery(name);
    searchBox.current?.focus();
  };

  // Render ---------------------------------------------------------------------------------------------------------------
  if (!shift) {
    return <OpenShiftPanel currencies={settings.enabledCurrencies as Currency[]} defaultCurrency={settings.defaultCurrency} onOpened={setShift} />;
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 overflow-y-auto p-2 sm:p-3" data-testid="cashier-screen">
      <h1 className="sr-only">{t('pharmacy.cashier.title')}</h1>
      <header className="min-w-0">
        <PulseStrip pulse={pulse} currency={currency} onFind={find} />
      </header>
      {(!online || notSent) && (
        <Note look="ph" icon={<CloudOff aria-hidden />} tone="danger" role="alert" testId="cashier-offline">
          {t('pharmacy.cashier.offline')}
        </Note>
      )}
      {restored && anyLines && (
        <Note look="ph" icon={<Undo2 aria-hidden />} tone="info" role="status" testId="cashier-restored">
          {t('pharmacy.cashier.restored')}
        </Note>
      )}

      {/* The side column is the grid's FIRST child: in RTL the first column is on the physical right, where the keypad belongs. */}
      <div className="grid min-w-0 items-start gap-2 lg:grid-cols-[370px_minmax(0,1fr)] lg:[grid-template-areas:'side_main']" data-testid="cashier-grid">
        <aside className="flex min-w-0 flex-col gap-2 lg:[grid-area:side]" aria-label={t('pharmacy.cashier.side.region')} data-testid="cashier-side">
          <div className="flex flex-col gap-0.5 rounded-ph-2xl bg-ph-g8 px-4 py-3 text-ph-on-green" data-testid="cashier-total">
            <span className="text-sm text-ph-on-green-muted">{t('pharmacy.cashier.total.due')}</span>
            <span className="break-words text-[44px] font-extrabold leading-tight tabular-nums">
              <Num>{formatMinor(estimate.totalMinor, currency)}</Num> <span className="text-base font-semibold">{currency}</span>
            </span>
            <span className="text-sm text-ph-on-green-muted">
              {t('pharmacy.cashier.total.count')}: <Num>{receipt.cart.lines.length}</Num>
            </span>
          </div>
        </aside>

        <section className="flex min-w-0 flex-col gap-2 lg:[grid-area:main]" aria-label={t('pharmacy.cashier.main.region')} data-testid="cashier-main">
          <ReceiptTabs
            receipts={state.receipts}
            active={state.active}
            currency={currency}
            roundingStep={step}
            onSwitch={(index) => dispatch({ type: 'switch', index })}
            onClose={(index) => dispatch({ type: 'close', index })}
            onOpen={openReceipt}
          />
          <div className="relative min-w-0">
            <Barcode aria-hidden className="pointer-events-none absolute start-3.5 top-1/2 size-5 -translate-y-1/2 text-ph-muted" />
            <input
              ref={searchBox}
              type="search"
              dir="auto"
              autoComplete="off"
              autoFocus
              enterKeyHint="search"
              aria-label={t('pharmacy.cashier.scan.label')}
              placeholder={t('pharmacy.cashier.scan.placeholder')}
              className="min-h-12 w-full min-w-0 rounded-ph-xl border-2 border-ph-accent bg-ph-card pe-4 ps-11 text-[17px] text-ph-text"
              data-testid="cashier-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          {message && (
            <Note look="ph" icon={<CircleAlert aria-hidden />} tone={message.tone} role="status" testId="cashier-message">
              {message.text}
            </Note>
          )}
          <div className="min-h-[210px] min-w-0 overflow-auto rounded-ph-xl border border-ph-line bg-ph-card" data-testid="cashier-lines">
            {receipt.cart.lines.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-ph-muted">{t('pharmacy.cashier.lines.empty')}</p>
            ) : (
              <ol className="divide-y divide-ph-line text-sm text-ph-text">
                {receipt.cart.lines.map((line) => (
                  <li key={line.key} className="flex min-w-0 justify-between gap-3 px-3 py-2">
                    <span className="min-w-0 truncate">{line.name}</span>
                    <Num>× {line.qty}</Num>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
