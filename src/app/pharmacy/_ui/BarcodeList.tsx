'use client';

import { Plus, ScanBarcode, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { normalizeScan } from '@/server/domain/pharmacy/barcode';
import { useT } from '@/studio/i18n';
import { Button } from '@/studio/ui/Button';
import { Field } from '@/studio/ui/Field';
import { IconButton } from '@/studio/ui/IconButton';
import { Input } from '@/studio/ui/Input';
import { Select } from '@/studio/ui/Select';
import { StatusBadge } from '@/studio/ui/StatusBadge';
import type { BarcodeDraft, LevelDraft } from './product-draft';

/** The most barcodes a product has (the server's limit). */
const MAX_BARCODES = 50;

export interface BarcodeListProps {
  barcodes: BarcodeDraft[];
  levels: LevelDraft[];
  onChange: (barcodes: BarcodeDraft[]) => void;
  disabled: boolean;
  /** Messages by field: `barcodes.<i>.code` and `barcodes.<i>.level`, as the server names them. */
  errors: Record<string, string>;
}

/**
 * A product's barcodes, each on the pack it is printed on. The scan field is where a scanner types (it ends with Enter):
 * its text is this component's own state, never part of the product's draft, and only a finished code is added. A code
 * is text through `normalizeScan` (Latin digits, no surrounding space), so 0012345678905 stays exactly that.
 */
export function BarcodeList({ barcodes, levels, onChange, disabled, errors }: BarcodeListProps) {
  const t = useT();
  const [scan, setScan] = useState('');
  const [level, setLevel] = useState(() => Math.max(0, levels.length - 1));
  const [problem, setProblem] = useState<string | null>(null);
  const unitName = (index: number) => levels[index]?.label.trim() || (index === 0 ? t('pharmacy.catalog.unit.base') : t('pharmacy.catalog.unit.pack', { n: index }));
  const unitOptions = levels.map((_, index) => ({ value: String(index), label: unitName(index) }));
  const chosen = Math.min(level, levels.length - 1);

  const add = () => {
    const code = normalizeScan(scan);
    if (code === '') return setProblem(t('pharmacy.catalog.barcode.empty'));
    if (barcodes.some((b) => b.code === code)) return setProblem(t('pharmacy.catalog.barcode.already'));
    setProblem(null);
    onChange([...barcodes, { code, level: chosen, shared: false }]);
    setScan('');
  };

  return (
    <div className="flex flex-col gap-3">
      {barcodes.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-muted">
          <ScanBarcode aria-hidden className="size-4 shrink-0" />
          {t('pharmacy.catalog.barcode.none')}
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-line rounded-md border border-line">
          {barcodes.map((barcode, index) => (
            <li key={`${barcode.code}-${index}`} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2">
              <span dir="ltr" className="min-w-0 break-all font-mono text-sm text-text tabular-nums">
                {barcode.code}
              </span>
              {barcode.shared && <StatusBadge>{t('pharmacy.catalog.barcode.sharedBadge')}</StatusBadge>}
              <div className="ms-auto flex items-center gap-2">
                <Select
                  aria-label={`${t('pharmacy.catalog.barcode.unit')}: ${barcode.code}`}
                  value={String(Math.min(barcode.level, levels.length - 1))}
                  disabled={disabled}
                  onChange={(e) => onChange(barcodes.map((b, i) => (i === index ? { ...b, level: Number(e.target.value) } : b)))}
                  options={unitOptions}
                />
                {!disabled && (
                  <IconButton
                    label={t('pharmacy.catalog.barcode.remove', { code: barcode.code })}
                    icon={<Trash2 />}
                    onClick={() => onChange(barcodes.filter((_, i) => i !== index))}
                  />
                )}
              </div>
              {errors[`barcodes.${index}.code`] && <p className="w-full text-sm text-danger">{errors[`barcodes.${index}.code`]}</p>}
            </li>
          ))}
        </ul>
      )}
      {!disabled && barcodes.length < MAX_BARCODES && (
        <div className="grid items-end gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,10rem)_auto]">
          <Field label={t('pharmacy.catalog.barcode.scan')} error={problem ?? undefined}>
            <Input
              dir="ltr"
              inputMode="numeric"
              autoComplete="off"
              spellCheck={false}
              maxLength={48}
              value={scan}
              onChange={(e) => setScan(e.target.value)}
              onKeyDown={(e) => {
                // A scanner ends with Enter: add the code, never submit the product.
                if (e.key === 'Enter') {
                  e.preventDefault();
                  add();
                }
              }}
            />
          </Field>
          <Field label={t('pharmacy.catalog.barcode.unit')}>
            <Select value={String(chosen)} onChange={(e) => setLevel(Number(e.target.value))} options={unitOptions} />
          </Field>
          <Button icon={<Plus aria-hidden />} onClick={add}>
            {t('pharmacy.catalog.barcode.add')}
          </Button>
        </div>
      )}
    </div>
  );
}
