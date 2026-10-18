'use client';

import { useId, type ReactNode } from 'react';
import { cx } from '@/studio/ui/cx';
import { Switch } from '@/studio/ui/Switch';

/** Small controls the Design tab is built from, in the Studio's own style. */

export function Panel({ id, title, intro, children, aside }: { id: string; title: string; intro?: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-4 border-t border-line py-6 first:border-t-0 first:pt-0">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h2 id={id} className="text-md font-semibold text-text">
            {title}
          </h2>
          {intro && <p className="max-w-[60ch] text-sm text-muted">{intro}</p>}
        </div>
        {aside}
      </div>
      {children}
    </section>
  );
}

/** A labelled range with its value beside it. */
export function Slider({
  label,
  value,
  min,
  max,
  step,
  format = (v) => v.toFixed(2),
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format?: (value: number) => string;
  onChange: (value: number) => void;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <label htmlFor={id} className="font-medium text-text">
          {label}
        </label>
        <output htmlFor={id} className="tabular-nums text-muted">
          {format(value)}
        </output>
      </div>
      <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} className="w-full accent-ink" />
    </div>
  );
}

/** One choice among a few, as a row of pressed buttons. */
export function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: ReadonlyArray<{ value: T; label: string }>; onChange: (value: T) => void }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex w-fit flex-wrap rounded-md border border-line p-0.5">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          onClick={() => onChange(option.value)}
          className={cx('h-7 rounded-sm px-3 text-sm transition-colors', option.value === value ? 'bg-text text-bg' : 'text-muted hover:text-text')}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function ToggleRow({ label, hint, checked, disabled, onChange }: { label: string; hint?: string; checked: boolean; disabled?: boolean; onChange: (value: boolean) => void }) {
  const id = useId();
  return (
    <div className={cx('flex items-start justify-between gap-4', disabled && 'opacity-60')}>
      <div className="flex flex-col gap-0.5">
        <label htmlFor={id} className="text-sm font-medium text-text">
          {label}
        </label>
        {hint && <span className="text-xs text-muted">{hint}</span>}
      </div>
      <Switch id={id} checked={checked} disabled={disabled} onCheckedChange={onChange} />
    </div>
  );
}

/** A colour: the swatch picker and its hex value, kept in step. */
export function ColourField({ label, value, invalid, onChange }: { label: string; value: string; invalid?: boolean; onChange: (value: string) => void }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-xs font-medium text-muted">
        {label}
      </label>
      <div className="flex items-center gap-2">
        <input type="color" aria-label={label} value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : '#000000'} onChange={(event) => onChange(event.target.value.toUpperCase())} className="h-8 w-9 shrink-0 cursor-pointer rounded border border-line-strong bg-raised p-0.5" />
        <input
          id={id}
          value={value}
          onChange={(event) => onChange(event.target.value.trim().toUpperCase())}
          dir="ltr"
          spellCheck={false}
          aria-invalid={invalid || undefined}
          className="h-8 w-full min-w-0 rounded-md border border-line-strong bg-raised px-2 font-mono text-sm uppercase text-text aria-invalid:border-danger"
        />
      </div>
    </div>
  );
}
