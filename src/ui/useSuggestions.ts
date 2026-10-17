'use client';

import { useEffect, useState } from 'react';
import type { SuggestionsView } from '@/server/data/suggestion-view';
import type { CartInput } from '@/server/domain/types';
import { useApp } from '@/ui/AppProviders';

export interface SuggestionsBody {
  context: 'menu' | 'product' | 'cart';
  product?: { productId: string; variantId: string | null; optionIds: string[] };
  cart: CartInput;
  dismissedIds: string[];
}

/** Fetches suggestions, keeping the previous answer on screen while a new one loads. */
export function useSuggestions(body: SuggestionsBody | null): { data: SuggestionsView | null } {
  const { tenant, locale, preview } = useApp();
  const [data, setData] = useState<SuggestionsView | null>(null);
  const payload = body ? JSON.stringify({ ...body, locale }) : null;

  useEffect(() => {
    if (!payload || preview) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/${tenant.slug}/suggestions`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: payload,
          signal: controller.signal,
        });
        if (response.ok) setData((await response.json()) as SuggestionsView);
      } catch {
        // Suggestions are optional; the menu works without them.
      }
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [payload, tenant.slug, preview]);

  return { data: payload ? data : null };
}
