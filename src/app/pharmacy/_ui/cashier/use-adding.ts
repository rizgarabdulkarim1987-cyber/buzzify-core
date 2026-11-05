'use client';

import type { Dispatch, MutableRefObject } from 'react';
import { sellSearch } from '@/app/pharmacy/_actions/sales';
import type { SellItem } from '@/server/pharmacy/sell-search';
import { useLocale, useT } from '@/studio/i18n';
import { NETWORK_FAILURE, settle } from '@/studio/settle';
import { phMessage } from '../ph-failure';
import { emptyCart, isAddable, normalizeDigits, scanOutcome, type AddableItem, type Currency } from '../sell-logic';
import { MAX_RECEIPTS, type ReceiptsState } from '../sell-receipts';
import { addActionFor, addedKey, cashierReducer, frozenEdit, frozenWhy, type CashierAction, type ScanUnitPref } from './cashier-logic';
import { handInPlace } from './flows-logic';
import { useScanQueue } from './use-scan-queue';

/** A sentence in the screen's inline message line. */
export type Message = { tone: 'danger' | 'info' | 'success'; text: string };

/** An item handed in by unit id from another screen (`?add=`, the cart bridge): its unit and how many. */
export interface HandedIn {
  unitId: string;
  qty: number;
}

/**
 * Putting items on the receipts: scans (one at a time, in order), Enter in the field, a picked suggestion and items handed in from
 * other screens all go through `addItem`, which selects the line the item landed on. A receipt frozen by its sale takes nothing:
 * a scan is refused and said; an item handed in goes to a new receipt instead (refused and said when none can open).
 */
export function useAdding(o: {
  currency: Currency;
  enabled: boolean;
  /** The receipts and selections as they are right now, ahead of the next render (the screen's mirrors). */
  mirror: MutableRefObject<ReceiptsState>;
  picks: MutableRefObject<Record<string, string | null>>;
  select: (key: string | null, receiptKey: string) => void;
  scanUnit: ScanUnitPref;
  dispatch: Dispatch<CashierAction>;
  say: (message: Message | null) => void;
  setNotSent: (on: boolean) => void;
  query: string;
  /** The typed text was used: the field is emptied and focused again. */
  used: () => void;
  focus: () => void;
}) {
  const { currency, mirror: mirrorRef, picks, select, scanUnit, dispatch, say, setNotSent } = o;
  const t = useT();
  const { locale } = useLocale();

  const lookupFailed = (error: Parameters<typeof phMessage>[2], code: string, failedKey = 'pharmacy.sell.scan.failed') => {
    const lost = error.message === NETWORK_FAILURE;
    if (lost) setNotSent(true);
    say({ tone: 'danger', text: lost ? t(failedKey, { code }) : phMessage(t, locale, error, 'pharmacy.sell') });
  };

  /**
   * Puts the item on the active receipt and selects the line it landed on (a new line, or the existing one whose quantity grew). The
   * unit preference counts only while no line is selected. True when added.
   */
  const addItem = (item: AddableItem, handIn?: HandedIn): boolean => {
    let cur = mirrorRef.current;
    const before = cur.receipts[cur.active]!;
    const hasSelection = before.cart.lines.some((l) => l.key === picks.current[before.key]);
    const action: CashierAction = { type: 'line', action: handIn ? { type: 'add', item, unitId: handIn.unitId, qty: handIn.qty } : addActionFor(item, hasSelection ? 'default' : scanUnit) };
    if (frozenEdit(cur, action)) {
      if (!handIn || handInPlace(cur) !== 'new') {
        const why = frozenWhy(cur);
        say({ tone: 'danger', text: handIn ? t('pharmacy.cashier.handIn.frozen', { name: item.tradeName, max: MAX_RECEIPTS }) : why === 'pharmacy.cashier.frozen' ? t('pharmacy.cashier.frozenScan', { name: item.tradeName }) : t(why) });
        return false;
      }
      cur = cashierReducer(cur, { type: 'open' });
      mirrorRef.current = cur;
      dispatch({ type: 'open' });
    }
    const r = cur.receipts[cur.active]!;
    const next = cashierReducer(cur, action);
    mirrorRef.current = next;
    dispatch(action);
    const landed = next.receipts[next.active]!;
    const key = addedKey(r.done ? emptyCart() : r.cart, landed.cart);
    if (key) select(key, landed.key);
    say(null);
    return true;
  };

  /** A scanned or typed barcode: the one exact match is added; blocked, unknown and several matches are said. True when added. */
  const takeBarcode = (code: string, items: SellItem[]): boolean => {
    const outcome = scanOutcome(code, items);
    if (outcome.kind === 'add') return addItem(outcome.item);
    if (outcome.kind === 'blocked') say({ tone: 'danger', text: t('pharmacy.sell.scan.blocked', { code, name: outcome.item.tradeName }) });
    else say({ tone: 'danger', text: t(`pharmacy.sell.scan.${outcome.kind}`, { code }) });
    return false;
  };
  useScanQueue(async (code) => {
    const result = await settle(() => sellSearch({ q: code, currency }));
    if (!result.ok) {
      lookupFailed(result.error, code);
      return;
    }
    setNotSent(false);
    takeBarcode(code, (result.data as { items: SellItem[] }).items);
  }, o.enabled);

  /** Enter in the field adds the top sellable result of what was typed; digits only go through the exact barcode path. */
  const addTop = async () => {
    const typed = o.query.trim();
    if (typed === '') return;
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
      if (takeBarcode(q, (result.data as { items: SellItem[] }).items)) o.used();
      return;
    }
    const top = (result.data as { items: SellItem[] }).items.find(isAddable);
    if (!top) {
      say({ tone: 'danger', text: t('pharmacy.sell.empty', { q }) });
      return;
    }
    if (addItem(top)) o.used();
    else o.focus();
  };

  return { addItem, addTop, lookupFailed };
}
