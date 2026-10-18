'use client';

import { useId } from 'react';
import type { OptionStyle } from '@/lib/templates/types';
import { useApp } from '@/ui/AppProviders';
import { OptionGroup, type OptionItem } from './OptionGroup';

/**
 * A product's sizes or one of its option groups, offered in the template's style: the classic list, chips in a row, or
 * tiles in a grid (flavours, scoops, boxes). Chips and tiles are real radio buttons or checkboxes inside their labels, so
 * the keyboard and screen readers treat them as such.
 */
export function OptionChoices({
  style,
  title,
  items,
  selected,
  min,
  max,
  onToggle,
}: {
  style: OptionStyle;
  title: string;
  items: OptionItem[];
  selected: string[];
  min: number;
  max: number;
  onToggle: (id: string) => void;
}) {
  const { t, money } = useApp();
  const name = useId();
  if (style === 'list') return <OptionGroup title={title} items={items} selected={selected} min={min} max={max} onToggle={onToggle} />;

  const single = max === 1;
  const requirement = min > 0 ? t('product.required') : single ? t('product.optional') : t('product.chooseUpTo', { max });
  const chosenCount = items.filter((item) => selected.includes(item.id)).length;

  return (
    <fieldset className="mt-6 border-0 p-0">
      <legend className="flex w-full items-baseline justify-between gap-3 pb-2.5">
        <span className="tpl-display text-lg">{title}</span>
        <span className="text-sm text-(--muted)">{requirement}</span>
      </legend>
      <div className={style === 'tiles' ? 'grid grid-cols-2 gap-2.5 sm:grid-cols-3' : 'flex flex-wrap gap-2'}>
        {items.map((item) => {
          const checked = selected.includes(item.id);
          const full = !single && !checked && chosenCount >= max;
          return (
            <label
              key={item.id}
              className={`${style === 'tiles' ? 'tpl-option-tile' : 'tpl-chip tpl-option-chip'} ${item.disabled || full ? 'opacity-45' : ''}`}
              data-checked={checked || undefined}
            >
              <input
                type={single && min > 0 ? 'radio' : 'checkbox'}
                name={name}
                checked={checked}
                disabled={item.disabled || full}
                onChange={() => onToggle(item.id)}
                className="sr-only"
              />
              <span className="min-w-0">
                <span className="block">{item.name}</span>
                {style === 'tiles' && item.effect && <span className="mt-0.5 block text-xs text-(--muted)">{item.effect}</span>}
              </span>
              {item.priceDelta !== 0 && (
                <span className="shrink-0 text-sm tabular-nums text-(--muted)">
                  {item.priceDelta > 0 ? '+' : ''}
                  {money(item.priceDelta)}
                </span>
              )}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
