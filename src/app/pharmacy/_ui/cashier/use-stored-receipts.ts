'use client';

import { useEffect, useState, type Dispatch } from 'react';
import { draftKey, type Currency } from '../sell-logic';
import { receiptsKey, serializeReceipts, type ReceiptsState } from '../sell-receipts';
import { restoreReceipts, type CashierAction } from './cashier-logic';

/**
 * The open receipts live on this device per pharmacy, branch, person and currency: read once when the shift is known (the
 * old single-cart draft moves in as receipt 1), written on every change after that. `loaded` is false until the read is
 * done (an early scan would be replaced by the restore); `restored` says receipts with lines came back.
 */
export function useStoredReceipts(ids: { restaurantId: string; branchId: string; userId: string }, currency: Currency, shiftOpen: boolean, state: ReceiptsState, dispatch: Dispatch<CashierAction>) {
  const [loaded, setLoaded] = useState(false);
  const [restored, setRestored] = useState(false);
  const storeKey = receiptsKey(ids.restaurantId, ids.branchId, ids.userId, currency);
  const legacyKey = draftKey(ids.restaurantId, ids.branchId, ids.userId, currency);
  useEffect(() => {
    if (!shiftOpen || loaded) return;
    try {
      const kept = restoreReceipts(window.localStorage.getItem(storeKey), window.localStorage.getItem(legacyKey));
      dispatch({ type: 'load', state: kept.state });
      if (kept.migrated) {
        // Written first, then the old key removed: the old draft can never come back as a second copy of a cart sold here.
        window.localStorage.setItem(storeKey, serializeReceipts(kept.state));
        window.localStorage.removeItem(legacyKey);
      }
      // eslint-disable-next-line react-hooks/set-state-in-effect -- the receipts are read from this device's storage once, after the shift is known
      if (kept.state.receipts.some((r) => r.cart.lines.length > 0)) setRestored(true);
    } catch {
      /* storage can be blocked: the receipts simply start empty */
    }
    setLoaded(true);
  }, [shiftOpen, loaded, storeKey, legacyKey, dispatch]);
  useEffect(() => {
    if (!shiftOpen || !loaded) return;
    try {
      window.localStorage.setItem(storeKey, serializeReceipts(state));
    } catch {
      /* the receipts on the device are a convenience */
    }
  }, [shiftOpen, loaded, state, storeKey]);
  return { loaded, restored };
}
