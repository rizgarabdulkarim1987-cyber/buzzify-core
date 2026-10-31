'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { MenuProductView } from '@/server/data/menu-view';
import { formatCount } from '@/server/domain/money';
import { useApp } from '@/ui/AppProviders';
import { useTemplate } from '../context';
import { DishCounts, Price, ProductMedia, QuickAction, SaleChip } from '../parts';
import { SectionStrip, ShapeHeading } from './shared/SectionStrip';
import { useOnceInView } from './shared/useOnceInView';
import './shared/photo-card.css';
import './shared/shapes.css';
import './lattice.css';

/** The three lamps' places along the header (percent from the start) and the swing each starts at. */
const LAMPS = [18, 46, 74] as const;

/**
 * Baghdad Shanashil (the themed-shn mockup, spec 2026-10-26-menu-styles-in-templates-design.md). Old Baghdad's oriel
 * windows at dusk: a header of a deep Tigris sky with three brass lamps that swing and a turquoise river that flows
 * (a few seconds, then still), a dark wooden strip of tabs (the one in view turquoise), then each section a title over
 * its dishes as arched cards two across: a dark carved plank with an arched window framed in brass holding the photo,
 * behind two lattice shutters that swing open once when the card is first seen (never again, never with less motion),
 * the name, then the price and the turquoise add on a row. The header is shown only while no search or filter narrows
 * the menu (hidden, not unmounted). The colours are the template's palette (lattice.css), so the default palette is the
 * mockup's cream, brown and turquoise. All sections are on the page, so the template's own jump and `#cat-<slug>`
 * scrolling reach them.
 */
export function LatticeBody() {
  const { locale, tenant } = useApp();
  const { view, categories, byCategory, reduced } = useTemplate();
  const root = useRef<HTMLDivElement>(null);
  const seen = useOnceInView(root, reduced, { item: 'data-pane', id: 'data-pane', mark: 'data-open' });
  const n = (value: number) => formatCount(value, locale, tenant.numeralSystem);
  const shown = categories.reduce((sum, category) => sum + (byCategory.get(category.id)?.length ?? 0), 0);
  // The lamps and the river move for a few seconds on arrival; this marks the body when they are over so a later show of the sky (a cleared search) never replays them.
  const [still, setStill] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setStill(true), 4800);
    return () => window.clearTimeout(timer);
  }, []);

  // The cards already on the first screen open their shutters too, one after the other: the shared hook marks them seen before it arms, so they are armed again once.
  useEffect(() => {
    const host = root.current;
    if (!host || reduced) return;
    host.querySelectorAll<HTMLElement>('[data-pane][data-open]').forEach((card) => {
      const box = card.getBoundingClientRect();
      if (box.bottom > 0 && box.top < window.innerHeight) seen.current?.rearm(card);
    });
  }, [reduced, seen]);

  return (
    <div ref={root} className="tpl-body" data-body="lattice" data-still={still ? '' : undefined}>
      <div className="sh-sky" hidden={shown !== view.products.length} aria-hidden>
        {LAMPS.map((at, index) => (
          <i key={at} className="sh-lamp" style={{ insetInlineStart: `${at}%`, animationDelay: `-${index * 0.4}s` } as CSSProperties} />
        ))}
        <svg className="sh-river" viewBox="0 0 860 46" preserveAspectRatio="none" focusable="false">
          <path d="M0 18 Q 53 4 107 18 T 215 18 T 322 18 T 430 18 T 537 18 T 645 18 T 752 18 T 860 18 V46 H0 Z" fill="#3f9fb8" opacity=".8" />
          <path d="M0 28 Q 53 16 107 28 T 215 28 T 322 28 T 430 28 T 537 28 T 645 28 T 752 28 T 860 28 V46 H0 Z" fill="#1f6d8a" />
        </svg>
      </div>
      <SectionStrip marker="oriels" prefix="sh" className="sh-strip" chip="sh-tab">
        {(category) => <span className="sh-tab-label">{category.name}</span>}
      </SectionStrip>
      <main id="menu" className="min-w-0">
        {categories.map((category, index) => {
          const products = byCategory.get(category.id) ?? [];
          return (
            <section key={category.id} id={`cat-${category.slug}`} aria-labelledby={`h-${category.slug}`} className="tpl-section tpl-tall-last sh-bay">
              <ShapeHeading id={`h-${category.slug}`} name={category.name} count={n(products.length)} className="sh-head" title="sh-title" />
              <ul className="sh-grid">
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

/**
 * A dish as an arched card: the window with the photo behind its two shutters (the discount on the window's foot), the
 * name, then the price and the add. The name's button is the whole card's tap area.
 */
function Card({ product, at, priority }: { product: MenuProductView; at: number; priority: boolean }) {
  const { openProduct } = useTemplate();
  return (
    <li data-row data-pane={product.id} className="sh-card" style={{ '--d': `${Math.min(at, 5) * 90}ms` } as CSSProperties}>
      <div className="sh-window">
        <div data-photo className="sh-photo tpl-cover-media tpl-plate">
          <ProductMedia product={product} suffix="lattice" sizes="(min-width: 640px) 240px, 44vw" priority={priority} className="sh-img" rounded={false} />
        </div>
        <i aria-hidden className="sh-shutter sh-shutter-end" />
        <i aria-hidden className="sh-shutter sh-shutter-start" />
        <SaleChip product={product} className="tpl-photo-off sh-off" />
      </div>
      <button type="button" onClick={() => openProduct(product.id)} className="tpl-open tpl-dish-name sh-name">
        {product.name}
      </button>
      <DishCounts product={product} />
      <div className="sh-foot">
        <Price product={product} className="tpl-price-tight sh-price" />
        <QuickAction product={product} variant="icon" className="sh-add relative z-[2]" />
      </div>
    </li>
  );
}
