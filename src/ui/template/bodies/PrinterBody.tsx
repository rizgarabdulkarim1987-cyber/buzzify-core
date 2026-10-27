'use client';

import { useEffect, useRef, type CSSProperties, type RefObject } from 'react';
import { localDigits } from '@/lib/digits';
import { formatCount } from '@/server/domain/money';
import { useApp } from '@/ui/AppProviders';
import { useTemplate } from '../context';
import type { MenuProductView } from '@/server/data/menu-view';
import { Price, ProductMedia, QuickAction, SaleChip } from '../parts';
import { SectionStrip, ShapeHeading } from './shared/SectionStrip';
import { useOnceInView } from './shared/useOnceInView';
import { usePlaceOf } from './shared/usePlaceOf';
import './shared/photo-card.css';
import './shared/shapes.css';
import './shared/name-chip.css';
import './printer.css';

/** A layer's number in its part: 001, 002 ... (the digits are written in the menu's numerals by the body). */
export function layerNumber(at: number): string {
  return String(at + 1).padStart(3, '0');
}

/** The share of a part's cells the printhead has been over: all of them until the page is armed, then the ones seen. */
export function printedShare(armed: boolean, seen: number, total: number): number {
  if (!armed || total === 0) return 1;
  return Math.min(seen, total) / total;
}

/** The delay of a cell's printhead sweep, by its place in its part (capped, so every motion ends inside five seconds). */
export function sweepDelay(at: number): number {
  return Math.min(at, 6) * 90;
}

/**
 * Keeps each part's Z rail filled with the share of its cells printed (`--pr-done` on `[data-part]`, read by the CSS). It
 * writes the custom property straight onto the part from a MutationObserver on `data-print`, never through React state,
 * so a printed cell re-renders nothing. Layout only reads; decoration only.
 */
function useZRail(root: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const host = root.current;
    if (!host) return;
    const fill = () => {
      const armed = host.hasAttribute('data-armed');
      host.querySelectorAll<HTMLElement>('[data-part]').forEach((part) => {
        const share = printedShare(armed, part.querySelectorAll('[data-print]').length, part.querySelectorAll('[data-slab]').length);
        part.style.setProperty('--pr-done', String(share));
      });
    };
    const watch = new MutationObserver(fill);
    watch.observe(host, { attributes: true, attributeFilter: ['data-print', 'data-armed'], subtree: true, childList: true });
    fill();
    return () => watch.disconnect();
  }, [root]);
}

/**
 * The 3D Printer (spec 2026-10-26-menu-styles-in-templates-design.md). The menu is a print job. A sticky strip of nozzle
 * chips (the part's number and its name; the one in view is lit) jumps to a part. Each section is a PRINT BED: its heading
 * is the X-axis ruler across the top (the part label, the name, the count, tick marks under them), a Z-axis rail runs down
 * the bed's start edge (ticks, and a fill that rises with the cells printed), and the dishes are printed parts standing
 * on a gridded build plate, TWO across: each part a cell with the photo as a printed slab (layer lines across it, its
 * layer code such as L012 on its corner, the price tag (and any discount) and the add at its foot) and the name under it. A printhead
 * sweeps across a cell once, the first time it comes into view (`useOnceInView` on `[data-slab]`: a transform and opacity
 * on a layer that takes no tap, off with less motion, never replayed); the cells are always there to read, the sweep only
 * draws over them. All parts are on the page, so the template's own jump and `#cat-<slug>` scrolling reach them.
 */
export function PrinterBody() {
  const { locale, tenant, t } = useApp();
  const { categories, byCategory, activeId, reduced } = useTemplate();
  const root = useRef<HTMLDivElement>(null);
  useOnceInView(root, reduced, { item: 'data-slab', id: 'data-slab', mark: 'data-print' });
  useZRail(root);
  const n = (value: number) => formatCount(value, locale, tenant.numeralSystem);
  // Numbers go by the section's place in the full menu, so a search never renumbers a part.
  const placeOf = usePlaceOf();

  return (
    <div ref={root} className="tpl-body" data-body="printer">
      <SectionStrip marker="nozzles" prefix="pr" className="pr-strip" chip="tpl-name-chip pr-chip">
        {(category) => (
          <>
            <span aria-hidden className="tpl-chip-no pr-chip-no">
              <b data-pane={category.id === activeId ? 'active' : 'rest'}>{n(placeOf(category) + 1)}</b>
            </span>
            <span className="tpl-chip-name pr-chip-name">{category.name}</span>
          </>
        )}
      </SectionStrip>
      <main id="menu" className="min-w-0">
        {categories.map((category, index) => {
          const products = byCategory.get(category.id) ?? [];
          return (
            <section key={category.id} id={`cat-${category.slug}`} data-part={category.id} aria-labelledby={`h-${category.slug}`} className="tpl-section tpl-tall-last pr-part">
              <ShapeHeading id={`h-${category.slug}`} name={category.name} label={t('tpl.prn.part', { n: n(placeOf(category) + 1) })} count={n(products.length)} className="pr-head" title="pr-title" />
              <div className="pr-bed" data-bed>
                <span aria-hidden className="pr-zrail">
                  <i />
                </span>
                <ul className="pr-plate">
                  {products.map((product, at) => (
                    <Cell key={product.id} product={product} at={at} code={`L${localDigits(layerNumber(at), tenant.numeralSystem)}`} priority={index < 2 && at < 4} />
                  ))}
                </ul>
              </div>
            </section>
          );
        })}
      </main>
    </div>
  );
}

/**
 * A printed part on the bed: the photo as a slab (layer lines across it, the code on its corner, the price tag with any
 * discount beside it and the add at its foot), the name under it, the printhead's lane over it. The whole cell opens
 * the dish.
 */
function Cell({ product, at, code, priority }: { product: MenuProductView; at: number; code: string; priority: boolean }) {
  const { openProduct } = useTemplate();
  return (
    <li data-row data-slab={product.id} className="tpl-photo-card pr-slab" style={{ '--pr-delay': `${sweepDelay(at)}ms` } as CSSProperties}>
      <div data-photo className="pr-photo tpl-cover-media tpl-plate">
        <ProductMedia product={product} suffix="printer" sizes="(min-width: 640px) 320px, 45vw" priority={priority} className="pr-img" rounded={false} />
        <span className="pr-code">
          <bdi dir="ltr">{code}</bdi>
        </span>
        <span className="pr-tag">
          <Price product={product} className="tpl-price-tight pr-price" />
          <SaleChip product={product} className="pr-off" />
        </span>
        <QuickAction product={product} variant="icon" className="pr-add" />
      </div>
      <button type="button" onClick={() => openProduct(product.id)} className="tpl-open tpl-dish-name pr-name">
        {product.name}
      </button>
      {/* The printhead's lane over the cell: decoration only; the head sweeps across once when the part is first seen. */}
      <span aria-hidden className="pr-lane">
        <i />
      </span>
    </li>
  );
}
