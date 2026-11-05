'use client';

import { useEffect, useRef, useState } from 'react';
import { sellSearch } from '@/app/pharmacy/_actions/sales';
import type { SellItem } from '@/server/pharmacy/sell-search';
import { settle } from '@/studio/settle';
import type { Currency } from '../sell-logic';
import { SUGGESTION_DELAY_MS, suggestionsFrom, wantsSuggestions, type Suggestion } from './cashier-logic';

export type SuggestionState = { status: 'idle' } | { status: 'loading' } | { status: 'failed' } | { status: 'ready'; rows: Suggestion[] };

/**
 * The hits for what is being typed, read from `sellSearch` after a short pause. An answer for an older text never replaces a
 * newer one (the timer and the answer are both dropped when the text changes), and the state is always read against the
 * current text, so a late answer for a text no longer in the field shows nothing.
 */
export function useSuggestions(query: string, currency: Currency, enabled: boolean): SuggestionState {
  const q = query.trim();
  const wants = enabled && wantsSuggestions(q);
  const [answer, setAnswer] = useState<{ q: string; currency: Currency; rows: Suggestion[] | null } | null>(null);
  const seq = useRef(0);
  useEffect(() => {
    if (!wants) return;
    const mine = ++seq.current;
    const timer = setTimeout(() => {
      void settle(() => sellSearch({ q, currency })).then((result) => {
        if (mine !== seq.current) return;
        setAnswer({ q, currency, rows: result.ok ? suggestionsFrom((result.data as { items: SellItem[] }).items) : null });
      });
    }, SUGGESTION_DELAY_MS);
    return () => {
      clearTimeout(timer);
      seq.current += 1;
    };
  }, [q, currency, wants]);

  if (!wants) return { status: 'idle' };
  if (!answer || answer.q !== q || answer.currency !== currency) return { status: 'loading' };
  return answer.rows ? { status: 'ready', rows: answer.rows } : { status: 'failed' };
}
