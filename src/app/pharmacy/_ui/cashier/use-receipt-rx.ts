'use client';

import { useState, type MutableRefObject } from 'react';
import { useT } from '@/studio/i18n';
import type { ReceiptsState } from '../sell-receipts';
import { frozenEdit, frozenWhy, type CashierAction } from './cashier-logic';
import type { Message } from './use-adding';
import { useRxCheck } from './use-rx-check';

/**
 * The receipts' prescriptions: the numbers recorded or checked in this session (memory only, never on the device), a restored
 * prescription read again (`useRxCheck`: gone, the receipt lets it go and the screen says so), and a newly recorded one put on
 * its receipt unless that receipt froze meanwhile (said). `saved` says whether it went on (the open prescription form closes).
 */
export function useReceiptRx(o: { mirror: MutableRefObject<ReceiptsState>; receipts: ReceiptsState['receipts']; enabled: boolean; apply: (action: CashierAction) => void; say: (m: Message | null) => void }) {
  const t = useT();
  const { mirror, apply, say } = o;
  const [numbers, setNumbers] = useState<Record<string, string>>({});
  const gone = (key: string, id: string) => {
    if (mirror.current.receipts.find((r) => r.key === key)?.prescriptionId === id) apply({ type: 'prescription', receiptKey: key, prescriptionId: null });
    say({ tone: 'danger', text: t('pharmacy.rx.gone') });
  };
  useRxCheck({ receipts: o.receipts, enabled: o.enabled, numbers, onGone: gone, onNumber: (id, n) => setNumbers((all) => ({ ...all, [id]: n })) });
  const saved = (key: string, rx: { id: string; number: string }): boolean => {
    setNumbers((all) => ({ ...all, [rx.id]: rx.number }));
    const action: CashierAction = { type: 'prescription', receiptKey: key, prescriptionId: rx.id };
    const free = !frozenEdit(mirror.current, action) && mirror.current.receipts.some((r) => r.key === key && !r.done && r.attempt === null);
    if (free) apply(action);
    say(free ? null : { tone: 'danger', text: t(frozenWhy(mirror.current)) });
    return free;
  };
  return { numbers, saved };
}
