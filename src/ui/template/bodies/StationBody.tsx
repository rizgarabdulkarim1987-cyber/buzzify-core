'use client';

import { useRef, useState } from 'react';
import type { MenuProductView } from '@/server/data/menu-view';
import { formatCount } from '@/server/domain/money';
import { useApp } from '@/ui/AppProviders';
import { useTemplate } from '../context';
import { Price, ProductMedia, QuickAction, SaleChip } from '../parts';
import { SectionStrip, ShapeHeading } from './shared/SectionStrip';
import { useOnceInView } from './shared/useOnceInView';
import { usePlaceOf } from './shared/usePlaceOf';
import './shared/photo-card.css';
import './shared/shapes.css';
import './shared/name-chip.css';
import './station.css';

/**
 * Space Station (poster themed-spc of the 35 mockups; spec 2026-10-26-menu-styles-in-templates-design.md). The menu is a
 * station seen through its portholes. The menu's featured dish (the first featured one, else the first dish) is the PLANET:
 * one big round photo in the middle of the first screen, ringed by a dashed orbit with a moon on it, its name, price and add
 * beside it on one row (it is the dish's own cell, so no dish is shown twice; with no other dish in its section it stays in
 * the grid and there is no planet). Under it a sticky strip of docking chips (one per section, the one in view lit in the
 * accent) jumps. Each section is a deck: a bold heading with its number on a small mono label, and a two-column grid of big
 * round portholes (a brushed-steel bezel round the photo, the discount on its rim), the name under each, the price and the
 * add on a row below. The portholes of a deck open once, the first time it comes into view (`useOnceInView` on
 * `[data-module]`; a clip-path transition, off with less motion, never replayed, never hiding a dish when the observer does
 * not report). All decks are on the page, so the template's own jump and `#cat-<slug>` scrolling reach them. The orbit turns
 * once, in under five seconds, and stops.
 */
export function StationBody() {
  const { locale, tenant, t } = useApp();
  const { categories, byCategory, featured, reduced } = useTemplate();
  const root = useRef<HTMLDivElement>(null);
  useOnceInView(root, reduced, { item: 'data-module', id: 'data-module', mark: 'data-open' });
  const n = (value: number) => formatCount(value, locale, tenant.numeralSystem);
  // Numbers go by the section's place in the full menu, so a search never renumbers a deck.
  const placeOf = usePlaceOf();
  // The orbit turns once: a planet that mounts later (a search cleared) is already at rest.
  const [turned, setTurned] = useState(false);
  // The planet: the featured dish while it is still among the results (and not alone in its section), else the first dish.
  const first = featured[0] ?? categories.flatMap((category) => byCategory.get(category.id) ?? [])[0];
  const home = first ? categories.find((category) => (byCategory.get(category.id) ?? []).some((product) => product.id === first.id)) : undefined;
  const planet = first && home && (byCategory.get(home.id) ?? []).length > 1 ? first : undefined;

  return (
    <div ref={root} className="tpl-body" data-body="station">
      {planet ? <Planet product={planet} label={t('tpl.featured')} turned={turned} onTurned={() => setTurned(true)} /> : null}
      <SectionStrip marker="ports" prefix="st" className="st-strip" chip="tpl-name-chip st-chip">
        {(category) => <span className="tpl-chip-name st-chip-name">{category.name}</span>}
      </SectionStrip>
      <main id="menu" className="min-w-0">
        {categories.map((category, index) => {
          const products = (byCategory.get(category.id) ?? []).filter((product) => product.id !== planet?.id);
          return (
            <section key={category.id} id={`cat-${category.slug}`} data-module={category.id} aria-labelledby={`h-${category.slug}`} className="tpl-section tpl-tall-last st-deck">
              <ShapeHeading id={`h-${category.slug}`} name={category.name} label={n(placeOf(category) + 1)} count={n(products.length)} className="st-head" title="st-title" />
              <ul className="st-grid" data-corridor>
                {products.map((product, at) => (
                  <Port key={product.id} product={product} priority={index < 1 && at < 4} />
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
 * The planet: the featured dish as one big round photo in the middle of the screen, a dashed orbit ring turning once round
 * it with a moon on it, then its name, price and add on one row (the sale chip on the photo's rim). The whole cell opens the
 * dish; it sits above the strip and the sections, so it is the first thing a guest sees.
 */
function Planet({ product, label, turned, onTurned }: { product: MenuProductView; label: string; turned: boolean; onTurned: () => void }) {
  const { openProduct } = useTemplate();
  return (
    <div className="st-hero">
      <div data-row data-planet data-turned={turned ? '' : undefined} className="st-planet">
        <div className="st-sky">
          <span aria-hidden className="st-orbit" onAnimationEnd={onTurned} />
          <div className="st-world">
            <div data-photo className="st-glass tpl-cover-media tpl-plate">
              <ProductMedia product={product} suffix="station" sizes="(min-width: 640px) 320px, 52vw" priority className="st-img" rounded={false} />
            </div>
          </div>
          <SaleChip product={product} className="tpl-photo-off st-off" />
        </div>
        <div className="st-cap">
          <button type="button" onClick={() => openProduct(product.id)} className="tpl-open tpl-display st-planet-name">
            <span className="sr-only">{label}: </span>
            {product.name}
          </button>
          <div className="st-meta">
            <Price product={product} className="st-price" />
            <QuickAction product={product} variant="icon" className="tpl-rim-add st-add" />
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * A dish as a porthole: the photo in a round steel bezel (the discount on its rim), the name under it, the price and the add
 * on a row below. The whole cell opens the dish.
 */
function Port({ product, priority }: { product: MenuProductView; priority: boolean }) {
  const { openProduct } = useTemplate();
  return (
    <li data-row className="st-port">
      <div className="st-bezel">
        <div data-photo className="st-glass tpl-cover-media tpl-plate">
          <ProductMedia product={product} suffix="station" sizes="(min-width: 640px) 160px, 40vw" priority={priority} className="st-img" rounded={false} />
        </div>
        <SaleChip product={product} className="tpl-photo-off st-off" />
      </div>
      <button type="button" onClick={() => openProduct(product.id)} className="tpl-open tpl-dish-name st-name">
        {product.name}
      </button>
      <div className="st-meta">
        <Price product={product} className="st-price" />
        <QuickAction product={product} variant="icon" className="tpl-rim-add st-add" />
      </div>
    </li>
  );
}
