'use client';

import { useId, useState, type InputHTMLAttributes, type SelectHTMLAttributes } from 'react';
import { displayUnitsFor, formatQuantity, parseQuantity, type DisplayUnit, type StockUnitKey } from '@/server/domain/pos/stock';
import { useT } from '@/studio/i18n';
import { useSyncOptional } from '../sync/SyncProvider';

/** The look of every control on the stock, purchase and complaint screens: 48px tall, tokens of the Studio. */
export const CONTROL = 'min-h-12 w-full min-w-0 rounded-md border border-line-strong bg-raised px-3 text-base text-text focus:border-ink disabled:opacity-45';

/** The same control without the full width, for a select that sits beside a field. */
const FIXED_WIDTH_CONTROL = CONTROL.replace(' w-full', '');

export function TextInput({ label, hint, error, ...rest }: { label: string; hint?: string; error?: string | null } & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-text">
        {label}
      </label>
      <input id={id} aria-invalid={error ? true : undefined} {...rest} className={`${CONTROL} ${rest.className ?? ''}`} />
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : hint ? (
        <p className="text-sm text-muted">{hint}</p>
      ) : null}
    </div>
  );
}

export function PickerSelect({ label, options, ...rest }: { label: string; options: readonly { value: string; label: string }[] } & SelectHTMLAttributes<HTMLSelectElement>) {
  const id = useId();
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-text">
        {label}
      </label>
      <select id={id} {...rest} className={`${CONTROL} ${rest.className ?? ''}`}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/**
 * A quantity typed in the item's units. The parsed integer (smallest unit) goes to `onChange`, or null while the text is not a
 * valid amount; the server parses nothing, so it only ever sees an integer within bounds.
 */
export function QuantityField({
  unit,
  label,
  onChange,
  allowNegative = false,
  resetKey,
  initial,
}: {
  unit: StockUnitKey;
  label: string;
  onChange: (quantity: number | null) => void;
  allowNegative?: boolean;
  /** Change it to clear the field after a save. */
  resetKey?: string | number;
  /** A quantity (smallest unit) to start with, shown in the largest unit that fits. */
  initial?: number;
}) {
  const t = useT();
  const units = displayUnitsFor(unit);
  const start = initial === undefined ? null : formatQuantity(initial, unit);
  const [text, setText] = useState(start?.value ?? '');
  const [display, setDisplay] = useState<DisplayUnit>(start?.unit ?? units[0]!);
  const [seen, setSeen] = useState(resetKey);
  if (seen !== resetKey) {
    setSeen(resetKey);
    setText('');
  }
  const parsed = text.trim() === '' ? null : parseQuantity(text, unit, display);
  const invalid = text.trim() !== '' && (parsed === null || (!allowNegative && parsed < 0));
  function update(nextText: string, nextDisplay: DisplayUnit) {
    setText(nextText);
    setDisplay(nextDisplay);
    const value = nextText.trim() === '' ? null : parseQuantity(nextText, unit, nextDisplay);
    onChange(value === null || (!allowNegative && value < 0) ? null : value);
  }
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="text-sm font-medium text-text">{label}</span>
      <div className="flex gap-2">
        <input
          aria-label={label}
          aria-invalid={invalid ? true : undefined}
          inputMode="decimal"
          dir="ltr"
          autoComplete="off"
          value={text}
          onChange={(event) => update(event.target.value, display)}
          className={`${CONTROL} text-start`}
        />
        {units.length > 1 ? (
          <select aria-label={t('pos.stock.unitPicker')} value={display} onChange={(event) => update(text, event.target.value as DisplayUnit)} className={`${FIXED_WIDTH_CONTROL} w-24 shrink-0`}>
            {units.map((u) => (
              <option key={u} value={u}>
                {t(`pos.stock.unit.${u}`)}
              </option>
            ))}
          </select>
        ) : (
          <span className="inline-flex min-h-12 w-24 shrink-0 items-center justify-center text-base text-muted">{t(`pos.stock.unit.${units[0]!}`)}</span>
        )}
      </div>
      {invalid ? (
        <p role="alert" className="text-sm text-danger">
          {t('pos.stock.quantityInvalid')}
        </p>
      ) : null}
    </div>
  );
}

/** True while the device is online; stock, purchases and complaints are back-office work and need the network. */
export function useOnline(): boolean {
  return useSyncOptional()?.online ?? true;
}

/** A note shown while offline, next to the buttons it disables. */
export function OnlineOnlyNote() {
  const t = useT();
  const online = useOnline();
  return online ? null : <p className="text-sm text-muted">{t('pos.stock.needsNetwork')}</p>;
}
