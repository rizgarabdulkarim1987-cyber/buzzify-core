'use client';

import { Plus, Trash2 } from 'lucide-react';
import type { Locale } from '@/lib/locale';
import { parsePriceInput } from '@/lib/money-input';
import { useLocale, useT } from '@/studio/i18n';
import { Button } from '@/studio/ui/Button';
import { Field } from '@/studio/ui/Field';
import { IconButton } from '@/studio/ui/IconButton';
import { Input } from '@/studio/ui/Input';
import type { VariantDraft } from './draft';
import { formatMoney, newKey, parseDeltaInput } from './shared';
import { TranslationFields } from './TranslationFields';

export interface VariantsEditorProps {
  locales: readonly Locale[];
  currency: string;
  /** The product's price as typed, to show what each size costs. */
  price: string;
  variants: VariantDraft[];
  onChange: (variants: VariantDraft[]) => void;
  /** Messages by the server's field paths (`variants`, `variants.0.priceDelta`). */
  errors: Record<string, string>;
  /** Without `content.prices`, differences cannot be changed. */
  canPrice: boolean;
}

/**
 * A product's sizes: each a name in the menu's languages and a difference from the product's price. With sizes, exactly
 * one is the default, the one a guest gets without choosing; the first size added is the default until another is chosen.
 */
export function VariantsEditor({ locales, currency, price, variants, onChange, errors, canPrice }: VariantsEditorProps) {
  const t = useT();
  const { locale } = useLocale();
  const base = parsePriceInput(price, currency);

  const update = (index: number, change: Partial<VariantDraft>) =>
    onChange(variants.map((variant, at) => (at === index ? { ...variant, ...change } : change.isDefault ? { ...variant, isDefault: false } : variant)));

  const remove = (index: number) => {
    const rest = variants.filter((_, at) => at !== index);
    // The default goes with its size: the first one left takes its place.
    if (variants[index]?.isDefault && rest.length > 0) rest[0] = { ...rest[0]!, isDefault: true };
    onChange(rest);
  };

  const add = () => onChange([...variants, { key: newKey(), names: {}, priceDelta: '', isDefault: variants.length === 0 }]);

  return (
    <div className="flex flex-col gap-3">
      {errors.variants && (
        <p role="alert" className="text-sm text-danger">
          {errors.variants}
        </p>
      )}
      {variants.length > 0 && (
        <ol className="flex flex-col divide-y divide-line rounded-md border border-line">
          {variants.map((variant, index) => {
            const n = index + 1;
            const delta = parseDeltaInput(variant.priceDelta, currency);
            const total = base.ok && delta.ok ? base.minor + delta.minor : null;
            return (
              <li key={variant.key} className="flex flex-col gap-3 p-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium text-text">{t('content.sizes.title', { n })}</span>
                  <div className="flex items-center gap-3">
                    <label className="inline-flex cursor-pointer items-center gap-1.5 text-sm text-text">
                      <input
                        type="radio"
                        name="default-size"
                        aria-label={t('content.sizes.defaultLabel', { n })}
                        checked={variant.isDefault}
                        onChange={() => update(index, { isDefault: true })}
                        className="size-3.5 accent-ink"
                      />
                      {t('content.sizes.default')}
                    </label>
                    <IconButton
                      label={t('content.sizes.remove', { n })}
                      icon={<Trash2 aria-hidden />}
                      size="sm"
                      onClick={() => remove(index)}
                    />
                  </div>
                </div>
                <TranslationFields
                  label={t('content.sizes.name', { n })}
                  showLabel={false}
                  locales={locales}
                  values={variant.names}
                  maxLength={120}
                  onChange={(names) => update(index, { names })}
                />
                <Field
                  label={t('content.sizes.delta', { n })}
                  hint={total !== null ? t('content.sizes.costs', { price: formatMoney(total, currency, locale) }) : t('content.sizes.deltaHint')}
                  error={errors[`variants.${index}.priceDelta`]}
                  className="max-w-56"
                >
                  <Input
                    value={variant.priceDelta}
                    inputMode="decimal"
                    dir="ltr"
                    disabled={!canPrice}
                    placeholder="+0.00"
                    onChange={(event) => update(index, { priceDelta: event.target.value })}
                    className="tabular-nums"
                  />
                </Field>
              </li>
            );
          })}
        </ol>
      )}
      <div>
        <Button size="sm" icon={<Plus aria-hidden />} onClick={add}>
          {t('content.sizes.add')}
        </Button>
      </div>
    </div>
  );
}
