'use client';

import { Check, ChevronDown, ChevronUp, Minus, Plus, Trash2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { useT } from '@/studio/i18n';
import { Num } from '../sell-parts';

/** The line buttons (the prototype's pad): the same work as the arrow, + - and Delete keys. */
export type PadLineKey = 'lineUp' | 'lineDown' | 'qtyDown' | 'qtyUp' | 'remove';
const LINE_KEYS: Record<PadLineKey, { testId: string; icon: ReactNode }> = {
  lineUp: { testId: 'pad-line-up', icon: <ChevronUp aria-hidden className="size-5" /> },
  lineDown: { testId: 'pad-line-down', icon: <ChevronDown aria-hidden className="size-5" /> },
  qtyDown: { testId: 'pad-qty-down', icon: <Minus aria-hidden className="size-5" /> },
  qtyUp: { testId: 'pad-qty-up', icon: <Plus aria-hidden className="size-5" /> },
  remove: { testId: 'pad-remove', icon: <Trash2 aria-hidden className="size-5" /> },
};
const KEY = 'inline-flex min-h-11 min-w-11 items-center justify-center rounded-ph-xl border border-ph-line bg-ph-card text-xl font-bold tabular-nums text-ph-text hover:bg-ph-canvas disabled:cursor-not-allowed disabled:opacity-45';

/**
 * The quantity pad: what is typed shows in the display, and the enter key puts it on the selected line (the screen reads it
 * with `parseQtyText`). Whole numbers only, so there is no decimal point. The keys sit in an `ltr` box so 1 2 3 read left to
 * right in an Arabic screen too (the prototype's `.keys`). Down the fourth column the line buttons move the selection and
 * step its quantity, with Delete beside the display (`onLine`), for a till without a keyboard. Plain buttons; no motion.
 */
export function Keypad({ text, onKey, onEnter, canEnter, onLine }: { text: string; onKey: (key: string) => void; onEnter: () => void; canEnter: boolean; onLine: (key: PadLineKey) => void }) {
  const t = useT();
  const line = (kind: PadLineKey) => (
    <button
      type="button"
      className={`${KEY} text-base${kind === 'remove' ? ' text-ph-red' : ''}`}
      data-testid={LINE_KEYS[kind].testId}
      aria-label={t(`pharmacy.cashier.keypad.${kind}`)}
      title={t(`pharmacy.cashier.keypad.${kind}`)}
      onClick={() => onLine(kind)}
    >
      {LINE_KEYS[kind].icon}
    </button>
  );
  const digit = (d: string) => (
    <button type="button" className={KEY} data-testid="key-digit" onClick={() => onKey(d)}>
      {d}
    </button>
  );
  return (
    <div className="flex min-w-0 flex-col rounded-ph-2xl border border-ph-line bg-ph-card p-2 lg:mt-auto lg:shrink-0" role="group" aria-label={t('pharmacy.cashier.keypad.region')} data-testid="keypad">
      <div dir="ltr" className="grid grid-cols-4 gap-1.5" data-testid="keypad-keys">
        <output className="col-span-3 flex min-h-11 items-center justify-end rounded-ph-xl border-2 border-ph-accent bg-ph-canvas px-3 text-[22px] font-bold tabular-nums text-ph-text" aria-label={t('pharmacy.cashier.keypad.display')} data-testid="keypad-display">
          <Num>{text}</Num>
        </output>
        {line('remove')}
        {digit('1')}
        {digit('2')}
        {digit('3')}
        {line('lineUp')}
        {digit('4')}
        {digit('5')}
        {digit('6')}
        {line('lineDown')}
        {digit('7')}
        {digit('8')}
        {digit('9')}
        {line('qtyDown')}
        <button type="button" className={`${KEY} text-base`} data-testid="keypad-clear" aria-label={t('pharmacy.cashier.keypad.clear')} onClick={() => onKey('C')}>
          C
        </button>
        {digit('0')}
        <button type="button" className={`${KEY} border-ph-g8 bg-ph-g8 text-ph-on-green hover:bg-ph-g9`} data-testid="keypad-enter" aria-label={t('pharmacy.cashier.keypad.enter')} disabled={!canEnter} onClick={onEnter}>
          <Check aria-hidden className="size-6" />
        </button>
        {line('qtyUp')}
      </div>
    </div>
  );
}
