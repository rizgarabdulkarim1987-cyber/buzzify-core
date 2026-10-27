'use client';

import { useCallback, useSyncExternalStore } from 'react';
import { tillOfferFor, type LineOffer } from '@/server/domain/pos/line-offer';
import type { TillCatalog, TillProduct } from '@/server/pos/till-catalog';

const MINUTE = 60_000;
const thisMinute = () => Math.floor(Date.now() / MINUTE);
const onServer = () => null;

/**
 * The menu offer a dish is under right now, for the product tiles and the options sheet. The clock is read on the client
 * only and moves once a minute, so the first paint matches the server's and no offer outlives its window for long. The
 * price the server charges is decided there; this is the cue.
 */
export function useProductOffer(catalog: Pick<TillCatalog, 'offers' | 'timeZone'> | null): (product: Pick<TillProduct, 'id' | 'categoryId'>) => LineOffer | null {
  // A catalog cached before offers reached the till has none.
  const active = catalog !== null && (catalog.offers?.length ?? 0) > 0;
  const subscribe = useCallback(
    (tick: () => void) => {
      if (!active) return () => undefined;
      const timer = setInterval(tick, MINUTE);
      return () => clearInterval(timer);
    },
    [active],
  );
  const minute = useSyncExternalStore<number | null>(subscribe, thisMinute, onServer);
  return useCallback(
    (product) => (catalog && minute !== null ? tillOfferFor(product, catalog.offers ?? [], new Date(minute * MINUTE), catalog.timeZone) : null),
    [catalog, minute],
  );
}
