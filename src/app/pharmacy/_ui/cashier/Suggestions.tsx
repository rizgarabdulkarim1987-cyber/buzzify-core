'use client';

import { Hourglass, SearchX, TriangleAlert } from 'lucide-react';
import { useT } from '@/studio/i18n';
import { formatMinor, itemDetail, type Currency } from '../sell-logic';
import { Note, Num } from '../sell-parts';
import type { Suggestion } from './cashier-logic';
import type { SuggestionState } from './use-suggestions';

export const suggestionId = (listId: string, index: number) => `${listId}-${index}`;

/**
 * The hits for the typed text, in the flow under the field (never a dialog). Each row is a 44px button that adds the item;
 * a row that cannot be added is disabled and says why in words. Focus stays in the field (the buttons take no focus on
 * press); the field drives the list with the arrow keys through `aria-activedescendant`.
 */
export function Suggestions({
  state,
  query,
  currency,
  listId,
  active,
  onPick,
}: {
  state: SuggestionState;
  query: string;
  currency: Currency;
  listId: string;
  active: number;
  onPick: (row: Suggestion) => void;
}) {
  const t = useT();
  if (state.status === 'idle') return null;
  if (state.status === 'loading')
    return (
      <Note look="ph" icon={<Hourglass aria-hidden />} role="status" testId="suggestions-loading">
        {t('pharmacy.sell.searching')}
      </Note>
    );
  if (state.status === 'failed')
    return (
      <Note look="ph" icon={<TriangleAlert aria-hidden />} tone="danger" role="status" testId="suggestions-failed">
        {t('pharmacy.cashier.sugg.failed')}
      </Note>
    );
  if (state.rows.length === 0)
    return (
      <p className="flex items-center gap-2.5 px-1 py-2 text-sm text-ph-text" role="status" data-testid="suggestions-empty">
        <SearchX aria-hidden className="size-4 shrink-0 text-ph-muted" />
        {t('pharmacy.sell.empty', { q: query.trim() })}
      </p>
    );
  return (
    <ul id={listId} role="listbox" aria-label={t('pharmacy.cashier.sugg.region')} className="flex max-h-72 min-w-0 flex-col gap-1 overflow-y-auto rounded-ph-xl border border-ph-line bg-ph-card p-1" data-testid="suggestions">
      {state.rows.map((row, index) => (
        <li key={`${row.item.productId}`} role="presentation">
          <button
            type="button"
            tabIndex={-1}
            role="option"
            id={suggestionId(listId, index)}
            aria-selected={index === active}
            aria-disabled={row.reason !== null}
            className={`flex min-h-11 w-full min-w-0 items-center justify-between gap-3 rounded-ph-xl px-3 py-1.5 text-start ${row.reason ? 'cursor-not-allowed text-ph-muted' : 'text-ph-text hover:bg-ph-canvas'} ${index === active ? 'bg-ph-canvas outline outline-2 outline-ph-accent' : ''}`}
            data-testid="suggestion"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              if (row.reason === null) onPick(row);
            }}
          >
            <span className="flex min-w-0 flex-col">
              <span className="truncate font-semibold" dir="auto">
                {row.item.tradeName}
              </span>
              <span className="truncate text-xs text-ph-muted" dir="auto">
                {itemDetail(row.item)}
              </span>
            </span>
            <span className="flex shrink-0 flex-col items-end text-xs tabular-nums">
              <span className="text-sm font-semibold" data-testid="suggestion-price">
                {row.unit && row.unit.priceMinor !== null ? (
                  <>
                    <Num>{formatMinor(BigInt(row.unit.priceMinor), currency)}</Num> {currency}
                  </>
                ) : (
                  t('pharmacy.sell.chip.noPrice')
                )}
              </span>
              <span data-testid="suggestion-note">
                {row.reason ? t(`pharmacy.cashier.sugg.reason.${row.reason}`) : t('pharmacy.cashier.sugg.stock', { qty: row.item.sellableQty })}
                {row.mark && ` · ${t(`pharmacy.cashier.sugg.mark.${row.mark}`)}`}
              </span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
