'use client';

import { useCallback, useRef, useState } from 'react';
import { useT } from '@/studio/i18n';
import type { CartLine } from '../sell-logic';
import { padQty, padText, type CashierAction } from './cashier-logic';
import type { PadFunctions, PadLineKey } from './Keypad';
import type { Message } from './use-adding';
import type { PadSink, PadSlot } from './WorkParts';

/** The line keys that change the receipt (a quantity or a removal): never while a panel is open. */
export const changesLine = (kind: string): boolean => kind === 'qtyUp' || kind === 'qtyDown' || kind === 'remove';

/**
 * The side keypad's routing. With no panel open the digits build a quantity for the selected line (one text per receipt and
 * line) and the check key applies it. While a panel is open it never changes a quantity: a payment or discount panel takes the
 * keys through its sink (`PadSlot`: the amount received, paid now, the discount; the check key confirms it), any other panel
 * says to close it first. Whatever was typed is dropped when a panel opens or closes, so digits typed before F2 never come back
 * as a quantity afterwards. The line buttons are the arrow, + - and Delete keys (`run`), which refuse a change while a panel is open.
 */
export function usePad(o: {
  receiptKey: string;
  selected: string | null;
  selectedLine: CartLine | null;
  panelOpen: boolean;
  edit: (action: CashierAction) => boolean;
  say: (m: Message | null) => void;
  focusField: () => void;
  run: (key: { kind: PadLineKey }) => boolean;
  /** The function keys (calculator, inquiry, return, cart), wired by the screen. */
  fn: PadFunctions;
}) {
  const t = useT();
  const { panelOpen, selectedLine } = o;
  const [state, setState] = useState<{ at: string; text: string }>({ at: '', text: '' });
  // A panel opening or closing drops what was typed (a state change during render, React's "adjust state when a value changes").
  const [openSeen, setOpenSeen] = useState(panelOpen);
  if (openSeen !== panelOpen) {
    setOpenSeen(panelOpen);
    setState({ at: '', text: '' });
  }
  const at = `${o.receiptKey}:${o.selected}`;
  const text = state.at === at ? state.text : '';
  const sink = useRef<PadSink | null>(null);
  const slot = useCallback<PadSlot>((next) => void (sink.current = next), []);
  const closeFirst = () => o.say({ tone: 'info', text: t('pharmacy.cashier.keypad.panelOpen') });

  const applyQty = () => {
    const qty = padQty(text);
    if (!selectedLine) {
      o.say({ tone: 'info', text: t('pharmacy.cashier.keypad.noLine') });
      return;
    }
    if (qty === null || !o.edit({ type: 'line', action: { type: 'qty', key: selectedLine.key, qty } })) return;
    setState({ at, text: '' });
    o.say(null);
  };
  const onKey = (key: string) => {
    if (panelOpen) return void (sink.current ? sink.current.key(key) : closeFirst());
    setState({ at, text: padText(text, key) });
    o.focusField();
  };
  const onEnter = () => {
    if (panelOpen) return void (sink.current ? sink.current.enter() : closeFirst());
    applyQty();
    o.focusField();
  };
  const onLine = (kind: PadLineKey) => {
    if (changesLine(kind) && !panelOpen && !selectedLine) o.say({ tone: 'info', text: t('pharmacy.cashier.keypad.noLine') });
    else o.run({ kind });
  };
  // The display: what was typed, else the selected line's quantity (the prototype's big quantity box), "-" with no line; empty
  // while a panel takes the keys.
  const shown = panelOpen ? '' : text !== '' ? text : selectedLine ? String(selectedLine.qty) : '-';
  return {
    pad: { text: shown, typed: !panelOpen && text !== '', onKey, onEnter, canEnter: panelOpen || text !== '', onLine, fn: o.fn },
    slot,
    /** Says why a line change is refused while a panel is open; true when it was refused. */
    refuseWhileOpen: (kind: string): boolean => changesLine(kind) && panelOpen && (closeFirst(), true),
  };
}
