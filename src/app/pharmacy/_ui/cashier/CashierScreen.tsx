'use client';

import { CircleAlert, CloudOff, Undo2 } from 'lucide-react';
import { useEffect, useId, useMemo, useReducer, useRef, useState } from 'react';
import { sellSearch } from '@/app/pharmacy/_actions/sales';
import type { SellItem } from '@/server/pharmacy/sell-search';
import { useLocale, useT } from '@/studio/i18n';
import { NETWORK_FAILURE, settle } from '@/studio/settle';
import type { PickedCustomer } from '../CustomerPicker';
import { OpenShiftPanel, type OpenShift } from '../OpenShiftPanel';
import { phMessage } from '../ph-failure';
import { cashierKeyOf, type CashierKey } from '../sell-keys';
import { emptyCart, estimateCart, formatMinor, isAddable, normalizeDigits, overSellable, scanOutcome, unitOf, type AddableItem, type Currency } from '../sell-logic';
import { Note, Num } from '../sell-parts';
import type { SellScreenProps } from '../sell-props';
import { initialReceipts, MAX_RECEIPTS } from '../sell-receipts';
import { useOnline } from '../use-online';
import { addActionFor, addedKey, cashierReducer, keyContextOf, lineKeyEffect, moveSuggestion, nextScanUnitPref, padQty, padText, unitKeyEffect, type CashierAction, type CashierPulse, type ScanUnitPref, type Suggestion } from './cashier-logic';
import { PulseStrip } from './PulseStrip';
import { ReceiptTabs } from './ReceiptTabs';
import { SaleLinesTable } from './SaleLinesTable';
import { ScanBar } from './ScanBar';
import { SideColumn, type PayFlow } from './SideColumn';
import { Suggestions, suggestionId } from './Suggestions';
import { useScanQueue } from './use-scan-queue';
import { useStoredReceipts } from './use-stored-receipts';
import { useSuggestions } from './use-suggestions';

export interface CashierScreenProps extends SellScreenProps {
  /** The header chips, read by the page (`ph.pulse`). */
  pulse?: CashierPulse;
  /** Cost and profit columns: pharmacist and owner only. The lines carry no cost today, so the cells stay empty. */
  canSeeCost?: boolean;
  /** Price edit: pharmacist and owner only. */
  canEditPrice?: boolean;
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
  const { restaurantId, branchId, userId, settings, pulse, canSeeCost = false, canEditPrice = false } = props;
  const t = useT();
  const { locale } = useLocale();
  const online = useOnline();
  const [shift, setShift] = useState<OpenShift | null>(props.shift);
  const [state, dispatch] = useReducer(cashierReducer, undefined, initialReceipts);
  const [notSent, setNotSent] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);
  const [query, setQuery] = useState('');
  // Each receipt keeps its own selected line.
  const [selections, setSelections] = useState<Record<string, string | null>>({});
  // The unit the next scanned item starts in while no line is selected: one preference for the whole screen, not per receipt.
  const [scanUnit, setScanUnit] = useState<ScanUnitPref>('default');
  const [inquiry, setInquiry] = useState(false);
  // The payment flow asked for (the flows themselves are the next task), tied to the receipt it was asked on.
  const [flowAsk, setFlowAsk] = useState<{ receiptKey: string; flow: PayFlow } | null>(null);
  const [padState, setPadState] = useState<{ at: string; text: string }>({ at: '', text: '' });
  const [customers, setCustomers] = useState<Record<string, PickedCustomer | null>>({});
  const searchBox = useRef<HTMLInputElement>(null);

  const currency: Currency = shift?.currency ?? settings.defaultCurrency;
  const step = Number(settings.roundingStepMinor);
  const receipt = state.receipts[state.active] ?? state.receipts[0]!;
  const estimate = useMemo(() => estimateCart(receipt.cart, currency, step), [receipt.cart, currency, step]);
  const selected = receipt.cart.lines.some((l) => l.key === selections[receipt.key]) ? (selections[receipt.key] ?? null) : null;
  // What the receipts and selections are right now, ahead of the next render: a scan that lands before React re-renders still selects the right line.
  const mirror = useRef(state);
  const picks = useRef(selections);
  useEffect(() => {
    mirror.current = state;
    picks.current = selections;
  });
  const select = (key: string | null, receiptKey = receipt.key) => {
    picks.current = { ...picks.current, [receiptKey]: key };
    setSelections(picks.current);
  };
  const selectedLine = receipt.cart.lines.find((l) => l.key === selected) ?? null;
  const flow = flowAsk?.receiptKey === receipt.key ? flowAsk.flow : null;
  const padAt = `${receipt.key}:${selected}`;
  const pad = padState.at === padAt ? padState.text : '';
  const anyLines = state.receipts.some((r) => !r.done && r.cart.lines.length > 0);

  // The receipts live on this device ------------------------------------------------------------------------------------
  const { loaded, restored } = useStoredReceipts({ restaurantId, branchId, userId }, currency, shift !== null, state, dispatch);

  useEffect(() => {
    if (!anyLines) return;
    const before = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', before);
    return () => window.removeEventListener('beforeunload', before);
  }, [anyLines]);

  // Scans go to the active receipt, one at a time, in order ------------------------------------------------------------
  const lookupFailed = (error: Parameters<typeof phMessage>[2], code: string) => {
    const lost = error.message === NETWORK_FAILURE;
    if (lost) setNotSent(true);
    setMessage({ tone: 'danger', text: lost ? t('pharmacy.sell.scan.failed', { code }) : phMessage(t, locale, error, 'pharmacy.sell') });
  };
  /** Puts the item on the active receipt and selects the line it landed on (a new line, or the existing one whose quantity grew). The unit preference counts only while no line is selected. */
  const addItem = (item: AddableItem) => {
    const cur = mirror.current;
    const r = cur.receipts[cur.active]!;
    const hasSelection = r.cart.lines.some((l) => l.key === picks.current[r.key]);
    const action: CashierAction = { type: 'line', action: addActionFor(item, hasSelection ? 'default' : scanUnit) };
    const next = cashierReducer(cur, action);
    mirror.current = next;
    dispatch(action);
    const landed = next.receipts[next.active]!;
    const key = addedKey(r.done ? emptyCart() : r.cart, landed.cart);
    if (key) select(key, landed.key);
    setMessage(null);
  };
  /** A scanned or typed barcode: the one exact match is added; blocked, unknown and several matches are said. True when added. */
  const takeBarcode = (code: string, items: SellItem[]): boolean => {
    const outcome = scanOutcome(code, items);
    if (outcome.kind === 'add') addItem(outcome.item);
    else if (outcome.kind === 'blocked') setMessage({ tone: 'danger', text: t('pharmacy.sell.scan.blocked', { code, name: outcome.item.tradeName }) });
    else setMessage({ tone: 'danger', text: t(`pharmacy.sell.scan.${outcome.kind}`, { code }) });
    return outcome.kind === 'add';
  };
  useScanQueue(async (code) => {
    const result = await settle(() => sellSearch({ q: code, currency }));
    if (!result.ok) {
      lookupFailed(result.error, code);
      return;
    }
    setNotSent(false);
    takeBarcode(code, (result.data as { items: SellItem[] }).items);
  }, shift !== null && loaded);

  // Suggestions while typing (a list in the flow, never a dialog) ------------------------------------------------------------
  const listId = useId();
  const sugg = useSuggestions(query, currency, shift !== null && loaded);
  const [closedFor, setClosedFor] = useState<string | null>(null);
  const [activeAt, setActiveAt] = useState({ q: '', index: -1 });
  const listOpen = sugg.status !== 'idle' && closedFor !== query.trim();
  const rows: Suggestion[] = listOpen && sugg.status === 'ready' ? sugg.rows : [];
  const activeIndex = activeAt.q === query ? activeAt.index : -1;
  const pick = (row: Suggestion) => {
    addItem(row.item);
    setQuery('');
    searchBox.current?.focus();
  };

  // Enter in the field adds the top sellable result of what was typed ----------------------------------------------------------
  const addTop = async () => {
    const typed = query.trim();
    if (typed === '') return;
    // Digits only is a barcode: it goes through the exact-match path a scanner uses.
    const digits = normalizeDigits(typed);
    const barcode = /^\d+$/.test(digits);
    const q = barcode ? digits : typed;
    const result = await settle(() => sellSearch({ q, currency }));
    if (!result.ok) {
      lookupFailed(result.error, q);
      return;
    }
    setNotSent(false);
    if (barcode) {
      if (takeBarcode(q, (result.data as { items: SellItem[] }).items)) {
        setQuery('');
        searchBox.current?.focus();
      }
      return;
    }
    const top = (result.data as { items: SellItem[] }).items.find(isAddable);
    if (!top) {
      setMessage({ tone: 'danger', text: t('pharmacy.sell.empty', { q }) });
      return;
    }
    addItem(top);
    setQuery('');
    searchBox.current?.focus();
  };

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
  /**
   * Does what the key means and says whether it did anything. The caller takes the key from the browser (preventDefault) only
   * when this returns true, so a key wired here can never be forgotten there; a key not wired yet (hold, discount: later
   * tasks) returns false and keeps its browser meaning, as do pay / credit with nothing to pay for (or no credit
   * permission) and a line key with nothing to do
   * (arrow up on the first row, arrow down on the last, + - Delete with no selection).
   */
  const run = (key: CashierKey): boolean => {
    if (key.kind === 'switch') dispatch({ type: 'switch', index: key.index });
    else if (key.kind === 'switchRel') dispatch({ type: 'switch', index: state.active + key.delta });
    else if (key.kind === 'new') openReceipt();
    else if (key.kind === 'focusScan') focusSearch();
    else if (key.kind === 'escape') {
      // An open suggestion list closes first; Escape does its other work (clear, back to the field) when the list is closed.
      if (listOpen) {
        setClosedFor(query.trim());
        return true;
      }
      setFlowAsk(null);
      setQuery('');
      setMessage(null);
      searchBox.current?.focus();
    } else if (key.kind === 'lineUp' || key.kind === 'lineDown' || key.kind === 'qtyUp' || key.kind === 'qtyDown' || key.kind === 'remove') {
      const effect = lineKeyEffect(key.kind, receipt.cart.lines.map((l) => l.key), selected);
      if (!effect) return false;
      if ('select' in effect) {
        if (effect.select === selected) return false;
        select(effect.select);
      } else if ('step' in effect) dispatch({ type: 'line', action: { type: 'step', ...effect.step } });
      else {
        dispatch({ type: 'line', action: { type: 'remove', key: effect.remove } });
        select(effect.next);
      }
    } else if (key.kind === 'unit') {
      // The unit key converts: the selected line to its next priced unit, or (no line selected) the unit the next item starts in.
      // Saying "nothing to change" is an answer too, so the key is taken from the browser either way.
      const effect = unitKeyEffect(selectedLine, currency);
      if ('set' in effect) {
        dispatch({ type: 'line', action: { type: 'unit', ...effect.set } });
        setMessage(null);
      } else if ('none' in effect) setMessage({ tone: 'info', text: t('pharmacy.cashier.unit.none') });
      else setScanUnit(nextScanUnitPref);
    } else if (key.kind === 'inquiry') setInquiry((on) => !on);
    else if (key.kind === 'cash' || key.kind === 'credit') {
      // Only the ask is recorded here; the payment flows come next. Nothing to pay for (or no credit permission): the key keeps its browser meaning.
      if (receipt.done || receipt.cart.lines.length === 0 || (key.kind === 'credit' && !props.perms.credit)) return false;
      setFlowAsk({ receiptKey: receipt.key, flow: key.kind });
    } else return false;
    return true;
  };
  const applyPad = () => {
    const qty = padQty(pad);
    if (!selectedLine) {
      setMessage({ tone: 'info', text: t('pharmacy.cashier.keypad.noLine') });
      return;
    }
    if (qty === null) return;
    dispatch({ type: 'line', action: { type: 'qty', key: selectedLine.key, qty } });
    setPadState({ at: padAt, text: '' });
    setMessage(null);
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!shift) return;
      const key = cashierKeyOf(event, keyContextOf(event.target, searchBox.current));
      if (!key || key.kind === 'addTop') return;
      // A key that did something is ours: the browser must not focus its address bar (F6), go back (Alt+Left) or switch its own tabs (Alt+1..6).
      if (run(key)) event.preventDefault();
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
        {pulse && <PulseStrip pulse={pulse} currency={currency} onFind={find} />}
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
        <SideColumn
          currency={currency}
          totalMinor={estimate.totalMinor}
          discountMinor={estimate.lineDiscountMinor + estimate.invoiceDiscountMinor}
          lineCount={receipt.cart.lines.length}
          usdRate={pulse?.usdRate ?? null}
          receiptNo={state.active + 1}
          canCredit={props.perms.credit}
          customer={customers[receipt.key] ?? null}
          onCustomer={(customer) => {
            setCustomers((all) => ({ ...all, [receipt.key]: customer }));
            dispatch({ type: 'customer', customerId: customer?.id ?? null });
          }}
          stockLeft={selectedLine ? Math.floor(selectedLine.sellableQty / Math.max(1, unitOf(selectedLine).baseQty)) : null}
          pad={{ text: pad, onKey: (k) => {
              setPadState({ at: padAt, text: padText(pad, k) });
              searchBox.current?.focus();
            },
            onEnter: () => {
              applyPad();
              searchBox.current?.focus();
            }, canEnter: pad !== '' }}
          flow={flow}
          payable={!receipt.done && receipt.cart.lines.length > 0}
          onPay={(f) => {
            run({ kind: f });
            searchBox.current?.focus();
          }}
        />

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
          <ScanBar
            inputRef={searchBox}
            query={query}
            onQuery={setQuery}
            onEnter={() => {
              const row = rows[activeIndex];
              if (row && row.reason === null) pick(row);
              else void addTop();
            }}
            suggest={{ open: rows.length > 0, listId, activeId: activeIndex >= 0 ? suggestionId(listId, activeIndex) : undefined, onMove: (d) => setActiveAt({ q: query, index: moveSuggestion(rows, activeIndex, d) }) }}
            unitLabel={selectedLine ? unitOf(selectedLine).label : t(`pharmacy.cashier.unit.pref.${scanUnit}`)}
            unitPrice={
              selectedLine ? (
                unitOf(selectedLine).priceMinor === null ? (
                  t('pharmacy.sell.chip.noPrice')
                ) : (
                  <>
                    <Num>{formatMinor(BigInt(unitOf(selectedLine).priceMinor!), currency)}</Num> {currency}
                  </>
                )
              ) : (
                t('pharmacy.cashier.unit.next')
              )
            }
            onUnit={() => {
              run({ kind: 'unit' });
              searchBox.current?.focus();
            }}
            inquiry={inquiry}
            onInquiry={() => run({ kind: 'inquiry' })}
          />
          <Suggestions state={listOpen ? sugg : { status: 'idle' }} query={query} currency={currency} listId={listId} active={activeIndex} onPick={pick} />
          {message && (
            <Note look="ph" icon={<CircleAlert aria-hidden />} tone={message.tone} role="status" testId="cashier-message">
              {message.text}
            </Note>
          )}
          {receipt.cart.lines.length === 0 ? (
            <div className="min-h-[210px] min-w-0 rounded-ph-xl border border-ph-line bg-ph-card" data-testid="cashier-lines">
              <p className="px-4 py-8 text-center text-sm text-ph-muted">{t('pharmacy.cashier.lines.empty')}</p>
            </div>
          ) : (
            <SaleLinesTable
              lines={receipt.cart.lines}
              results={estimate.lines}
              currency={currency}
              selected={selected}
              over={overSellable(receipt.cart)}
              onSelect={select}
              onRemove={(key) => {
                dispatch({ type: 'line', action: { type: 'remove', key } });
                if (key === selected) select(null);
              }}
              canSeeCost={canSeeCost}
              canEditPrice={canEditPrice}
            />
          )}
        </section>
      </div>
    </div>
  );
}
