'use client';

import { CircleAlert, ScanBarcode, Search, SearchX } from 'lucide-react';
import { useEffect, useRef, useState, type Ref } from 'react';
import { searchProducts } from '@/app/pharmacy/_actions/catalog';
import type { SearchResult } from '@/server/pharmacy/search';
import { useT } from '@/studio/i18n';
import { settle } from '@/studio/settle';
import { Field } from '@/studio/ui/Field';
import { Input } from '@/studio/ui/Input';
import { isolate } from './WriteBlocked';

export interface PickerProps {
  /** Adds the product as a line. Resolves to an error sentence when it could not be added. */
  onPick: (found: SearchResult) => Promise<string | null>;
  /** The box around the search input, so the form can send focus to it. */
  boxRef: Ref<HTMLDivElement>;
  disabled?: boolean;
}

/**
 * The product search of the receiving form, the catalog's own query (`ph.products.search`): a name, an ingredient, or a
 * barcode typed or pasted exactly. A pause in typing searches; Enter searches at once and, when exactly one product
 * answers (a barcode, most often), adds it without another click. The scanner's keystrokes are this box's own state and
 * never part of the form's draft. No motion.
 */
export function ReceiptProductPicker({ onPick, boxRef, disabled = false }: PickerProps) {
  const t = useT();
  const [q, setQ] = useState('');
  const [found, setFound] = useState<SearchResult[] | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'failed'>('idle');
  const [problem, setProblem] = useState<string | null>(null);
  const asked = useRef(0);

  const run = async (text: string): Promise<SearchResult[] | null> => {
    const ask = ++asked.current;
    if (text.trim() === '') {
      setFound(null);
      setState('idle');
      return null;
    }
    setState('loading');
    const result = await settle(() => searchProducts({ q: text }));
    if (ask !== asked.current) return null;
    if (!result.ok) {
      setState('failed');
      return null;
    }
    const rows = result.data as SearchResult[];
    setFound(rows);
    setState('idle');
    return rows;
  };

  useEffect(() => {
    if (q.trim() === '') return;
    const timer = setTimeout(() => void run(q), 250);
    return () => clearTimeout(timer);
  }, [q]);

  const pick = async (row: SearchResult) => {
    setProblem(null);
    const error = await onPick(row);
    if (error) {
      setProblem(error);
      return;
    }
    setQ('');
    setFound(null);
  };

  const onEnter = async () => {
    const rows = await run(q);
    if (rows && rows.length === 1) await pick(rows[0]!);
  };

  return (
    <div className="flex min-w-0 flex-col gap-2" data-testid="receipt-picker">
      <Field label={t('pharmacy.receive.search.label')} hint={t('pharmacy.receive.search.hint')}>
        <div ref={boxRef} className="relative">
          <Search aria-hidden className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <Input
            type="search"
            dir="auto"
            autoComplete="off"
            enterKeyHint="search"
            disabled={disabled}
            value={q}
            onChange={(event) => {
              setQ(event.target.value);
              setProblem(null);
              if (event.target.value.trim() === '') void run('');
            }}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return;
              event.preventDefault();
              void onEnter();
            }}
            className="min-h-11 ps-8"
          />
        </div>
      </Field>
      <p role="status" className="flex min-h-5 items-center gap-2 text-sm text-muted">
        {state === 'loading' ? (
          <>
            <Search aria-hidden className="size-4 shrink-0" />
            {t('pharmacy.receive.search.searching')}
          </>
        ) : null}
      </p>
      {state === 'failed' && (
        <p role="alert" className="flex items-start gap-2.5 rounded-md bg-danger-wash px-3 py-2.5 text-sm text-danger">
          <CircleAlert aria-hidden className="mt-px size-4 shrink-0" />
          <span className="min-w-0">{t('pharmacy.receive.search.failed')}</span>
        </p>
      )}
      {problem && (
        <p role="alert" className="flex items-start gap-2.5 rounded-md bg-danger-wash px-3 py-2.5 text-sm text-danger">
          <CircleAlert aria-hidden className="mt-px size-4 shrink-0" />
          <span className="min-w-0">{problem}</span>
        </p>
      )}
      {found && found.length === 0 && state === 'idle' && (
        <p data-testid="receipt-picker-none" className="flex items-start gap-2.5 text-sm text-text">
          <SearchX aria-hidden className="mt-px size-4 shrink-0 text-muted" />
          <span className="min-w-0">{t('pharmacy.receive.search.none', { q: isolate(q.trim()) })}</span>
        </p>
      )}
      {found && found.length > 0 && (
        <ul aria-label={t('pharmacy.receive.search.results')} className="flex flex-col border-t border-line">
          {found.map((row) => (
            <li key={`${row.productId}:${row.unitId ?? ''}`} className="border-b border-line">
              <button
                type="button"
                data-testid="receipt-picker-result"
                disabled={disabled}
                onClick={() => void pick(row)}
                className="flex min-h-11 w-full min-w-0 flex-wrap items-center gap-x-4 gap-y-1 rounded-sm px-2 py-2 text-start hover:bg-hover"
              >
                <span dir="auto" className="min-w-0 break-words text-base font-medium text-text [overflow-wrap:anywhere]">
                  {row.label}
                </span>
                <span dir="auto" className="min-w-0 break-words text-sm text-muted">
                  {[row.strength, row.form, row.packLabel].filter((p) => p.trim() !== '').join(' · ')}
                </span>
                {row.matchedOn === 'barcode' && (
                  <span className="inline-flex items-center gap-1.5 text-xs font-medium text-text">
                    <ScanBarcode aria-hidden className="size-3.5 shrink-0" />
                    {t('pharmacy.receive.search.byBarcode')}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
