'use client';

import { useEffect, useRef, useState } from 'react';
import type { MenuProductView } from '@/server/data/menu-view';
import { track } from '@/ui/analytics/track';
import { useApp } from '@/ui/AppProviders';

/**
 * Product sheet history, shared by the Quick Menu and Explore: opening pushes /p/{slug}; Back closes
 * the sheet and returns to `homePath`.
 *
 * `pushed` records that the sheet itself added the /p/{slug} history entry. The router may replace
 * history.state at any time, so closing must not depend on reading it back.
 */
export function useProductSheet(products: MenuProductView[], homePath = '', initialId: string | null = null) {
  const { href } = useApp();
  // A product page opened from its own address starts with the product open; closing it replaces the address with the menu's.
  const [openId, setOpenId] = useState<string | null>(initialId);
  const pushed = useRef(false);

  const openProduct = (id: string, replace = false) => {
    const product = products.find((candidate) => candidate.id === id);
    if (!product) return;
    track('PRODUCT_VIEW', { productId: id });
    const url = href(`/p/${product.slug}`);
    if (replace || pushed.current) window.history.replaceState({ sheet: true }, '', url);
    else {
      window.history.pushState({ sheet: true }, '', url);
      pushed.current = true;
    }
    setOpenId(id);
  };

  const closeProduct = () => {
    if (pushed.current) {
      pushed.current = false;
      window.history.back();
    } else {
      window.history.replaceState({}, '', href(homePath));
      setOpenId(null);
    }
  };

  useEffect(() => {
    const onPop = () => {
      pushed.current = false;
      const match = window.location.pathname.match(/\/p\/([^/]+)$/);
      const product = match ? products.find((candidate) => candidate.slug === decodeURIComponent(match[1] as string)) : null;
      setOpenId(product?.id ?? null);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [products]);

  const opened = openId ? products.find((product) => product.id === openId) : undefined;
  return { opened, openProduct, closeProduct };
}
