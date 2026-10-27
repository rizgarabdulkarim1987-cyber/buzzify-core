'use client';

import { useEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
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
import './printer.css';

/** A layer's number in its part: 001, 002 ... (the digits are written in the menu's numerals by the body). */
export function layerNumber(at: number): string {
  return String(at + 1).padStart(3, '0');
}

/** How many layers of a part count as printed: all of them until the page is armed (`counts` null), then the ones seen. */
export function printedOf(counts: Record<string, number> | null, id: string, total: number): number {
  return counts === null ? total : Math.min(counts[id] ?? 0, total);
}

/** The delay of a slab's printhead sweep, by its place in its part (capped, so every motion ends inside five seconds). */
export function sweepDelay(at: number): number {
  return Math.min(at, 6) * 90;
}

/**
 * Counts, per part (`[data-part]`), the slabs the printhead has been over (`[data-print]`, set by `useOnceInView`). Null
 * while the page is not armed (no script, or less motion), when every layer simply counts as printed.
 */
function usePrinted(root: RefObject<HTMLElement | null>, reduced: boolean): Record<string, number> | null {
  const [counts, setCounts] = useState<Record<string, number> | null>(null);
  useEffect(() => {
    const host = root.current;
    if (!host) return;
    const read = () => {
      if (!host.hasAttribute('data-armed')) {
        setCounts(null);
        return;
      }
      const next: Record<string, number> = {};
      host.querySelectorAll<HTMLElement>('[data-part]').forEach((part) => {
        next[part.getAttribute('data-part') ?? ''] = part.querySelectorAll('[data-print]').length;
      });
      setCounts((before) => (before && Object.keys(next).length === Object.keys(before).length && Object.entries(next).every(([key, value]) => before[key] === value) ? before : next));
    };
    const watch = new MutationObserver(read);
    watch.observe(host, { attributes: true, attributeFilter: ['data-print', 'data-armed'], subtree: true, childList: true });
    read();
    return () => watch.disconnect();
  }, [root, reduced]);
  return counts;
}

/**
 * The 3D Printer (spec 2026-10-26-menu-styles-in-templates-design.md). The menu is a print job's spec sheet. A sticky strip
 * of nozzle chips (the part's number and its name; the one in view is lit) jumps to a part. Each section is a part: a
 * layer gauge runs down its start edge (a rail whose fill grows with the layers printed), the dishes are stacked slabs
 * (a layer code such as L012 on the rail, a ruled slab with the photo, the name, the price and the add), and the part's
 * heading carries an "n of N layers" meter. A printhead sweeps across a slab once, the first time it comes into view
 * (`useOnceInView` on `[data-slab]`: a transform and opacity on a layer that takes no tap, off with less motion, never
 * replayed); the layers are always there to read, the sweep only draws over them. All parts are on the page, so the
 * template's own jump and `#cat-<slug>` scrolling reach them.
 */
export function PrinterBody() {
  const { locale, tenant, t } = useApp();
  const { categories, byCategory, activeId, reduced } = useTemplate();
  const root = useRef<HTMLDivElement>(null);
  useOnceInView(root, reduced, { item: 'data-slab', id: 'data-slab', mark: 'data-print' });
  const printed = usePrinted(root, reduced);
  const n = (value: number) => formatCount(value, locale, tenant.numeralSystem);
  // Numbers go by the section's place in the full menu, so a search never renumbers a part.
  const placeOf = usePlaceOf();

  return (
    <div ref={root} className="tpl-body" data-body="printer">
      <SectionStrip marker="nozzles" prefix="pr" className="pr-strip" chip="pr-chip">
        {(category) => (
          <>
            <span aria-hidden className="pr-chip-no">
              <b data-pane={category.id === activeId ? 'active' : 'rest'}>{n(placeOf(category) + 1)}</b>
            </span>
            <span className="pr-chip-name">{category.name}</span>
          </>
        )}
      </SectionStrip>
      <main id="menu" className="min-w-0">
        {categories.map((category, index) => {
          const products = byCategory.get(category.id) ?? [];
          const done = printedOf(printed, category.id, products.length);
          return (
            <section
              key={category.id}
              id={`cat-${category.slug}`}
              data-part={category.id}
              aria-labelledby={`h-${category.slug}`}
              className="tpl-section tpl-tall-last pr-part"
              style={{ '--pr-done': products.length ? done / products.length : 1 } as CSSProperties}
            >
              <ShapeHeading id={`h-${category.slug}`} name={category.name} label={t('tpl.prn.part', { n: n(placeOf(category) + 1) })} count={n(products.length)} className="pr-head" title="pr-title" />
              <p className="pr-meter">
                <span className="pr-meter-text">{t('tpl.prn.layers', { count: products.length, n: n(done), total: n(products.length) })}</span>
                <span aria-hidden className="pr-meter-track">
                  <i />
                </span>
              </p>
              <ul className="pr-stack">
                {products.map((product, at) => (
                  <Slab key={product.id} product={product} at={at} code={`L${localDigits(layerNumber(at), tenant.numeralSystem)}`} priority={index < 1 && at < 6} />
                ))}
              </ul>
            </section>
          );
        })}
      </main>
    </div>
  );
}

/** One layer of a part: its code on the rail, then a ruled slab (photo, name over price, add), the printhead's lane over it. */
function Slab({ product, at, code, priority }: { product: MenuProductView; at: number; code: string; priority: boolean }) {
  const { openProduct } = useTemplate();
  return (
    <li data-row data-slab={product.id} className="tpl-photo-card pr-slab" style={{ '--pr-delay': `${sweepDelay(at)}ms` } as CSSProperties}>
      <span className="pr-code">
        <bdi dir="ltr">{code}</bdi>
      </span>
      <div className="pr-body">
        <div data-photo className="pr-photo tpl-cover-media tpl-plate">
          <ProductMedia product={product} suffix="printer" sizes="64px" priority={priority} className="pr-img" rounded={false} />
        </div>
        <div className="pr-text">
          <button type="button" onClick={() => openProduct(product.id)} className="tpl-open tpl-dish-name pr-name text-start">
            {product.name}
          </button>
          <span className="pr-meta">
            <Price product={product} className="tpl-price-tight pr-price" />
            <SaleChip product={product} className="pr-off" />
          </span>
        </div>
        <QuickAction product={product} variant="icon" className="pr-add" />
      </div>
      {/* The printhead's lane over the slab: decoration only; the head sweeps across once when the layer is first seen. */}
      <span aria-hidden className="pr-lane">
        <i />
      </span>
    </li>
  );
}
