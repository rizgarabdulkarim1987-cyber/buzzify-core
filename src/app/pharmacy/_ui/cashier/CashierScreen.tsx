'use client';

import { CircleAlert, CloudOff, Undo2 } from 'lucide-react';
import { useEffect, useId, useMemo, useReducer, useRef, useState } from 'react';
import type { PhRole } from '@/server/domain/pharmacy/permissions';
import { useT } from '@/studio/i18n';
import type { PickedCustomer } from '../CustomerPicker';
import { OpenShiftPanel, type OpenShift } from '../OpenShiftPanel';
import { RxCartPanel } from '../SellRx';
import { cashierKeyOf, type CashierKey } from '../sell-keys';
import { estimateCart, formatMinor, overSellable, unitOf, type Currency } from '../sell-logic';
import { Note, Num } from '../sell-parts';
import type { SellScreenProps } from '../sell-props';
import { initialReceipts, MAX_RECEIPTS } from '../sell-receipts';
import { useOnline } from '../use-online';
import { cashierReducer, frozenEdit, keyContextOf, lineKeyEffect, moveSuggestion, nextScanUnitPref, padQty, padText, unitKeyEffect, type CashierAction, type CashierPulse, type ScanUnitPref, type Suggestion } from './cashier-logic';
import { CashierToolbar, LeaveNote } from './CashierToolbar';
import { cashierOps } from './flows-logic';
import { OtherFlow } from './OtherFlow';
import { PulseStrip } from './PulseStrip';
import { ReceiptTabs } from './ReceiptTabs';
import { SaleLinesTable } from './SaleLinesTable';
import { ScanBar } from './ScanBar';
import { SideColumn } from './SideColumn';
import { rxLinesOf } from './sale-flow-logic';
import { Suggestions, suggestionId } from './Suggestions';
import { useAdding, type Message } from './use-adding';
import { useHandIn } from './use-handin';
import { useHoldFlow } from './use-hold-flow';
import { useLeaveGuard } from './use-leave-guard';
import { useRxCheck } from './use-rx-check';
import { useStoredReceipts } from './use-stored-receipts';
import { useSaleFlow } from './use-sale-flow';
import { useSuggestions } from './use-suggestions';
import { WorkPanel } from './WorkPanel';

export interface CashierScreenProps extends SellScreenProps {
  /** The header chips, read by the page (`ph.pulse`). */
  pulse?: CashierPulse;
  /** Cost and profit columns: pharmacist and owner only. The lines carry no cost today, so the cells stay empty. */
  canSeeCost?: boolean;
  /** Price edit: pharmacist and owner only. */
  canEditPrice?: boolean;
  /** The person's pharmacy role: which "all operations" entries they may open (as the nav allows). None without it. */
  role?: PhRole | null;
}

/**
 * The cashier (layout A of docs/pharmacy/prototypes/cashier-layouts-2026-11-05.html): the shift gate first, then the header
 * strip, and a grid whose FIRST child is the side column (370px), so in RTL it sits on the physical right (the keypad goes
 * there), with the main column beside it: receipt tabs, the scan field, an inline message line, the sale lines. No dialog,
 * no motion. Up to MAX_RECEIPTS receipts are open at once and kept on this device per pharmacy, branch, person and currency.
 * Every flow is the work panel under the pay buttons (`WorkPanel`): paying (`useSaleFlow`), the discount, hold and the held list
 * (`useHoldFlow`), the prescription, all operations and the copy of the last receipt, opened from the toolbar row or their keys.
 * Items handed in from other screens land like scans (`useHandIn`); leaving with lines asks first (`useLeaveGuard`).
 */
export function CashierScreen(props: CashierScreenProps) {
  const { restaurantId, branchId, userId, settings, pulse, canSeeCost = false, canEditPrice = false } = props;
  const t = useT();
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
  const [padState, setPadState] = useState<{ at: string; text: string }>({ at: '', text: '' });
  const [customers, setCustomers] = useState<Record<string, PickedCustomer | null>>({});
  // The numbers of the prescriptions recorded (or checked) in this session, by id: memory only, never on the device.
  const [rxNumbers, setRxNumbers] = useState<Record<string, string>>({});
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
  const padAt = `${receipt.key}:${selected}`;
  const pad = padState.at === padAt ? padState.text : '';
  const anyLines = state.receipts.some((r) => !r.done && r.cart.lines.length > 0);
  /** A change to the active receipt; refused and said while that receipt is frozen by its sale (`frozenEdit`). True when made. */
  const edit = (action: CashierAction): boolean => {
    if (frozenEdit(mirror.current, action)) {
      setMessage({ tone: 'danger', text: t('pharmacy.cashier.frozen') });
      return false;
    }
    dispatch(action);
    return true;
  };
  /** Changes the receipts now (the mirror too, so the next change in this same event sees it) and on screen. */
  const apply = (action: CashierAction) => {
    mirror.current = cashierReducer(mirror.current, action);
    dispatch(action);
  };
  const say = (m: Message | null) => setMessage(m);

  // The receipts live on this device ------------------------------------------------------------------------------------
  const { loaded, restored, save } = useStoredReceipts({ restaurantId, branchId, userId }, currency, shift !== null, state, dispatch, anyLines);
  // Paying: the flow asked for on this receipt, its sale attempt (on the receipt, on the device) and the receipt after the sale.
  const sale = useSaleFlow({ receipt, currency, mirrorRef: mirror, dispatch, save, setNotSent, say: (text) => setMessage({ tone: 'danger', text }) });
  const pickCustomer = (customer: PickedCustomer | null) => {
    if (edit({ type: 'customer', customerId: customer?.id ?? null })) setCustomers((all) => ({ ...all, [receipt.key]: customer }));
  };

  // Scans, Enter, a picked suggestion and items handed in from other screens all land through one path (`useAdding`) ----------
  const ready = shift !== null && loaded;
  const focusField = () => searchBox.current?.focus();
  const used = () => {
    setQuery('');
    focusField();
  };
  const { addItem, addTop, lookupFailed } = useAdding({ currency, enabled: ready, mirror, picks, select, scanUnit, dispatch, say, setNotSent, query, used, focus: focusField });
  useHandIn({ currency, ready, add: addItem, lookupFailed, say, setNotSent });
  const holds = useHoldFlow({ currency, enabled: ready, mirror, apply, say, setNotSent, done: sale.close });
  const leave = useLeaveGuard(anyLines);
  const rxGone = (key: string, id: string) => {
    if (mirror.current.receipts.find((r) => r.key === key)?.prescriptionId === id) apply({ type: 'prescription', receiptKey: key, prescriptionId: null });
    say({ tone: 'danger', text: t('pharmacy.rx.gone') });
  };
  useRxCheck({ receipts: state.receipts, enabled: ready && props.perms.rx, numbers: rxNumbers, onGone: rxGone, onNumber: (id, n) => setRxNumbers((all) => ({ ...all, [id]: n })) });
  const ops = cashierOps(props.role ?? null);

  // Suggestions while typing (a list in the flow, never a dialog) ------------------------------------------------------------
  const listId = useId();
  const sugg = useSuggestions(query, currency, shift !== null && loaded);
  const [closedFor, setClosedFor] = useState<string | null>(null);
  const [activeAt, setActiveAt] = useState({ q: '', index: -1 });
  const listOpen = sugg.status !== 'idle' && closedFor !== query.trim();
  const rows: Suggestion[] = listOpen && sugg.status === 'ready' ? sugg.rows : [];
  const activeIndex = activeAt.q === query ? activeAt.index : -1;
  const pick = (row: Suggestion) => {
    if (addItem(row.item)) setQuery('');
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
   * when this returns true, so a key wired here can never be forgotten there. Pay / credit / discount with nothing to act on (or
   * no permission), hold with an empty receipt and a line key with nothing to do (arrow up on the first row, arrow down on the
   * last, + - Delete with no selection) return false and keep their browser meaning.
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
      sale.close();
      setQuery('');
      setMessage(null);
      searchBox.current?.focus();
    } else if (key.kind === 'lineUp' || key.kind === 'lineDown' || key.kind === 'qtyUp' || key.kind === 'qtyDown' || key.kind === 'remove') {
      const effect = lineKeyEffect(key.kind, receipt.cart.lines.map((l) => l.key), selected);
      if (!effect) return false;
      if ('select' in effect) {
        if (effect.select === selected) return false;
        select(effect.select);
      } else if ('step' in effect) edit({ type: 'line', action: { type: 'step', ...effect.step } });
      else if (edit({ type: 'line', action: { type: 'remove', key: effect.remove } })) select(effect.next);
    } else if (key.kind === 'unit') {
      // The unit key converts: the selected line to its next priced unit, or (no line selected) the unit the next item starts in.
      // Saying "nothing to change" is an answer too, so the key is taken from the browser either way.
      const effect = unitKeyEffect(selectedLine, currency);
      if ('set' in effect) {
        if (edit({ type: 'line', action: { type: 'unit', ...effect.set } })) setMessage(null);
      } else if ('none' in effect) setMessage({ tone: 'info', text: t('pharmacy.cashier.unit.none') });
      else setScanUnit(nextScanUnitPref);
    } else if (key.kind === 'inquiry') setInquiry((on) => !on);
    else if (key.kind === 'cash' || key.kind === 'credit') {
      // The flow opens in the work panel; nothing is sent until it is confirmed. Nothing to pay for (or no credit permission): the key keeps its browser meaning.
      if (receipt.done || receipt.cart.lines.length === 0 || (key.kind === 'credit' && !props.perms.credit)) return false;
      sale.open(key.kind);
    } else if (key.kind === 'hold') return holds.hold();
    else if (key.kind === 'discount') {
      if (!props.perms.discount || receipt.done || receipt.cart.lines.length === 0) return false;
      // A receipt being paid keeps its discount: saying so is the key's answer.
      if (receipt.attempt) setMessage({ tone: 'danger', text: t('pharmacy.cashier.frozen') });
      else sale.open('discount');
    } else return false;
    return true;
  };
  const applyPad = () => {
    const qty = padQty(pad);
    if (!selectedLine) {
      setMessage({ tone: 'info', text: t('pharmacy.cashier.keypad.noLine') });
      return;
    }
    if (qty === null || !edit({ type: 'line', action: { type: 'qty', key: selectedLine.key, qty } })) return;
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

  // The toolbar and the non-paying flows ------------------------------------------------------------------------------------
  const discard = () => {
    apply({ type: 'reset', receiptKey: receipt.key });
    sale.close();
    say({ tone: 'success', text: t('pharmacy.cashier.tools.discarded') });
    focusField();
  };
  const rxSaved = (key: string, saved: { id: string; number: string }) => {
    setRxNumbers((all) => ({ ...all, [saved.id]: saved.number }));
    apply({ type: 'prescription', receiptKey: key, prescriptionId: saved.id });
    sale.close();
    say(null);
  };
  const closeFlow = () => {
    sale.close();
    focusField();
  };
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
      <header className="flex min-w-0 flex-col gap-2">
        {pulse && <PulseStrip pulse={pulse} currency={currency} onFind={find} />}
        <CashierToolbar flow={sale.flow} canDiscard={!receipt.done && receipt.cart.lines.length > 0 && !receipt.attempt} onDiscard={discard} canReprint={sale.last !== null} canOps={ops.length > 0}
          canHold={!receipt.done && receipt.cart.lines.length > 0} holding={holds.holding} heldCount={holds.count} canDiscount={props.perms.discount && !receipt.done && receipt.cart.lines.length > 0} onOpen={sale.open} onHold={() => void holds.hold()} />
      </header>
      {leave.leaveTo && <LeaveNote onStay={leave.stay} onGo={leave.go} />}
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
          onCustomer={pickCustomer}
          stockLeft={selectedLine ? Math.floor(selectedLine.sellableQty / Math.max(1, unitOf(selectedLine).baseQty)) : null}
          pad={{ text: pad, onKey: (k) => {
              setPadState({ at: padAt, text: padText(pad, k) });
              searchBox.current?.focus();
            },
            onEnter: () => {
              applyPad();
              searchBox.current?.focus();
            }, canEnter: pad !== '' }}
          flow={sale.flow}
          payable={!receipt.done && receipt.cart.lines.length > 0}
          onPay={(f) => run({ kind: f })}
        >
          <WorkPanel sale={sale} receipt={receipt} estimate={estimate} currency={currency} settings={settings} perms={props.perms} offline={!online} customer={customers[receipt.key] ?? null} onCustomer={pickCustomer} onNext={openReceipt}
            other={<OtherFlow flow={sale.flow} receipt={receipt} estimate={estimate} currency={currency} maxPercent={settings.maxDiscountPercent} selectedLine={selectedLine} edit={edit} holds={holds} ops={ops} last={sale.last} place={{ restaurantId, branchId }} onRxSaved={rxSaved} close={closeFlow} />}
            idle={!receipt.done && <RxCartPanel lines={rxLinesOf(receipt.cart)} maxQty={settings.controlledMaxQty} attached={receipt.prescriptionId !== null} number={receipt.prescriptionId ? (rxNumbers[receipt.prescriptionId] ?? null) : null} mayDispense={props.perms.rx} onOpen={() => sale.open('rx')} onDetach={() => apply({ type: 'prescription', receiptKey: receipt.key, prescriptionId: null })} />}
          />
        </SideColumn>

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
                if (edit({ type: 'line', action: { type: 'remove', key } }) && key === selected) select(null);
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
