'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useStore } from 'zustand';
import { isEmpty, itemCount as countItems } from '@/lib/cart';
import type { Translate } from '@/lib/i18n';
import type { Locale } from '@/lib/locale';
import { getTranslator } from '@/lib/messages';
import type { QuoteView } from '@/server/data/quote-view';
import { formatMoney } from '@/server/domain/money';
import type { CartInput, CartLineInput } from '@/server/domain/types';
import { configureTracking } from '@/ui/analytics/track';
import { createCartStore, type CartStore } from '@/ui/cart/cart-store';
import { syncStagePreference } from '@/ui/stage/preference';

export interface TenantClientInfo {
  slug: string;
  name: string;
  logoText: string;
  currency: string;
  numeralSystem: 'latn' | 'arab';
  locales: Locale[];
  defaultLocale: Locale;
}

export interface AppContext {
  tenant: TenantClientInfo;
  locale: Locale;
  table: number | null;
  t: Translate;
  money(amount: number): string;
  href(path?: string): string;
  cart: CartInput;
  itemCount: number;
  quote: QuoteView | null;
  quoting: boolean;
  quoteError: boolean;
  hydrated: boolean;
  addLine(line: CartLineInput): void;
  setQuantity(key: string, quantity: number): void;
  removeLine(key: string): void;
  setBundleQuantity(bundleId: string, quantity: number): void;
  replaceCart(cart: CartInput): void;
  dismissed: string[];
  dismiss(id: string): void;
  announce(message: string): void;
  claimTable(table: number): void;
}

const Context = createContext<AppContext | null>(null);

export function useApp(): AppContext {
  const value = useContext(Context);
  if (!value) throw new Error('useApp must be used inside AppProviders');
  return value;
}

function readTable(slug: string): number | null {
  try {
    const raw = window.localStorage.getItem(`buzzify:table:${slug}`);
    const parsed = raw === null ? Number.NaN : Number(raw);
    return Number.isInteger(parsed) && parsed >= 1 && parsed <= 999 ? parsed : null;
  } catch {
    return null;
  }
}

function writeTable(slug: string, table: number): void {
  try {
    window.localStorage.setItem(`buzzify:table:${slug}`, String(table));
  } catch {
    // Storage can be blocked; the table still applies for this page view.
  }
}

export function AppProviders({
  tenant,
  locale,
  children,
}: {
  tenant: TenantClientInfo;
  locale: Locale;
  children: ReactNode;
}) {
  const [store] = useState<CartStore>(() => createCartStore(`buzzify:cart:${tenant.slug}`));

  const cart = useStore(store, (state) => state.cart);
  const dismissed = useStore(store, (state) => state.dismissed);

  const [hydrated, setHydrated] = useState(false);
  const [table, setTable] = useState<number | null>(null);
  const [resolved, setResolved] = useState<{ key: string; quote: QuoteView | null; error: boolean } | null>(null);
  const [message, setMessage] = useState('');
  const pendingTable = useRef<number | null>(null);

  const t = useMemo(() => getTranslator(locale), [locale]);
  const money = useCallback(
    (amount: number) => formatMoney(amount, tenant.currency, locale, tenant.numeralSystem),
    [tenant.currency, tenant.numeralSystem, locale],
  );
  const href = useCallback((path = '') => `/${tenant.slug}/${locale}${path}`, [tenant.slug, locale]);

  const applyTable = useCallback(
    (next: number) => {
      const previous = readTable(tenant.slug);
      if (previous !== null && previous !== next) store.getState().clear();
      writeTable(tenant.slug, next);
      setTable(next);
    },
    [store, tenant.slug],
  );

  useEffect(() => {
    let active = true;
    Promise.resolve(store.persist.rehydrate()).then(() => {
      if (!active) return;
      setHydrated(true);
      if (pendingTable.current !== null) applyTable(pendingTable.current);
      else setTable(readTable(tenant.slug));
    });
    return () => {
      active = false;
    };
  }, [store, applyTable, tenant.slug]);

  useEffect(() => {
    configureTracking({ slug: tenant.slug, table });
  }, [tenant.slug, table]);

  // Remember a `?stage=` choice now, before any tap can replace the URL.
  useEffect(() => {
    syncStagePreference();
  }, []);

  // The quote is derived from the cart: `requestKey` identifies what must be priced, and the answer is
  // stored with the key it belongs to, so "loading" and "error" are computed rather than set in effects.
  const requestKey = useMemo(() => (isEmpty(cart) ? null : JSON.stringify({ locale, cart })), [cart, locale]);

  useEffect(() => {
    if (!hydrated || requestKey === null) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/${tenant.slug}/quote`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: requestKey,
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`quote ${response.status}`);
        const body = (await response.json()) as { quote: QuoteView };
        setResolved({ key: requestKey, quote: body.quote, error: false });
      } catch {
        if (!controller.signal.aborted) {
          setResolved((previous) => ({ key: requestKey, quote: previous?.quote ?? null, error: true }));
        }
      }
    }, 150);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [hydrated, requestKey, tenant.slug]);

  const quote = requestKey !== null && resolved ? resolved.quote : null;
  const quoting = hydrated && requestKey !== null && resolved?.key !== requestKey;
  const quoteError = requestKey !== null && resolved?.key === requestKey && resolved.error;

  const claimTable = useCallback(
    (next: number) => {
      if (hydrated) applyTable(next);
      else pendingTable.current = next;
    },
    [hydrated, applyTable],
  );

  const value = useMemo<AppContext>(
    () => ({
      tenant,
      locale,
      table,
      t,
      money,
      href,
      cart,
      itemCount: countItems(cart),
      quote,
      quoting,
      quoteError,
      hydrated,
      addLine: (line) => store.getState().add(line),
      setQuantity: (key, quantity) => store.getState().setQuantity(key, quantity),
      removeLine: (key) => store.getState().remove(key),
      setBundleQuantity: (bundleId, quantity) => store.getState().setBundleQuantity(bundleId, quantity),
      replaceCart: (next) => store.getState().replace(next),
      dismissed,
      dismiss: (id) => store.getState().dismiss(id),
      announce: setMessage,
      claimTable,
    }),
    [tenant, locale, table, t, money, href, cart, quote, quoting, quoteError, hydrated, dismissed, store, claimTable],
  );

  return (
    <Context.Provider value={value}>
      {children}
      <div aria-live="polite" role="status" className="sr-only">
        {message}
      </div>
    </Context.Provider>
  );
}

/** Rendered by the QR entry route to tell the shell which table this device is at. */
export function RouteTable({ number }: { number: number }) {
  const { claimTable } = useApp();
  useEffect(() => {
    claimTable(number);
  }, [claimTable, number]);
  return null;
}
