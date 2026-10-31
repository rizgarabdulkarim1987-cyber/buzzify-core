'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { BasketView } from '@/server/pos/table-basket';
import { useApp } from '@/ui/AppProviders';

const POLL_MS = 4_000;
const WRITE_DELAY_MS = 600;

/** The secret this phone keeps for the table's basket. Made once per table and kept for the visit. */
function tokenFor(slug: string, table: number): string {
  const key = `buzzify:basket-token:${slug}:${table}`;
  try {
    const saved = window.localStorage.getItem(key);
    if (saved && /^[A-Za-z0-9_-]{16,64}$/.test(saved)) return saved;
    const bytes = crypto.getRandomValues(new Uint8Array(18));
    const made = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
    window.localStorage.setItem(key, made);
    return made;
  } catch {
    // Without storage the token lasts for this page view only.
    return Array.from(crypto.getRandomValues(new Uint8Array(18)), (byte) => byte.toString(16).padStart(2, '0')).join('');
  }
}

export interface TableBasket {
  view: BasketView | null;
  /** The guest's own part has reached the server, so a send includes everything on their phone. */
  flush(): Promise<boolean>;
  token: string;
}

/**
 * Keeps this phone's cart as its part of the table's basket and reads everyone's. While `enabled` is false nothing is sent or
 * fetched. The cart is the one source of the guest's lines: the server replaces the part with whatever the cart holds.
 */
export function useTableBasket(enabled: boolean): TableBasket {
  const { tenant, table, cart } = useApp();
  const [view, setView] = useState<BasketView | null>(null);
  const [token, setToken] = useState('');
  const api = `/api/${tenant.slug}/table-basket`;
  const lines = cart.lines.map((line) => ({ productId: line.productId, variantId: line.variantId, optionIds: line.optionIds, quantity: line.quantity }));
  const body = JSON.stringify(lines);
  const latest = useRef(body);
  latest.current = body;
  const written = useRef<string | null>(null);

  useEffect(() => {
    if (enabled && table !== null) setToken(tokenFor(tenant.slug, table));
  }, [enabled, table, tenant.slug]);

  const read = useCallback(async () => {
    if (!enabled || table === null || !token) return;
    try {
      const response = await fetch(`${api}?table=${table}`, { headers: { 'x-basket-token': token }, cache: 'no-store' });
      if (response.ok) setView((await response.json()) as BasketView);
    } catch {
      // A dropped connection is retried on the next tick.
    }
  }, [api, enabled, table, token]);

  const write = useCallback(async (): Promise<boolean> => {
    if (!enabled || table === null || !token) return false;
    const sending = latest.current;
    if (written.current === sending) return true;
    try {
      const response = await fetch(api, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ table, token, name: '', lines: JSON.parse(sending) as unknown[] }),
      });
      if (!response.ok) return false;
      written.current = sending;
      return true;
    } catch {
      return false;
    }
  }, [api, enabled, table, token]);

  useEffect(() => {
    if (!enabled || !token) return;
    const timer = window.setTimeout(() => void write().then(() => read()), WRITE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [body, enabled, token, write, read]);

  useEffect(() => {
    if (!enabled || !token) return;
    void read();
    const timer = window.setInterval(() => void read(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [enabled, token, read]);

  return { view, flush: write, token };
}

/** Everyone's part of the basket, so a guest sees what the table is about to order. */
export function BasketParts({ view }: { view: BasketView }) {
  const { t, money } = useApp();
  if (view.parts.length === 0) return null;
  return (
    <ul className="mt-3 space-y-3" data-testid="basket-parts">
      {view.parts.map((part, index) => (
        <li key={index} className="rounded-xl border border-line p-3">
          <p className="text-sm text-muted" dir="auto">
            {part.mine ? t('basket.you') : part.name || t('basket.guest', { n: index + 1 })}
          </p>
          <ul className="mt-1">
            {part.lines.map((line, at) => (
              <li key={at} className="flex justify-between gap-3" dir="auto">
                <span className="min-w-0 break-words">
                  {line.quantity} × {line.name}
                </span>
                <span className="shrink-0">{money(line.total)}</span>
              </li>
            ))}
          </ul>
          {part.invalid ? <p className="mt-1 text-sm text-accent">{t('basket.invalid')}</p> : null}
        </li>
      ))}
      <li className="flex justify-between font-display text-lg">
        <span>{t('basket.total')}</span>
        <span>{money(view.total)}</span>
      </li>
    </ul>
  );
}
