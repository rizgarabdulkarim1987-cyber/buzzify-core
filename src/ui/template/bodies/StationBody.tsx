'use client';

import { useRef, type CSSProperties } from 'react';
import type { MenuProductView } from '@/server/data/menu-view';
import { formatCount } from '@/server/domain/money';
import { useApp } from '@/ui/AppProviders';
import { useTemplate } from '../context';
import { Price, ProductMedia, QuickAction, SaleChip } from '../parts';
import { SectionStrip, ShapeHeading } from './shared/SectionStrip';
import { useOnceInView } from './shared/useOnceInView';
import { usePlaceOf } from './shared/usePlaceOf';
import './shared/shapes.css';
import './station.css';

/**
 * Space Station (spec 2026-10-26-menu-styles-in-templates-design.md). The menu is a modular station. A sticky command strip
 * holds one round docking-port chip per section (a steel ring, the number in the menu's numerals; the one in view is
 * lit in the palette's accent) that jumps. The menu's featured dish (the first featured one, else the first dish) is a
 * small planet, the first cell of the first module (so the first screen keeps its dishes): a round photo on a dashed orbit ring with a moon, its name and price. Each
 * section is a module, a capsule-shaped corridor panel (rounded ends, rivets and panel lines drawn with gradients) with
 * a label plate (number, name, dish count on an LED), and its dishes are portholes three across: a round steel bezel
 * round the photo, the name on a status-bar label under it, the price on an LED chip. The portholes of a module open
 * once, the first time it comes into view (`useOnceInView` on `[data-module]`; a clip-path transition, off with less
 * motion, never replayed, never hiding a dish when the observer does not report). All modules are on the page, so the
 * template's own jump and `#cat-<slug>` scrolling reach them.
 */
export function StationBody() {
  const { locale, tenant, t } = useApp();
  const { categories, byCategory, featured, activeId, reduced } = useTemplate();
  const root = useRef<HTMLDivElement>(null);
  useOnceInView(root, reduced, { item: 'data-module', id: 'data-module', mark: 'data-open' });
  const n = (value: number) => formatCount(value, locale, tenant.numeralSystem);
  // Numbers go by the section's place in the full menu, so a search never renumbers a module or its docking port.
  const placeOf = usePlaceOf();
  // The planet: the featured dish while it is still among the results, else the first dish when the menu names none.
  const shown = categories.flatMap((category) => byCategory.get(category.id) ?? []);
  const first = featured[0] ?? shown[0];
  const planet = first && shown.some((product) => product.id === first.id) ? first : undefined;

  return (
    <div ref={root} className="tpl-body" data-body="station">
      <SectionStrip marker="ports" prefix="st" className="st-strip" chip="st-chip">
        {(category) => (
          <>
            <span aria-hidden data-pane={category.id === activeId ? 'active' : 'rest'} className="st-port-no">
              {n(placeOf(category) + 1)}
            </span>
            <span className="sr-only">{category.name}</span>
          </>
        )}
      </SectionStrip>
      <main id="menu" className="min-w-0">
        {categories.map((category, index) => {
          const products = byCategory.get(category.id) ?? [];
          return (
            <section key={category.id} id={`cat-${category.slug}`} data-module={category.id} aria-labelledby={`h-${category.slug}`} className="tpl-section tpl-tall-last st-module">
              <ShapeHeading id={`h-${category.slug}`} name={category.name} label={n(placeOf(category) + 1)} count={n(products.length)} className="st-head" title="st-title" />
              <ul className="st-grid">
                {index === 0 && planet ? <Planet product={planet} label={t('tpl.featured')} /> : null}
                {products.map((product, at) => (
                  <Porthole key={product.id} product={product} at={at} priority={index < 1 && at < 6} />
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
 * The featured dish as a small planet: the first cell of the first module, a round photo on a dashed orbit ring with a moon,
 * its name (the screen-reader label says "Featured") and its price on an LED chip. The whole cell opens the dish (its add
 * is on its porthole below).
 */
function Planet({ product, label }: { product: MenuProductView; label: string }) {
  const { openProduct } = useTemplate();
  return (
    <li className="st-planet" data-planet>
      <div className="st-orbit" aria-hidden>
        <div className="st-orb tpl-cover-media tpl-plate">
          <ProductMedia product={product} suffix="station-planet" sizes="(min-width: 640px) 18vw, 28vw" priority className="st-img" rounded={false} />
        </div>
      </div>
      <button type="button" onClick={() => openProduct(product.id)} className="tpl-open tpl-dish-name st-planet-name">
        <span className="sr-only">{label}: </span>
        {product.name}
      </button>
      <Price product={product} className="tpl-price-tight st-led st-planet-price" />
    </li>
  );
}

/** A dish as a porthole: the photo in a round steel bezel (the add on the bezel foot, the discount on its start), the name on a status bar under it, the price on an LED chip. The whole cell opens the dish. */
function Porthole({ product, at, priority }: { product: MenuProductView; at: number; priority: boolean }) {
  const { openProduct } = useTemplate();
  return (
    <li data-row className="st-port" style={{ '--at': at } as CSSProperties}>
      <div className="st-bezel">
        <div data-photo className="st-glass tpl-cover-media tpl-plate">
          <ProductMedia product={product} suffix="station" sizes="(min-width: 1024px) 150px, (min-width: 640px) 18vw, 28vw" priority={priority} className="st-img" rounded={false} />
        </div>
        <SaleChip product={product} className="tpl-photo-off st-off" />
        <QuickAction product={product} variant="icon" className="tpl-rim-add st-add" />
      </div>
      <button type="button" onClick={() => openProduct(product.id)} className="tpl-open tpl-dish-name st-name">
        {product.name}
      </button>
      <Price product={product} className="tpl-price-tight st-led st-price" />
    </li>
  );
}
