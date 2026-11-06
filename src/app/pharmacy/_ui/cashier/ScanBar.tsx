'use client';

import { Barcode, Info, Repeat2 } from 'lucide-react';
import type { Ref } from 'react';
import { useT } from '@/studio/i18n';
import { formatMinor, unitOf, type CartLine, type Currency } from '../sell-logic';
import { Num } from '../sell-parts';
import type { ScanUnitPref } from './cashier-logic';

const BTN = 'inline-flex min-h-12 min-w-11 items-center justify-center gap-2 rounded-ph-xl border px-3 text-sm font-semibold';

/**
 * The scan / search field with the unit button and the inquiry button beside it. Enter adds the top result (a scanner's own
 * closing Enter was taken before it gets here). The unit button CONVERTS (a button, never a dropdown): it shows the unit and
 * price it would act on (the selected line's unit, else the unit the next item starts in); the screen decides what a press does.
 * The inquiry button shows and turns inquiry mode (F7); its caption says what a press does ("End inquiry" while it is on).
 */
export function ScanBar({
  inputRef,
  query,
  onQuery,
  onEnter,
  line,
  scanUnit,
  currency,
  onUnit,
  inquiry,
  onInquiry,
  suggest,
}: {
  inputRef: Ref<HTMLInputElement>;
  query: string;
  onQuery: (text: string) => void;
  onEnter: () => void;
  /** The selected line (its unit is what the button converts), else null. */
  line: CartLine | null;
  scanUnit: ScanUnitPref;
  currency: Currency;
  onUnit: () => void;
  inquiry: boolean;
  onInquiry: () => void;
  /** The suggestion list under the field: whether it has rows, its id, the active row's id, and the arrow keys. */
  suggest: { open: boolean; listId: string; activeId: string | undefined; onMove: (delta: 1 | -1) => void };
}) {
  const t = useT();
  const unit = line ? unitOf(line) : null;
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
            {unit ? unit.label : t(`pharmacy.cashier.unit.pref.${scanUnit}`)}
          </span>
          <span className="text-xs font-normal tabular-nums text-ph-muted" data-testid="unit-price">
            {!unit ? (
              t('pharmacy.cashier.unit.next')
            ) : unit.priceMinor === null ? (
              t('pharmacy.sell.chip.noPrice')
            ) : (
              <>
                <Num>{formatMinor(BigInt(unit.priceMinor), currency)}</Num> {currency}
              </>
            )}
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
        {/* The prototype's caption: "استعلام عن سعر" with F7 under it, "إنهاء الاستعلام" while the mode is on. */}
        <span className="flex flex-col items-start leading-tight">
          {t(inquiry ? 'pharmacy.cashier.inquiry.end' : 'pharmacy.cashier.inquiry.button')}
          <small className={`text-[11px] font-normal ${inquiry ? 'text-ph-on-green-muted' : 'text-ph-muted'}`}>F7</small>
        </span>
      </button>
    </div>
  );
}
