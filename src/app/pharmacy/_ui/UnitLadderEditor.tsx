'use client';

import { Plus, Trash2 } from 'lucide-react';
import { useT } from '@/studio/i18n';
import { Button } from '@/studio/ui/Button';
import { Checkbox } from '@/studio/ui/Checkbox';
import { Field } from '@/studio/ui/Field';
import { Input } from '@/studio/ui/Input';
import { wholeOf, type LevelDraft } from './product-draft';

/** The most units a product has (the server's limit). */
const MAX_LEVELS = 10;

export interface UnitLadderEditorProps {
  levels: LevelDraft[];
  /** The new ladder; `removed` is the position taken out, so barcodes on it (and above it) can follow. */
  onChange: (levels: LevelDraft[], removed?: number) => void;
  disabled: boolean;
  /** Messages by field: `levels` for the ladder as a whole, `levels.<i>.baseQty` for one row. */
  errors: Record<string, string>;
}

/**
 * How the product is packed, from the base unit up: a tablet, a strip of 10, a box of 30. Each row is a unit's name, how
 * many base units it holds and whether it is sold on its own; the base unit always holds 1. A line under the rows says
 * what the largest pack holds, so a wrong number shows before saving.
 */
export function UnitLadderEditor({ levels, onChange, disabled, errors }: UnitLadderEditorProps) {
  const t = useT();
  const update = (index: number, patch: Partial<LevelDraft>) => onChange(levels.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  const top = levels[levels.length - 1];
  const topQty = top ? wholeOf(top.baseQty) : null;

  return (
    <div className="flex flex-col gap-3">
      <ol className="flex flex-col gap-3">
        {levels.map((level, index) => {
          const name = index === 0 ? t('pharmacy.catalog.unit.base') : t('pharmacy.catalog.unit.pack', { n: index });
          return (
            <li key={index} className="flex flex-col gap-3 rounded-md border border-line p-3">
              <p className="text-sm font-medium text-text">{name}</p>
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,10rem)]">
                <Field label={<><span className="sr-only">{name}: </span>{t('pharmacy.catalog.unit.label')}</>} error={index === 0 ? errors.levels : undefined}>
                  <Input dir="auto" value={level.label} maxLength={40} disabled={disabled} onChange={(e) => update(index, { label: e.target.value })} />
                </Field>
                <Field label={<><span className="sr-only">{name}: </span>{t('pharmacy.catalog.unit.baseQty')}</>} error={errors[`levels.${index}.baseQty`]}>
                  <Input
                    inputMode="numeric"
                    dir="ltr"
                    value={index === 0 ? '1' : level.baseQty}
                    readOnly={index === 0}
                    disabled={disabled}
                    onChange={(e) => update(index, { baseQty: e.target.value })}
                  />
                </Field>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <Checkbox
                  label={<><span className="sr-only">{name}: </span>{t('pharmacy.catalog.unit.sellable')}</>}
                  checked={level.sellable}
                  disabled={disabled}
                  onChange={(e) => update(index, { sellable: e.target.checked })}
                />
                {index > 0 && !disabled && (
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<Trash2 aria-hidden />}
                    onClick={() => onChange(levels.filter((_, i) => i !== index), index)}
                  >
                    {t('pharmacy.catalog.unit.remove', { unit: level.label.trim() || name })}
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      {levels.length > 1 && top && topQty !== null && levels[0] && (
        <p className="text-sm text-muted" dir="auto">
          {t('pharmacy.catalog.unit.summary', { top: top.label || '…', count: topQty, base: levels[0].label || '…' })}
        </p>
      )}
      {!disabled && levels.length < MAX_LEVELS && (
        <div>
          <Button size="sm" icon={<Plus aria-hidden />} onClick={() => onChange([...levels, { label: '', baseQty: '', sellable: true }])}>
            {t('pharmacy.catalog.unit.add')}
          </Button>
        </div>
      )}
    </div>
  );
}
