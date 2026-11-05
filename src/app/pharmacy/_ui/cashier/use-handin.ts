'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef } from 'react';
import { sellSearch } from '@/app/pharmacy/_actions/sales';
import type { SellItem } from '@/server/pharmacy/sell-search';
import { useT } from '@/studio/i18n';
import { settle } from '@/studio/settle';
import { onAddToCart } from '../cart-bridge';
import type { phMessage } from '../ph-failure';
import { createScanQueue, isAddable, parseSellAdd, type Currency } from '../sell-logic';
import type { HandedIn, Message } from './use-adding';

/**
 * Items handed to the cashier from other screens, as the old sale screen took them: the cart bridge (`onAddToCart`, while the
 * screen is mounted) and `?add=<unitId>:<qty>,...` in the address (read once, then removed from it). Each is looked up by its unit
 * id and added through the same path as a scan, one at a time, in order; nothing is added before the stored receipts are read
 * (it would be replaced by them): early items wait. Unknown, blocked and failed lookups are said.
 */
export function useHandIn(o: {
  currency: Currency;
  /** The shift is open and the receipts on the device were read. */
  ready: boolean;
  add: (item: SellItem, handIn: HandedIn) => boolean;
  lookupFailed: (error: Parameters<typeof phMessage>[2], code: string, failedKey: string) => void;
  say: (message: Message) => void;
  setNotSent: (on: boolean) => void;
}) {
  const t = useT();
  const router = useRouter();

  const handle = async (code: string) => {
    const cut = code.lastIndexOf(':');
    const unitId = code.slice(0, cut);
    const qty = Number(code.slice(cut + 1));
    const result = await settle(() => sellSearch({ q: '', currency: o.currency, unitIds: [unitId] }));
    if (!result.ok) {
      o.lookupFailed(result.error, unitId, 'pharmacy.sell.handIn.failed');
      return;
    }
    o.setNotSent(false);
    const item = (result.data as { items: SellItem[] }).items.find((i) => i.units.some((u) => u.id === unitId));
    if (!item) o.say({ tone: 'danger', text: t('pharmacy.sell.handIn.unknown') });
    else if (!isAddable(item)) o.say({ tone: 'danger', text: t('pharmacy.sell.handIn.blocked', { name: item.tradeName }) });
    else o.add(item, { unitId, qty });
  };
  const handler = useRef(handle);
  useEffect(() => {
    handler.current = handle;
  });
  const queue = useRef<ReturnType<typeof createScanQueue> | null>(null);
  useEffect(() => {
    queue.current = createScanQueue((code) => handler.current(code));
  }, []);

  const readyRef = useRef(false);
  const early = useRef<string[]>([]);
  const handIn = useCallback((item: HandedIn) => {
    const code = `${item.unitId}:${item.qty}`;
    if (readyRef.current) queue.current?.push(code);
    else early.current.push(code);
  }, []);
  useEffect(() => onAddToCart(handIn), [handIn]);

  const urlRead = useRef(false);
  useEffect(() => {
    readyRef.current = o.ready;
    if (!o.ready) return;
    if (!urlRead.current) {
      urlRead.current = true;
      const search = window.location.search;
      const wanted = parseSellAdd(search);
      if (new URLSearchParams(search).has('add')) {
        const rest = new URLSearchParams(search);
        rest.delete('add');
        const text = rest.toString();
        router.replace(`${window.location.pathname}${text ? `?${text}` : ''}`);
      }
      for (const item of wanted) early.current.push(`${item.unitId}:${item.qty}`);
    }
    for (const code of early.current.splice(0)) queue.current?.push(code);
  }, [o.ready, router]);
}
