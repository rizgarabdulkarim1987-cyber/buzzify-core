'use client';

import { useState } from 'react';
import { formatNumber } from '@/lib/pos-format';
import { pickName } from '@/lib/pos-view';
import type { Locale } from '@/lib/locale';
import type { TillProduct } from '@/server/pos/till-catalog';
import { useLocale, useT } from '@/studio/i18n';
import { Button } from '@/studio/ui/Button';
import { cx } from '@/studio/ui/cx';
import { Dialog } from '@/studio/ui/Dialog';
import { Textarea } from '@/studio/ui/Textarea';
import { useMoney } from './money';

export interface Chosen {
  variantId: string | undefined;
  optionIds: string[];
  quantity: number;
  note: string;
}

interface Props {
  product: TillProduct | null;
  fallback: Locale;
  pending: boolean;
  onClose: () => void;
  onAdd: (product: TillProduct, chosen: Chosen) => void;
}

/** The sizes, option groups, quantity and note of one product, chosen before it joins the order. */
export function OptionsSheet({ product, fallback, pending, onClose, onAdd }: Props) {
  const { locale } = useLocale();
  return (
    <Dialog open={product !== null} onOpenChange={(open) => !open && onClose()} title={product ? pickName(product.names, locale, fallback) : ''} width="md">
      {product ? <SheetBody key={product.id} product={product} fallback={fallback} pending={pending} onAdd={onAdd} /> : null}
    </Dialog>
  );
}

function SheetBody({ product, fallback, pending, onAdd }: { product: TillProduct; fallback: Locale; pending: boolean; onAdd: Props['onAdd'] }) {
  const t = useT();
  const { locale } = useLocale();
  const money = useMoney();
  const name = (names: TillProduct['names']) => pickName(names, locale, fallback);
  const defaultVariant = product.variants.find((variant) => variant.isDefault) ?? product.variants[0];
  const [variantId, setVariantId] = useState<string | undefined>(defaultVariant?.id);
  const [optionIds, setOptionIds] = useState<string[]>([]);
  const [quantity, setQuantity] = useState(1);
  const [note, setNote] = useState('');

  const toggle = (groupId: string, optionId: string) => {
    const group = product.groups.find((g) => g.id === groupId)!;
    const inGroup = new Set(group.options.map((option) => option.id));
    setOptionIds((current) => {
      if (current.includes(optionId)) return current.filter((id) => id !== optionId);
      const same = current.filter((id) => inGroup.has(id));
      // A single-choice group swaps its choice; a multi-choice group stops at its maximum.
      if (group.maxSelect === 1) return [...current.filter((id) => !inGroup.has(id)), optionId];
      return same.length >= group.maxSelect ? current : [...current, optionId];
    });
  };

  const variant = product.variants.find((v) => v.id === variantId);
  const picked = product.groups.flatMap((group) => group.options).filter((option) => optionIds.includes(option.id));
  const unit = product.price + (variant?.priceDelta ?? 0) + picked.reduce((sum, option) => sum + option.priceDelta, 0);
  const missing = product.groups.filter((group) => group.options.filter((option) => optionIds.includes(option.id)).length < group.minSelect);

  return (
    <div className="flex flex-col gap-5">
      {product.variants.length > 1 ? (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-base font-medium text-text">{t('pos.order.size')}</legend>
          {product.variants.map((v) => (
            <Choice key={v.id} type="radio" name="variant" checked={variantId === v.id} onChange={() => setVariantId(v.id)} label={name(v.names)} extra={v.priceDelta ? signed(v.priceDelta, money) : ''} />
          ))}
        </fieldset>
      ) : null}

      {product.groups.map((group) => (
        <fieldset key={group.id} className="flex flex-col gap-2">
          <legend className="mb-1 text-base font-medium text-text">
            {name(group.names)}
            <span className="ms-2 text-sm font-normal text-muted">
              {group.minSelect > 0 ? t('pos.order.required') : t('pos.order.optional')}
              {group.maxSelect > 1 ? ` · ${t('pos.order.upTo', { n: formatNumber(group.maxSelect) })}` : ''}
            </span>
          </legend>
          {group.options
            .filter((option) => option.available)
            .map((option) => (
              <Choice
                key={option.id}
                type={group.maxSelect === 1 ? 'radio' : 'checkbox'}
                name={group.id}
                checked={optionIds.includes(option.id)}
                onChange={() => toggle(group.id, option.id)}
                label={name(option.names)}
                extra={option.priceDelta ? signed(option.priceDelta, money) : ''}
              />
            ))}
        </fieldset>
      ))}

      <label className="flex flex-col gap-1.5 text-base font-medium text-text">
        {t('pos.order.note')}
        <Textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={300} rows={2} />
      </label>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Stepper value={quantity} onChange={setQuantity} label={t('pos.order.quantity')} />
        <Button variant="primary"
          size="lg"
          className="min-h-12 min-w-40 flex-1"
          disabled={pending || missing.length > 0}
          onClick={() => onAdd(product, { variantId, optionIds, quantity, note: note.trim() })}
        >
          {t('pos.order.add')} · {money(unit * quantity)}
        </Button>
      </div>
      {missing.length > 0 ? <p className="text-sm text-muted">{t('pos.order.chooseRequired')}</p> : null}
    </div>
  );
}

const signed = (amount: number, money: (n: number) => string) => (amount > 0 ? `+${money(amount)}` : money(amount));

function Choice({ type, name, checked, onChange, label, extra }: { type: 'radio' | 'checkbox'; name: string; checked: boolean; onChange: () => void; label: string; extra: string }) {
  return (
    <label className={cx('flex min-h-12 cursor-pointer items-center gap-3 rounded-md border px-3 text-base', checked ? 'border-ink bg-accent-wash' : 'border-line-strong bg-raised')}>
      <input type={type} name={name} checked={checked} onChange={onChange} className="size-5 accent-[var(--ink)]" />
      <span className="flex-1">{label}</span>
      {extra ? <span className="text-sm text-muted">{extra}</span> : null}
    </label>
  );
}

/** A quantity with large plus and minus buttons, 1 to 999. */
export function Stepper({ value, onChange, label, disabled }: { value: number; onChange: (next: number) => void; label: string; disabled?: boolean }) {
  return (
    <div role="group" aria-label={label} className="inline-flex items-center gap-1">
      <button type="button" aria-label="−" disabled={disabled || value <= 1} onClick={() => onChange(value - 1)} className="size-12 rounded-md border border-line-strong bg-raised text-xl hover:bg-hover disabled:opacity-40">
        −
      </button>
      <output className="min-w-10 text-center text-lg font-semibold" dir="ltr">
        {formatNumber(value)}
      </output>
      <button type="button" aria-label="+" disabled={disabled || value >= 999} onClick={() => onChange(value + 1)} className="size-12 rounded-md border border-line-strong bg-raised text-xl hover:bg-hover disabled:opacity-40">
        +
      </button>
    </div>
  );
}
