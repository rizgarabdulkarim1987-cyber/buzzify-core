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
import './shared/photo-card.css';
import './shared/shapes.css';
import './shared/name-chip.css';
import './station.css';

/**
 * Space Station (spec 2026-10-26-menu-styles-in-templates-design.md). The menu is a modular station. A sticky command strip
 * holds one docking-port chip per section (a round steel port with the section's number, and its name beside it; the one
 * in view is lit in the palette's LED colour) that jumps. Each section is a module: a capsule-shaped hull with a label
 * plate (number, name, dish count on an LED) and a CORRIDOR down its middle: a ribbed spine that runs top to bottom, with
 * the dishes as capsule pods docked to it by short arms, alternately on its start and its end side, each pod half a pod
 * lower than the one before (a zigzag down the spine). A pod holds the photo in a round steel porthole, the price and the
 * add beside it, and the name across its foot. The menu's featured dish (the first featured one, else the first dish) is
 * the planet: its OWN pod, with the porthole drawn as a dashed orbit ring in the LED colour with a moon (and "Featured"
 * for screen readers), so it stands out in place and no dish is ever shown twice. The portholes of a module open once, the
 * first time it comes into view (`useOnceInView` on `[data-module]`; a clip-path transition, off with less motion, never
 * replayed, never hiding a dish when the observer does not report). All modules are on the page, so the template's own
 * jump and `#cat-<slug>` scrolling reach them.
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
      <SectionStrip marker="ports" prefix="st" className="st-strip" chip="tpl-name-chip st-chip">
        {(category) => (
          <>
            <span aria-hidden data-pane={category.id === activeId ? 'active' : 'rest'} className="tpl-chip-no st-port-no">
              {n(placeOf(category) + 1)}
            </span>
            <span className="tpl-chip-name st-chip-name">{category.name}</span>
          </>
        )}
      </SectionStrip>
      <main id="menu" className="min-w-0">
        {categories.map((category, index) => {
          const products = byCategory.get(category.id) ?? [];
          return (
            <section key={category.id} id={`cat-${category.slug}`} data-module={category.id} aria-labelledby={`h-${category.slug}`} className="tpl-section tpl-tall-last st-module">
              <ShapeHeading id={`h-${category.slug}`} name={category.name} label={n(placeOf(category) + 1)} count={n(products.length)} className="st-head" title="st-title" />
              <ul className="st-corridor" data-corridor>
                {products.map((product, at) => (
                  <Pod key={product.id} product={product} at={at} planet={product.id === planet?.id ? t('tpl.featured') : undefined} priority={index < 1 && at < 6} />
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
 * A dish as a capsule pod docked to the spine: the photo in a round steel porthole (the discount on its rim), the price on
 * an LED chip and the add beside it, the name on a status bar across the pod's foot. Pods alternate sides down the spine,
 * each half a pod lower than the one before (`--at` places it). The whole pod opens the dish.
 */
function Pod({ product, at, planet, priority }: { product: MenuProductView; at: number; planet?: string; priority: boolean }) {
  const { openProduct } = useTemplate();
  return (
    <li data-row data-planet={planet ? '' : undefined} data-side={at % 2 === 0 ? 'start' : 'end'} className="st-port" style={{ gridRow: `${at + 1} / span 2` } as CSSProperties}>
      <div className={planet ? 'st-bezel st-orbit' : 'st-bezel'}>
        <div data-photo className="st-glass tpl-cover-media tpl-plate">
          <ProductMedia product={product} suffix="station" sizes="(min-width: 640px) 96px, 20vw" priority={priority} className="st-img" rounded={false} />
        </div>
        <SaleChip product={product} className="tpl-photo-off st-off" />
      </div>
      <Price product={product} className="tpl-price-tight st-led st-price" />
      <QuickAction product={product} variant="icon" className="tpl-rim-add st-add" />
      <button type="button" onClick={() => openProduct(product.id)} className="tpl-open tpl-dish-name st-name">
        {planet ? <span className="sr-only">{planet}: </span> : null}
        {product.name}
      </button>
    </li>
  );
}
