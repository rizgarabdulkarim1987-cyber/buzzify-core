'use client';

import { useState, type MutableRefObject } from 'react';
import { useT } from '@/studio/i18n';
import { startUnit, type AddableItem, type CartLine, type ScanItem } from '../sell-logic';
import type { ReceiptsState } from '../sell-receipts';
import { frozenEdit, frozenWhy, type CashierAction } from './cashier-logic';
import type { HandedIn, Message } from './use-adding';

/**
 * Inquiry mode and the line panels' one action. Inquiry (F7) is a mode of the screen: while on, a scan, Enter or a picked
 * suggestion SHOWS the item (`show`) instead of adding it; nothing reaches a receipt unless "add" is pressed, which adds the item
 * the way a scan does and leaves the mode. A substitute picked under the lines replaces the selected line with the same quantity
 * in the substitute's start unit (the prototype's behaviour); a receipt frozen by its sale refuses it and says why.
 */
export function usePanels(o: {
  mirror: MutableRefObject<ReceiptsState>;
  apply: (action: CashierAction) => void;
  addItem: (item: AddableItem, handIn?: HandedIn) => boolean;
  say: (message: Message | null) => void;
}) {
  const t = useT();
  const [on, setOn] = useState(false);
  const [item, setItem] = useState<ScanItem | null>(null);
  const toggle = () => {
    setOn((was) => !was);
    setItem(null);
  };
  const add = (shown: ScanItem) => {
    if (!o.addItem(shown)) return;
    setOn(false);
    setItem(null);
  };
  const replaceLine = (line: CartLine | null, sub: ScanItem) => {
    const unit = startUnit(sub);
    if (!line || !unit) return;
    const remove: CashierAction = { type: 'line', action: { type: 'remove', key: line.key } };
    if (frozenEdit(o.mirror.current, remove)) {
      o.say({ tone: 'danger', text: t(frozenWhy(o.mirror.current)) });
      return;
    }
    o.apply(remove);
    if (o.addItem(sub, { unitId: unit.id, qty: line.qty })) o.say({ tone: 'success', text: t('pharmacy.cashier.subs.replaced', { name: sub.tradeName }) });
  };
  return { inquiry: { on, item, toggle, show: setItem, add }, replaceLine };
}
