'use client';

import dynamic from 'next/dynamic';
import { useEffect, useMemo, useRef, useState } from 'react';
import { matchesQuery } from '@/lib/search';
import type { MenuProductView, MenuView } from '@/server/data/menu-view';
import { track } from '@/ui/analytics/track';
import { useApp } from '@/ui/AppProviders';
import { CartBar } from '@/ui/cart/CartBar';
import { CloseIcon, SearchIcon } from '@/ui/Icons';
import { CategoryRail } from './CategoryRail';
import { Header } from './Header';
import { ProductRow } from './ProductRow';
import { SignatureFeature } from './SignatureFeature';

// Loaded lazily so the menu route does not carry the sheet in its initial JavaScript.
const ProductSheet = dynamic(() => import('@/ui/product/ProductSheet').then((module) => module.ProductSheet));

export function MenuApp({ view }: { view: MenuView }) {
  const { t, href } = useApp();
  const [query, setQuery] = useState('');
  const [activeId, setActiveId] = useState<string | null>(view.categories[0]?.id ?? null);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    track('MENU_VIEW', {}, { once: true });
  }, []);

  // Warm the sheet chunk shortly after the menu is interactive so the first tap feels instant.
  useEffect(() => {
    const warm = setTimeout(() => void import('@/ui/product/ProductSheet'), 1500);
    return () => clearTimeout(warm);
  }, []);

  const visible = useMemo(
    () => view.products.filter((product) => matchesQuery(product.searchKey, query)),
    [view.products, query],
  );
  const byCategory = useMemo(() => {
    const groups = new Map<string, MenuProductView[]>();
    for (const product of visible) groups.set(product.categoryId, [...(groups.get(product.categoryId) ?? []), product]);
    return groups;
  }, [visible]);
  const categories = useMemo(
    () => view.categories.filter((category) => byCategory.has(category.id)),
    [view.categories, byCategory],
  );
  const signature = view.products.find((product) => product.id === view.signatureProductId);

  useEffect(() => {
    const targets = categories
      .map((category) => document.getElementById(`cat-${category.slug}`))
      .filter((element): element is HTMLElement => element !== null);
    if (targets.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const hit = entries.find((entry) => entry.isIntersecting);
        if (hit) {
          const match = categories.find((category) => `cat-${category.slug}` === hit.target.id);
          if (match) setActiveId(match.id);
        }
      },
      { rootMargin: '-30% 0px -60% 0px' },
    );
    targets.forEach((target) => observer.observe(target));
    return () => observer.disconnect();
  }, [categories]);

  // Product sheet history: opening pushes /p/{slug}; Back closes the sheet.
  // `pushed` records that the sheet itself added the /p/{slug} history entry. The router may replace
  // history.state at any time, so closing must not depend on reading it back.
  const pushed = useRef(false);
  const openProduct = (id: string, replace = false) => {
    const product = view.products.find((candidate) => candidate.id === id);
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
      window.history.replaceState({}, '', href());
      setOpenId(null);
    }
  };
  useEffect(() => {
    const onPop = () => {
      pushed.current = false;
      const match = window.location.pathname.match(/\/p\/([^/]+)$/);
      const product = match ? view.products.find((candidate) => candidate.slug === decodeURIComponent(match[1] as string)) : null;
      setOpenId(product?.id ?? null);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [view.products]);

  const opened = openId ? view.products.find((product) => product.id === openId) : undefined;

  return (
    <div className="mx-auto min-h-dvh max-w-2xl pb-28">
      <a
        href="#menu"
        className="sr-only focus:not-sr-only focus:absolute focus:start-3 focus:top-3 focus:z-30 focus:rounded-full focus:bg-accent focus:px-4 focus:py-2 focus:text-on-accent"
      >
        {t('menu.skip')}
      </a>
      <Header />

      <div className="px-5 pb-3">
        <label className="relative block">
          <span className="sr-only">{t('menu.search')}</span>
          <SearchIcon className="pointer-events-none absolute start-0 top-1/2 -translate-y-1/2 text-muted" />
          <input
            type="search"
            role="searchbox"
            aria-label={t('menu.search')}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('menu.searchPlaceholder')}
            className="h-12 w-full rounded-none border-0 border-b border-line bg-transparent ps-9 pe-11 text-base text-text transition-colors duration-150 placeholder:text-muted focus:border-accent"
          />
          {query !== '' && (
            <button
              type="button"
              aria-label={t('menu.clearSearch')}
              onClick={() => setQuery('')}
              className="absolute end-0 top-1/2 grid size-11 -translate-y-1/2 place-items-center text-muted"
            >
              <CloseIcon />
            </button>
          )}
        </label>
      </div>

      {query.trim() === '' && signature && (
        <SignatureFeature product={signature} daypart={view.daypart} onOpen={openProduct} covered={opened !== undefined} />
      )}

      <CategoryRail categories={categories.length > 0 ? categories : view.categories} activeId={activeId} />

      <main id="menu">
        {visible.length === 0 ? (
          <p className="px-5 py-12 text-center text-muted">{t('menu.noResults', { query: query.trim() })}</p>
        ) : (
          categories.map((category) => (
            <section key={category.id} id={`cat-${category.slug}`} aria-labelledby={`h-${category.slug}`} className="scroll-mt-14">
              <h2 id={`h-${category.slug}`} className="px-5 pt-10 pb-1 font-display text-3xl tracking-[-0.005em]">
                {category.name}
              </h2>
              <ul>
                {(byCategory.get(category.id) ?? []).map((product) => (
                  <ProductRow key={product.id} product={product} onOpen={openProduct} />
                ))}
              </ul>
            </section>
          ))
        )}
      </main>

      <CartBar />
      {opened && <ProductSheet product={opened} close={closeProduct} open={openProduct} />}
    </div>
  );
}
