'use client';

import { useState } from 'react';
import { useT } from '@/studio/i18n';
import { FieldInput, PH_FIELD } from '../sell-parts';
import { calcKey, evalCalc, formatCalc } from './calc-logic';
import { usePadSink, type PadSlot } from './WorkParts';

/** The prototype's example sum, shown in the empty field. */
const EXAMPLE = '2000*5-500';

/**
 * The calculator (the keypad's "حاسبة" key), inline in the work panel: a sum is typed (or tapped on the keypad, which types digits
 * here while this panel is open; C clears) and answered live under it. It never touches the receipt, the payment or the drawer:
 * a scratch pad for the cashier. Esc or "Back" closes it.
 */
export function CalcFlow({ padSlot }: { padSlot?: PadSlot }) {
  const t = useT();
  const [text, setText] = useState('');
  usePadSink(padSlot, { key: (key) => setText((s) => calcKey(s, key)), enter: () => undefined });
  const value = evalCalc(text);
  return (
    <div className="flex flex-col gap-2" data-testid="flow-calc">
      <label className="flex flex-col gap-1 text-sm text-ph-muted">
        {t('pharmacy.cashier.calc.label')}
        <FieldInput
          className={`${PH_FIELD} min-h-12 text-end text-[22px] font-bold tabular-nums`}
          dir="ltr"
          inputMode="decimal"
          autoComplete="off"
          autoFocus
          placeholder={EXAMPLE}
          data-testid="calc-input"
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
      </label>
      <p className="text-lg font-bold tabular-nums text-ph-text" role="status" aria-label={t('pharmacy.cashier.calc.result')} data-testid="calc-result" dir="ltr">
        = {value === null ? '' : formatCalc(value)}
      </p>
    </div>
  );
}
