'use client';

import { useId } from 'react';
import { useApp } from '@/ui/AppProviders';

export interface OptionItem {
  id: string;
  name: string;
  effect?: string | null;
  priceDelta: number;
  disabled?: boolean;
}

export function OptionGroup({
  title,
  items,
  selected,
  min,
  max,
  onToggle,
}: {
  title: string;
  items: OptionItem[];
  selected: string[];
  min: number;
  max: number;
  onToggle: (id: string) => void;
}) {
  const { t, price } = useApp();
  const name = useId();
  const single = max === 1;
  const requirement =
    min > 0 ? t('product.required') : single ? t('product.optional') : t('product.chooseUpTo', { max });

  return (
    <fieldset className="mt-6 border-0 p-0">
      <legend className="flex w-full items-baseline justify-between gap-3 pb-1">
        <span className="font-display text-lg">{title}</span>
        <span className="text-sm text-muted">{requirement}</span>
      </legend>
      <ul>
        {items.map((item) => {
          const checked = selected.includes(item.id);
          return (
            <li key={item.id} className="border-b border-line last:border-b-0">
              <label
                className={`flex min-h-12 cursor-pointer items-center gap-3 py-2 ${item.disabled ? 'opacity-50' : ''}`}
              >
                <input
                  type={single && min > 0 ? 'radio' : 'checkbox'}
                  name={name}
                  checked={checked}
                  disabled={item.disabled}
                  onChange={() => onToggle(item.id)}
                  className="size-5 shrink-0 accent-[var(--accent)]"
                />
                <span className="min-w-0 flex-1">
                  <span className="block">{item.name}</span>
                  {item.effect && <span className="block text-sm text-muted">{item.effect}</span>}
                </span>
                {item.priceDelta !== 0 && (
                  <span className="shrink-0 text-sm tabular-nums text-muted">
                    {item.priceDelta > 0 ? '+' : ''}
                    {price(item.priceDelta)}
                  </span>
                )}
              </label>
            </li>
          );
        })}
      </ul>
    </fieldset>
  );
}
