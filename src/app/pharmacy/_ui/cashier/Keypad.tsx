'use client';

import { Check } from 'lucide-react';
import { useT } from '@/studio/i18n';
import { Num } from '../sell-parts';

const DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const;
const KEY = 'inline-flex min-h-11 min-w-11 items-center justify-center rounded-ph-xl border border-ph-line bg-ph-card text-xl font-bold tabular-nums text-ph-text hover:bg-ph-canvas disabled:cursor-not-allowed disabled:opacity-45';

/**
 * The quantity pad: what is typed shows in the display, and the enter key puts it on the selected line (the screen reads it
 * with `parseQtyText`). Whole numbers only, so there is no decimal point. The keys sit in an `ltr` box so 1 2 3 read left to
 * right in an Arabic screen too (the prototype's `.keys`). Plain buttons; no motion.
 */
export function Keypad({ text, onKey, onEnter, canEnter }: { text: string; onKey: (key: string) => void; onEnter: () => void; canEnter: boolean }) {
  const t = useT();
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-ph-2xl border border-ph-line bg-ph-card p-2.5" role="group" aria-label={t('pharmacy.cashier.keypad.region')} data-testid="keypad">
      <output className="flex min-h-12 items-center justify-end rounded-ph-xl border-2 border-ph-accent bg-ph-canvas px-3 text-[22px] font-bold tabular-nums text-ph-text" aria-label={t('pharmacy.cashier.keypad.display')} data-testid="keypad-display">
        <Num>{text}</Num>
      </output>
      <div dir="ltr" className="grid grid-cols-3 gap-1.5" data-testid="keypad-keys">
        {DIGITS.map((d) => (
          <button key={d} type="button" className={KEY} data-testid="key-digit" onClick={() => onKey(d)}>
            {d}
          </button>
        ))}
        <button type="button" className={`${KEY} text-base`} data-testid="keypad-clear" aria-label={t('pharmacy.cashier.keypad.clear')} onClick={() => onKey('C')}>
          C
        </button>
        <button type="button" className={KEY} data-testid="key-digit" onClick={() => onKey('0')}>
          0
        </button>
        <button type="button" className={`${KEY} border-ph-g8 bg-ph-g8 text-ph-on-green hover:bg-ph-g9`} data-testid="keypad-enter" aria-label={t('pharmacy.cashier.keypad.enter')} disabled={!canEnter} onClick={onEnter}>
          <Check aria-hidden className="size-6" />
        </button>
      </div>
    </div>
  );
}
