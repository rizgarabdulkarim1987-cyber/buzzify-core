'use client';

import { Check } from 'lucide-react';
import { ALLERGENS, BADGES, DIETARY_TAGS, type Allergen, type Badge, type DietaryTag } from '@/lib/product-tags';
import { useT } from '@/studio/i18n';
import { cx } from '@/studio/ui/cx';

/** A set of toggles from a fixed list: each a button that is pressed while its value is in the set. */
function ChipSet<T extends string>({
  legend,
  hint,
  options,
  selected,
  label,
  onChange,
}: {
  legend: string;
  hint?: string;
  options: readonly T[];
  selected: readonly T[];
  label: (value: T) => string;
  onChange: (values: T[]) => void;
}) {
  const toggle = (value: T) =>
    onChange(selected.includes(value) ? selected.filter((entry) => entry !== value) : options.filter((entry) => entry === value || selected.includes(entry)));
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 text-sm font-medium text-text">{legend}</legend>
      {hint && <p className="-mt-1 text-sm text-muted">{hint}</p>}
      <div className="flex flex-wrap gap-1.5">
        {options.map((value) => {
          const on = selected.includes(value);
          return (
            <button
              key={value}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(value)}
              className={cx(
                'inline-flex h-7 items-center gap-1 rounded-full border px-2.5 text-sm transition-colors duration-150',
                on ? 'border-ink bg-ink text-on-ink hover:bg-ink-hover' : 'border-line-strong bg-raised text-text hover:bg-hover',
              )}
            >
              {on && <Check aria-hidden className="size-3.5" />}
              {label(value)}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

export interface TagValues {
  allergens: Allergen[];
  dietary: DietaryTag[];
  badges: Badge[];
}

/** What a product contains and what it is, for guests who need to know, and the labels on its row (spec 5.3). */
export function TagFields({ values, onChange }: { values: TagValues; onChange: (values: TagValues) => void }) {
  const t = useT();
  return (
    <div className="flex flex-col gap-5">
      <ChipSet
        legend={t('content.tags.allergens')}
        hint={t('content.tags.allergensHint')}
        options={ALLERGENS}
        selected={values.allergens}
        label={(value) => t(`content.allergen.${value}`)}
        onChange={(allergens) => onChange({ ...values, allergens })}
      />
      <ChipSet
        legend={t('content.tags.dietary')}
        options={DIETARY_TAGS}
        selected={values.dietary}
        label={(value) => t(`content.dietary.${value}`)}
        onChange={(dietary) => onChange({ ...values, dietary })}
      />
      <ChipSet
        legend={t('content.tags.badges')}
        hint={t('content.tags.badgesHint')}
        options={BADGES}
        selected={values.badges}
        label={(value) => t(`content.badge.${value}`)}
        onChange={(badges) => onChange({ ...values, badges })}
      />
    </div>
  );
}
