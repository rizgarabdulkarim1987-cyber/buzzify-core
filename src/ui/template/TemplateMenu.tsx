'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { HEX } from '@/lib/brand';
import { isDietaryTag, type DietaryTag } from '@/lib/product-tags';
import { matchesQuery } from '@/lib/search';
import { bodyOf, SHAPE_SETS, type MenuDesign } from '@/lib/templates/types';
import type { MenuProductView, MenuView } from '@/server/data/menu-view';
import { track } from '@/ui/analytics/track';
import { useApp } from '@/ui/AppProviders';
import { CartBar } from '@/ui/cart/CartBar';
import { useSearchIndex } from '@/ui/menu/useSearchIndex';
import { useProductSheet } from '@/ui/product/useProductSheet';
import { SceneLayer } from '@/ui/scenes/SceneLayer';
import { usePrefersReducedMotion } from '@/ui/use-prefers-reduced-motion';
import { BODIES } from './bodies';
import { ProductList } from './cards';
import { FilterBar, InfoSection, OfferList, PromoCard, SearchField, TemplateFooter, TemplateHeader } from './chrome';
import { TemplateContext, type TemplateContextValue } from './context';
import { designStyle } from './design-style';
import { Hero, SignatureStrip, showsSignatureStrip } from './heroes';
import { Nav } from './navs';
import { SectionHeading } from './sections';
import { useFavorites } from './favorites';
import './skins.css';

// The product's surface loads on demand, so the menu's first JavaScript does not carry it.
const TemplateDetail = dynamic(() => import('@/ui/product/TemplateDetail'));

/** How many products the hero features when the business picked none. */
const FEATURED_FALLBACK = 6;

/**
 * A menu drawn with a template preset (spec `2026-10-18-template-studio-design.md`, section 5). The design is the
 * snapshot's resolved one, so what guests see is exactly what was published; the Studio's preview passes a design of
 * its own to show changes before they are saved.
 */
export function TemplateMenu({
  view,
  design,
  tagline,
  fontClass,
  initialProductId = null,
}: {
  view: MenuView;
  design: MenuDesign;
  tagline?: string;
  /** The pair's font classes, when the page's own root carries another pair (a Studio preview). */
  fontClass?: string;
  /** A product page: the menu with this product open. */
  initialProductId?: string | null;
}) {
  const { t, tenant, preview, addLine, announce } = useApp();
  const reduced = usePrefersReducedMotion();
  const [query, setQuery] = useState('');
  const [dietary, setDietary] = useState<ReadonlySet<DietaryTag>>(new Set());
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [variantId, setVariantId] = useState<string | null>(null);
  const [motionPaused, setMotionPaused] = useState(false);
  const { keys: searchKeys, load: loadSearchIndex } = useSearchIndex(tenant.slug, !preview);
  const favorites = useFavorites(tenant.slug);

  useEffect(() => {
    track('MENU_VIEW', {}, { once: true });
  }, []);

  // Warm the product surface shortly after the menu is interactive so the first tap feels instant.
  useEffect(() => {
    const warm = setTimeout(() => void import('@/ui/product/TemplateDetail'), 1500);
    return () => clearTimeout(warm);
  }, []);

  const dietaryAvailable = useMemo(() => new Set(view.products.flatMap((product) => (product.dietary ?? []).filter(isDietaryTag))), [view.products]);

  const visible = useMemo(
    () =>
      view.products.filter(
        (product) =>
          matchesQuery(searchKeys?.[product.id] ?? product.searchKey, query) &&
          [...dietary].every((tag) => product.dietary?.includes(tag)) &&
          (!favoritesOnly || favorites.has(product.id)),
      ),
    [view.products, searchKeys, query, dietary, favoritesOnly, favorites],
  );
  const byCategory = useMemo(() => {
    const groups = new Map<string, MenuProductView[]>();
    for (const product of visible) groups.set(product.categoryId, [...(groups.get(product.categoryId) ?? []), product]);
    return groups;
  }, [visible]);
  const categories = useMemo(() => view.categories.filter((category) => byCategory.has(category.id)), [view.categories, byCategory]);
  const [activeId, setActiveId] = useState<string | null>(view.categories[0]?.id ?? null);

  const signature = view.products.find((product) => product.id === view.signatureProductId);
  const featured = useMemo(() => {
    const bySlug = new Map(view.products.map((product) => [product.slug, product]));
    const chosen = design.featured.slugs.map((slug) => bySlug.get(slug)).filter((product): product is MenuProductView => product !== undefined);
    if (chosen.length > 0) return chosen;
    const flagged = view.products.filter((product) => product.featured);
    if (flagged.length > 0) return flagged.slice(0, FEATURED_FALLBACK);
    const pictured = view.products.filter((product) => product.media[0]?.kind === 'image');
    return (pictured.length >= 3 ? pictured : view.products).slice(0, FEATURED_FALLBACK);
  }, [view.products, design.featured.slugs]);

  // The category in view, for the navigation's `aria-current`.
  useEffect(() => {
    const targets = categories.map((category) => document.getElementById(`cat-${category.slug}`)).filter((element): element is HTMLElement => element !== null);
    if (targets.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const hit = entries.find((entry) => entry.isIntersecting);
        const match = hit ? categories.find((category) => `cat-${category.slug}` === hit.target.id) : undefined;
        if (match) setActiveId(match.id);
      },
      { rootMargin: '-30% 0px -60% 0px' },
    );
    targets.forEach((target) => observer.observe(target));
    return () => observer.disconnect();
  }, [categories]);

  const opener = useRef<((categoryId: string) => void) | null>(null);
  const setCategoryOpener = useCallback((next: ((categoryId: string) => void) | null) => {
    opener.current = next;
  }, []);
  const jumpTo = useCallback(
    (categoryId: string) => {
      const category = view.categories.find((candidate) => candidate.id === categoryId);
      if (category && opener.current) {
        setActiveId(categoryId);
        opener.current(categoryId);
        return;
      }
      const target = category ? document.getElementById(`cat-${category.slug}`) : null;
      if (!target) return;
      setActiveId(categoryId);
      target.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
      // Move focus to the heading so keyboard and screen reader users land where the page moved to.
      target.querySelector<HTMLElement>('[data-heading]')?.focus({ preventScroll: true });
    },
    [view.categories, reduced],
  );

  const { opened, openProduct: openSheet, closeProduct } = useProductSheet(view.products, '', initialProductId);
  const openProduct = useCallback(
    (productId: string, variant: string | null = null) => {
      setVariantId(variant);
      openSheet(productId);
    },
    [openSheet],
  );

  const canOrder = design.ordering === 'list' && !preview;
  const quickAdd = useCallback(
    (product: MenuProductView) => {
      addLine({ productId: product.id, variantId: null, optionIds: [], quantity: 1 });
      track('ADD_TO_CART', { productId: product.id, payload: { source: 'quick-add' } });
      announce(t('cart.added', { name: product.name }));
    },
    [addLine, announce, t],
  );

  const context = useMemo<TemplateContextValue>(
    () => ({
      design,
      view,
      categories,
      byCategory,
      featured,
      signature,
      activeId,
      jumpTo,
      setCategoryOpener,
      openProduct,
      canOrder,
      quickAdd,
      isFavorite: favorites.has,
      toggleFavorite: (product) => favorites.toggle(product.id),
      reduced,
    }),
    [design, view, categories, byCategory, featured, signature, activeId, jumpTo, setCategoryOpener, openProduct, canOrder, quickAdd, favorites, reduced],
  );

  const toggleDietary = (tag: DietaryTag) =>
    setDietary((current) => {
      const next = new Set(current);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });

  const { layout } = design;
  const body = bodyOf(layout);
  // A browse shape that sets the hero or the navigation replaces them: a big hero or a scroll-only navigation left in
  // the layout (from the template it started on) must not reach it. For `scroll` nothing is set, so nothing changes.
  const shapeSets = SHAPE_SETS[body];
  // A shape's own component (`BODIES`); `scroll` is drawn below and never looked up.
  const Body = body === 'scroll' ? null : BODIES[body];
  const heroKind = shapeSets.includes('hero') ? 'compact' : layout.hero;
  const navKind = shapeSets.includes('nav') ? undefined : layout.nav;
  const noResults = <p className="px-(--gutter) py-16 text-center text-(--muted)">{t('menu.noResults', { query: query.trim() || '…' })}</p>;
  const animated = design.scene.mode !== 'static' && !reduced;
  // Only validated colours reach the page's own background (the root's colour shows around the menu).
  const page = HEX.test(design.palette.bg) && HEX.test(design.palette.text) ? `html,body{background:${design.palette.bg};color:${design.palette.text}}` : '';

  return (
    <TemplateContext.Provider value={context}>
      {page && <style dangerouslySetInnerHTML={{ __html: page }} />}
      <div
        className={`tpl tpl-${design.templateId} ${fontClass ?? ''}`}
        style={designStyle(design)}
        data-template={design.templateId}
        data-nav={navKind}
        data-card={layout.card}
        data-theme-mode={design.theme}
      >
        <SceneLayer design={design} paused={motionPaused || opened !== undefined} categoryIndex={Math.max(0, categories.findIndex((category) => category.id === activeId))} />
        <div className="tpl-content relative z-[1] mx-auto min-h-dvh max-w-6xl pb-32">
          <a href="#menu" className="tpl-skip">
            {t('menu.skip')}
          </a>
          <TemplateHeader />
          {query.trim() === '' && <Hero kind={heroKind} tagline={tagline} />}
          {query.trim() === '' && showsSignatureStrip(heroKind, body, signature !== undefined) && <SignatureStrip />}
          {design.promo && query.trim() === '' && <PromoCard promo={design.promo} />}
          {query.trim() === '' && <OfferList offers={view.offers} />}
          <div className="tpl-tools flex flex-col gap-3">
            {/* The Book has no search box: its index is how guests find a section (the owner's wish). */}
            {body !== 'book' && <SearchField query={query} onQuery={setQuery} onFocus={loadSearchIndex} />}
            <FilterBar
              available={dietaryAvailable}
              chosen={dietary}
              onToggle={toggleDietary}
              favorites={favorites.count}
              favoritesOnly={favoritesOnly}
              onFavorites={() => setFavoritesOnly((value) => !value)}
              onClear={() => {
                setDietary(new Set());
                setFavoritesOnly(false);
              }}
            />
          </div>
          {body === 'scroll' ? (
            <div className="tpl-body">
              {categories.length > 0 && <Nav kind={layout.nav} />}
              <main id="menu" className="tpl-main min-w-0">
                {visible.length === 0 ? (
                  noResults
                ) : (
                  categories.map((category, index) => (
                    <section key={category.id} id={`cat-${category.slug}`} aria-labelledby={`h-${category.slug}`} className="tpl-section">
                      <div tabIndex={-1} data-heading className="outline-none">
                        <SectionHeading id={`h-${category.slug}`} name={category.name} index={index} style={layout.heading} />
                      </div>
                      <div className="tpl-section-body">
                        <ProductList products={byCategory.get(category.id) ?? []} kind={layout.card} />
                      </div>
                    </section>
                  ))
                )}
              </main>
            </div>
          ) : visible.length === 0 ? (
            <main id="menu" className="tpl-main min-w-0">
              {noResults}
            </main>
          ) : (
            Body && <Body />
          )}
          <InfoSection info={design.info} />
          <TemplateFooter poweredBy={design.poweredBy} motion={animated ? { paused: motionPaused, toggle: () => setMotionPaused((value) => !value) } : null} />
        </div>
        {canOrder && <CartBar />}
        {opened && (
          <TemplateDetail
            product={opened}
            kind={layout.detail}
            optionStyle={layout.options}
            canOrder={canOrder}
            initialVariantId={variantId}
            favorite={favorites.has(opened.id)}
            onFavorite={() => favorites.toggle(opened.id)}
            onClose={closeProduct}
            onSwitch={(id) => openProduct(id)}
          />
        )}
      </div>
    </TemplateContext.Provider>
  );
}
