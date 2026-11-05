'use client';

import { useEffect, useState } from 'react';
import { sellInfo } from '@/app/pharmacy/_actions/sales';
import type { SellInfo } from '@/server/pharmacy/sell-info';
import { settle } from '@/studio/settle';
import type { Currency } from '../sell-logic';

export type ProductInfoState = { status: 'idle' } | { status: 'loading' } | { status: 'failed' } | { status: 'ready'; info: SellInfo };

/**
 * One product's batches, details and substitutes (`ph.sell.info`), read when the product shown changes. An answer for a product
 * no longer shown is dropped; the state is always read against the product asked for now. Read-only: it never touches a receipt.
 */
export function useProductInfo(productId: string | null, currency: Currency): ProductInfoState {
  const [answer, setAnswer] = useState<{ at: string; info: SellInfo | null } | null>(null);
  const at = productId ? `${productId}:${currency}` : '';
  useEffect(() => {
    if (!productId) return;
    let cancelled = false;
    void settle(() => sellInfo({ productId, currency })).then((result) => {
      if (!cancelled) setAnswer({ at: `${productId}:${currency}`, info: result?.ok ? (result.data as SellInfo) : null });
    });
    return () => {
      cancelled = true;
    };
  }, [productId, currency]);
  if (!productId) return { status: 'idle' };
  if (!answer || answer.at !== at) return { status: 'loading' };
  return answer.info ? { status: 'ready', info: answer.info } : { status: 'failed' };
}
