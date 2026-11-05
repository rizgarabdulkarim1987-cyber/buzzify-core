'use client';

import { Barcode, Info, Repeat2 } from 'lucide-react';
import type { ReactNode, Ref } from 'react';
import { useT } from '@/studio/i18n';

const BTN = 'inline-flex min-h-12 min-w-11 items-center justify-center gap-2 rounded-ph-xl border px-3 text-sm font-semibold';

/**
 * The scan / search field with the unit button and the inquiry button beside it. Enter adds the top result (a scanner's own
 * closing Enter was taken before it gets here). The unit button CONVERTS (a button, never a dropdown): it shows the unit and
 * price it would act on; the screen decides what a press does. The inquiry button only shows its mode (the panel is a later task).
 */
export function ScanBar({
  inputRef,
  query,
  onQuery,
  onEnter,
  unitLabel,
  unitPrice,
  onUnit,
  inquiry,
  onInquiry,
  suggest,
}: {
  inputRef: Ref<HTMLInputElement>;
  query: string;
  onQuery: (text: string) => void;
  onEnter: () => void;
  unitLabel: string;
  unitPrice: ReactNode;
  onUnit: () => void;
  inquiry: boolean;
  onInquiry: () => void;
  /** The suggestion list under the field: whether it has rows, its id, the active row's id, and the arrow keys. */
  suggest: { open: boolean; listId: string; activeId: string | undefined; onMove: (delta: 1 | -1) => void };
}) {
  const t = useT();
  return (
    <div className="flex min-w-0 flex-wrap items-stretch gap-2" data-testid="scan-bar">
      <div className="relative min-w-0 flex-1 basis-64">
        <Barcode aria-hidden className="pointer-events-none absolute start-3.5 top-1/2 size-5 -translate-y-1/2 text-ph-muted" />
        <input
          ref={inputRef}
          type="search"
          dir="auto"
          autoComplete="off"
          autoFocus
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={suggest.open}
          aria-controls={suggest.open ? suggest.listId : undefined}
          aria-activedescendant={suggest.open ? suggest.activeId : undefined}
          enterKeyHint="search"
          aria-label={t('pharmacy.cashier.scan.label')}
          placeholder={t('pharmacy.cashier.scan.placeholder')}
          className="min-h-12 w-full min-w-0 rounded-ph-xl border-2 border-ph-accent bg-ph-card pe-4 ps-11 text-[17px] text-ph-text"
          data-testid="cashier-search"
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          onKeyDown={(event) => {
            // A scanner's closing Enter was already taken by the scan capture (default prevented): it must not also add the top result.
            if (suggest.open && (event.key === 'ArrowDown' || event.key === 'ArrowUp') && !event.nativeEvent.isComposing) {
              event.preventDefault();
              suggest.onMove(event.key === 'ArrowDown' ? 1 : -1);
              return;
            }
            if (event.nativeEvent.defaultPrevented || event.nativeEvent.isComposing || event.shiftKey || event.key !== 'Enter') return;
            event.preventDefault();
            onEnter();
          }}
        />
      </div>
      <button type="button" className={`${BTN} border-ph-line bg-ph-card text-ph-text hover:bg-ph-canvas`} data-testid="unit-button" aria-label={t('pharmacy.cashier.unit.button')} onClick={onUnit}>
        <Repeat2 aria-hidden className="size-5 shrink-0" />
        <span className="flex min-w-0 flex-col items-start leading-tight">
          <span className="max-w-32 truncate" data-testid="unit-label">
            {unitLabel}
          </span>
          <span className="text-xs font-normal tabular-nums text-ph-muted" data-testid="unit-price">
            {unitPrice}
          </span>
        </span>
      </button>
      <button
        type="button"
        aria-pressed={inquiry}
        className={`${BTN} ${inquiry ? 'border-ph-g8 bg-ph-g8 text-ph-on-green' : 'border-ph-line bg-ph-card text-ph-text hover:bg-ph-canvas'}`}
        data-testid="inquiry-button"
        onClick={onInquiry}
      >
        <Info aria-hidden className="size-5 shrink-0" />
        {t('pharmacy.cashier.inquiry.button')}
      </button>
    </div>
  );
}
