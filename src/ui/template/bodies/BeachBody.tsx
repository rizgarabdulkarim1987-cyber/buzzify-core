'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { MenuProductView } from '@/server/data/menu-view';
import { formatCount } from '@/server/domain/money';
import { useApp } from '@/ui/AppProviders';
import { useTemplate } from '../context';
import { Price, ProductMedia, QuickAction, SaleChip } from '../parts';
import { SectionStrip, ShapeHeading } from './shared/SectionStrip';
import { useOnceInView } from './shared/useOnceInView';
import './shared/photo-card.css';
import './shared/shapes.css';
import './beach.css';

/** One wave: a line of swells, drawn twice in the header (the far one paler and slower). */
const SWELL = 'M0 24 Q 54 6 108 24 T 216 24 T 324 24 T 432 24 T 540 24 T 648 24 T 756 24 T 864 24 V54 H0 Z';

/**
 * Summer Beach (the themed-sum mockup, spec 2026-10-26-menu-styles-in-templates-design.md). A day at the sea: a sky that
 * runs from blue to cream to sand, a header of a sun with turning rays over two drifting waves, a sticky strip of white
 * pills (the one in view orange), then each section a title over its dishes as white cards two across: the card's top
 * rounded and its foot scalloped like a towel's edge, the photo, the name, the price and the orange add on a row. A card
 * bounces up into place the first time it is seen (never again, never with less motion). The header is shown only while no
 * search or filter narrows the menu (hidden, not unmounted); the sun and the waves move for a few seconds on arrival and
 * then stand still. The colours are the template's palette (beach.css), so the default palette is the mockup's blue, sand,
 * cream and orange. All sections are on the page, so the template's own jump and `#cat-<slug>` scrolling reach them.
 */
export function BeachBody() {
  const { view, categories, byCategory, reduced } = useTemplate();
  const { locale, tenant } = useApp();
  const n = (value: number) => formatCount(value, locale, tenant.numeralSystem);
  const root = useRef<HTMLDivElement>(null);
  const seen = useOnceInView(root, reduced, { item: 'data-card', id: 'data-card', mark: 'data-in' });
  const shown = categories.reduce((sum, category) => sum + (byCategory.get(category.id)?.length ?? 0), 0);
  // The sun and the waves move for a few seconds on arrival; this marks the body when they are over so a later show of the header (a cleared search) never replays them.
  const [still, setStill] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setStill(true), 4800);
    return () => window.clearTimeout(timer);
  }, []);
  // The cards already on the first screen come up too, one after the other: the shared hook marks them seen before it arms, so they are armed again once.
  useEffect(() => {
    const host = root.current;
    if (!host || reduced) return;
    host.querySelectorAll<HTMLElement>('[data-card][data-in]').forEach((card) => {
      const box = card.getBoundingClientRect();
      if (box.bottom > 0 && box.top < window.innerHeight) seen.current?.rearm(card);
    });
  }, [reduced, seen]);

  return (
    <div ref={root} className="tpl-body" data-body="beach" data-still={still ? '' : undefined}>
      <div className="bc-sky" hidden={shown !== view.products.length} aria-hidden>
        <i className="bc-sun" />
        <div className="bc-waves">
          {[0, 1].map((at) => (
            <svg key={at} viewBox="0 0 860 54" preserveAspectRatio="none" focusable="false">
              <path d={SWELL} fill="#2fb3d9" />
            </svg>
          ))}
        </div>
      </div>
      <SectionStrip marker="pills" prefix="bc" className="bc-strip" chip="bc-pill">
        {(category) => <span className="bc-pill-label">{category.name}</span>}
      </SectionStrip>
      <main id="menu" className="min-w-0">
        {categories.map((category, index) => {
          const products = byCategory.get(category.id) ?? [];
          return (
            <section key={category.id} id={`cat-${category.slug}`} aria-labelledby={`h-${category.slug}`} className="tpl-section tpl-tall-last bc-band">
              <ShapeHeading id={`h-${category.slug}`} name={category.name} count={n(products.length)} className="bc-head" title="bc-title" />
              <ul className="bc-grid">
                {products.map((product, at) => (
                  <Card key={product.id} product={product} at={at} priority={index < 2 && at < 6} />
                ))}
              </ul>
            </section>
          );
        })}
      </main>
    </div>
  );
}

/** A dish as a white card with a scalloped foot: the photo, the name (the button that opens the dish; the card is its tap area), then the price and the orange add. */
function Card({ product, at, priority }: { product: MenuProductView; at: number; priority: boolean }) {
  const { openProduct } = useTemplate();
  return (
    <li data-row data-card={product.id} className="bc-card" style={{ '--d': `${Math.min(at, 5) * 90}ms` } as CSSProperties}>
      <div data-photo className="bc-photo tpl-cover-media tpl-plate">
        <ProductMedia product={product} suffix="beach" sizes="(min-width: 640px) 240px, 44vw" priority={priority} className="bc-img" rounded={false} />
        <SaleChip product={product} className="tpl-photo-off bc-off" />
      </div>
      <button type="button" onClick={() => openProduct(product.id)} className="tpl-open tpl-dish-name bc-name text-start">
        {product.name}
      </button>
      <div className="bc-foot">
        <Price product={product} className="tpl-price-tight bc-price" />
        <QuickAction product={product} variant="icon" className="bc-add relative z-[2]" />
      </div>
    </li>
  );
}
