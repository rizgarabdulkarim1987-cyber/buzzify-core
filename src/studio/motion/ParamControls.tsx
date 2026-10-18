'use client';

import { useId, useState } from 'react';
import type { MotionParams, ParamSpec, ParamValue } from '@/motion/types';
import { useT } from '@/studio/i18n';
import { Field } from '@/studio/ui/Field';
import { Input } from '@/studio/ui/Input';
import { Select } from '@/studio/ui/Select';
import { Switch } from '@/studio/ui/Switch';

const HEX = /^#[0-9a-f]{6}$/i;

/** A number as the controls show it: no trailing float noise, at most two decimals. */
export function formatNumber(value: number): string {
  return String(Math.round(value * 100) / 100);
}

/** A range control: the label and the value on one line, the slider under them. */
export function RangeControl({
  label,
  value,
  min,
  max,
  step,
  format = formatNumber,
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
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-sm font-medium text-text">
          {label}
        </label>
        <output htmlFor={id} className="text-sm text-muted tabular-nums">
          {format(value)}
        </output>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-5 w-full cursor-pointer accent-[var(--s-ink)]"
      />
    </div>
  );
}

/** A colour: the browser's picker as a swatch beside the code, which can be typed too. */
function ColorControl({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const [draft, setDraft] = useState(value);
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    setDraft(value);
  }
  return (
    <Field label={label}>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={label}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="h-8 w-10 shrink-0 cursor-pointer rounded-md border border-line-strong bg-raised p-0.5"
        />
        <Input
          dir="ltr"
          spellCheck={false}
          value={draft}
          maxLength={7}
          className="font-mono uppercase"
          onChange={(event) => {
            const next = event.target.value.trim();
            setDraft(next);
            if (HEX.test(next)) onChange(next.toLowerCase());
          }}
          onBlur={() => setDraft(value)}
        />
      </div>
    </Field>
  );
}

function Control({ name, spec, value, onChange }: { name: string; spec: ParamSpec; value: ParamValue; onChange: (value: ParamValue) => void }) {
  const t = useT();
  const label = t(`motion.param.${name}`);
  switch (spec.type) {
    case 'color':
      return <ColorControl label={label} value={String(value)} onChange={onChange} />;
    case 'range':
      return <RangeControl label={label} value={Number(value)} min={spec.min} max={spec.max} step={spec.step} onChange={onChange} />;
    case 'toggle':
      return (
        <label className="flex cursor-pointer items-center justify-between gap-3 py-1 text-sm font-medium text-text">
          {label}
          <Switch checked={value === true} onCheckedChange={(checked) => onChange(checked)} />
        </label>
      );
    case 'choice':
      return (
        <Field label={label}>
          <Select
            value={String(value)}
            onChange={(event) => onChange(event.target.value)}
            options={spec.options.map((option) => ({ value: option, label: t(`motion.option.${option}`) }))}
          />
        </Field>
      );
    case 'text':
      return (
        <Field label={label}>
          <Input dir="auto" value={String(value)} maxLength={spec.maxLength} onChange={(event) => onChange(event.target.value)} />
        </Field>
      );
  }
}

/** A control for each of a motion's parameters, in the order the motion declares them. */
export function ParamControls({
  specs,
  values,
  onChange,
}: {
  specs: Record<string, ParamSpec>;
  values: MotionParams;
  onChange: (name: string, value: ParamValue) => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      {Object.entries(specs).map(([name, spec]) => (
        <Control key={name} name={name} spec={spec} value={values[name] ?? spec.default} onChange={(value) => onChange(name, value)} />
      ))}
    </div>
  );
}
