'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
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
import type { RailStyle } from '@/lib/rail';
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
  /** The brand logo for the theme, shown in place of the logo text. */
  logo?: { url: string; width: number; height: number };
  railStyle: RailStyle;
  currency: string;
  numeralSystem: 'latn' | 'arab';
  locales: Locale[];
  defaultLocale: Locale;
  /** What the restaurant's plan lets these pages show: Explore, the 3D dish, and the rails `?rail=` may preview. */
  features: { explore: boolean; stage: boolean; rails: RailStyle[]; /** Living photos (`guest.livingPhotos`); absent on a cached resolution that predates them. */ livingPhotos?: boolean; /** The table basket (`ordering.tableBasket`). */ tableBasket?: boolean; /** Calling a waiter from the table (`table.callWaiter`). */ callWaiter?: boolean; /** Sharing a dish as a card (`share.dishCards`). */ shareCards?: boolean; /** The stamp card (`loyalty.stampCard`). */ stampCard?: boolean };
  /** Whether the menu carries the complaints and suggestions box. */
  feedback: boolean;
  /** The menu's own page and the wheel: on when the menu switched them on and its plan holds them. */
  extras: { about: boolean; wheel: boolean; aboutTitle: Record<'en' | 'ar' | 'ckb', string> };
  /** The digits of the restaurant's WhatsApp number, when its plan shows the link. */
  whatsapp?: string;
  /** `plain` shows the menu's prices without the currency symbol (the cart keeps it). */
  priceStyle: 'symbol' | 'plain';
}

export interface AppContext {
  tenant: TenantClientInfo;
  locale: Locale;
  table: number | null;
  t: Translate;
  money(amount: number): string;
  /** A price on the menu and dish pages, in the menu's price style. */
  price(amount: number): string;
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
  /** The Studio's preview of a draft: nothing is ordered, priced, suggested or counted. */
  preview: boolean;
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
  preview = false,
  previewRevision,
  children,
}: {
  tenant: TenantClientInfo;
  locale: Locale;
  /** Renders a draft in the Studio: no tracking, quotes, suggestions or search index, and no ordering. */
  preview?: boolean;
  /** A preview of a published revision rather than of the draft: its number, for the banner. */
  previewRevision?: number;
  children: ReactNode;
}) {
  // A preview keeps its own (always empty) cart, so a guest cart of the same menu in this browser never shows in it.
  const [store] = useState<CartStore>(() => createCartStore(`buzzify:${preview ? 'preview-cart' : 'cart'}:${tenant.slug}`));

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
  const price = useCallback(
    (amount: number) => formatMoney(amount, tenant.currency, locale, tenant.numeralSystem, { symbol: tenant.priceStyle !== 'plain' }),
    [tenant.currency, tenant.numeralSystem, tenant.priceStyle, locale],
  );
  const href = useCallback((path = '') => `/${tenant.slug}/${locale}${path}`, [tenant.slug, locale]);

  const applyTable = useCallback(
    (next: number) => {
      const previous = readTable(tenant.slug);
      if (previous !== null && previous !== next) store.getState().clear();
      writeTable(tenant.slug, next);
      try {
        // Which table this visit scanned: ordering from the cart needs it, the remembered table alone is not enough.
        window.sessionStorage.setItem(`buzzify:table-seen:${tenant.slug}`, String(next));
      } catch {
        // Without session storage the guest simply cannot send from the cart.
      }
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
    if (!preview) configureTracking({ slug: tenant.slug, table });
  }, [tenant.slug, table, preview]);

  // Remember a `?stage=` choice now, before any tap can replace the URL. A layout effect, because a tap made while the
  // page was still hydrating is replayed by React right after hydration, before plain effects run: opening a dish then
  // dropped `?stage=` from the URL first, and the choice was lost.
  useLayoutEffect(() => {
    syncStagePreference();
  }, []);

  // The quote is derived from the cart: `requestKey` identifies what must be priced, and the answer is
  // stored with the key it belongs to, so "loading" and "error" are computed rather than set in effects.
  const requestKey = useMemo(() => (isEmpty(cart) ? null : JSON.stringify({ locale, cart })), [cart, locale]);

  useEffect(() => {
    if (preview || !hydrated || requestKey === null) return;
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
  }, [preview, hydrated, requestKey, tenant.slug]);

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
      price,
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
      preview,
    }),
    [tenant, locale, table, t, money, price, href, cart, quote, quoting, quoteError, hydrated, dismissed, store, claimTable, preview],
  );

  return (
    <Context.Provider value={value}>
      {preview && (
        <p className="sticky top-0 z-30 bg-text px-4 py-2 text-center text-sm text-bg" role="note">
          {previewRevision === undefined ? t('preview.banner') : t('preview.bannerRevision', { number: previewRevision })}
        </p>
      )}
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
