'use client';

import { useEffect, useRef, type CSSProperties, type RefObject } from 'react';
import { localDigits } from '@/lib/digits';
import { formatCount } from '@/server/domain/money';
import { useApp } from '@/ui/AppProviders';
import { useTemplate } from '../context';
import type { MenuProductView } from '@/server/data/menu-view';
import { DishCounts, Price, ProductMedia, QuickAction, SaleChip } from '../parts';
import { SectionStrip, ShapeHeading } from './shared/SectionStrip';
import { useOnceInView } from './shared/useOnceInView';
import './shared/photo-card.css';
import './shared/shapes.css';
import './printer.css';

/** How long a part takes to print, in ms (the cover slides off its bed over it; the counter counts through it). */
export const PRINT_MS = 1600;

/** The delay of a cell's print, by its place in its section (capped, so every motion ends inside five seconds). */
export function sweepDelay(at: number): number {
  return Math.min(at, 6) * 90;
}

/** The counter's text at `share` (0 to 1) of a print: a percentage in the menu's numerals, a check mark when it is done. */
export function counterText(share: number, numerals: 'latn' | 'arab'): string {
  return share >= 1 ? '✓' : localDigits(`${Math.round(share * 100)}%`, numerals);
}

/**
 * The counter on each part's bed (`[data-pct]`): while the page is armed it reads 0% on a part not yet printed and counts
 * up to a check mark over the print when the part is first seen (`data-print` set by the shared once-in-view hook), and
 * marks the cell `data-printing` meanwhile (the printhead's nozzle slides only then). It writes the text straight onto the
 * node from a MutationObserver, never through React state, so a printing cell re-renders nothing; a part drawn again
 * later is simply printed (its counter shows the check). Decoration only: the counter is hidden from assistive tech.
 */
function usePrintCounter(root: RefObject<HTMLElement | null>, reduced: boolean, numerals: 'latn' | 'arab') {
  useEffect(() => {
    const host = root.current;
    if (!host || reduced) return;
    const frames = new Set<number>();
    const zero = counterText(0, numerals);
    const reset = () =>
      host.querySelectorAll<HTMLElement>('[data-slab]:not([data-print]):not([data-printing])').forEach((cell) => {
        const counter = cell.querySelector('[data-pct]');
        if (counter && counter.textContent !== zero) counter.textContent = zero;
      });
    const run = (cell: HTMLElement) => {
      if (cell.hasAttribute('data-printing')) return;
      const counter = cell.querySelector('[data-pct]');
      if (!counter) return;
      const delay = parseFloat(getComputedStyle(cell).getPropertyValue('--d')) || 0;
      const start = performance.now() + delay;
      cell.setAttribute('data-printing', '');
      const tick = (now: number) => {
        const share = Math.max(0, Math.min(1, (now - start) / PRINT_MS));
        counter.textContent = counterText(share, numerals);
        if (share < 1) frames.add(requestAnimationFrame(tick));
        else cell.removeAttribute('data-printing');
      };
      frames.add(requestAnimationFrame(tick));
    };
    const watch = new MutationObserver((records) => {
      let drawn = false;
      for (const record of records) {
        const cell = record.target as HTMLElement;
        if (record.type === 'attributes') {
          if (cell.hasAttribute('data-print')) run(cell);
          else drawn = true;
        } else if ([...record.addedNodes].some((node) => node.nodeType === 1)) drawn = true;
      }
      // Cells drawn later (a search cleared) or armed again that are not printed yet read 0%.
      if (drawn) reset();
    });
    watch.observe(host, { attributes: true, attributeFilter: ['data-print'], subtree: true, childList: true });
    reset();
    return () => {
      watch.disconnect();
      frames.forEach((frame) => cancelAnimationFrame(frame));
    };
  }, [root, reduced, numerals]);
}

/**
 * The 3D Printer (the themed-prn mockup, spec 2026-10-26-menu-styles-in-templates-design.md). The menu is a print job on
 * dark steel with a hot orange head. A sticky strip of dark keys (the one in view orange) jumps to a section, and each
 * section is a title over its dishes as dark cards two across, each with a PRINT BED: the photo laid on a layered bed, the
 * name under it, then the price in mono and the orange add. The first time a card is seen its photo is printed: a cover
 * of bed layers slides off it from the bottom up behind an orange printhead whose nozzle shuttles across, while a
 * percentage counter climbs to a check mark (under two seconds; never again, never with less motion, when every photo is
 * simply there). The colours are the template's palette (printer.css), so the default palette is the mockup's steel and
 * orange. All sections are on the page, so the template's own jump and `#cat-<slug>` scrolling reach them.
 */
export function PrinterBody() {
  const { locale, tenant } = useApp();
  const { categories, byCategory, reduced } = useTemplate();
  const root = useRef<HTMLDivElement>(null);
  const seen = useOnceInView(root, reduced, { item: 'data-slab', id: 'data-slab', mark: 'data-print' });
  usePrintCounter(root, reduced, tenant.numeralSystem);
  const n = (value: number) => formatCount(value, locale, tenant.numeralSystem);
  // The parts already on the first screen print too: the shared hook marks them seen before it arms, so they are armed again once.
  useEffect(() => {
    const host = root.current;
    if (!host || reduced) return;
    host.querySelectorAll<HTMLElement>('[data-slab][data-print]').forEach((cell) => {
      const box = cell.getBoundingClientRect();
      if (box.bottom > 0 && box.top < window.innerHeight) seen.current?.rearm(cell);
    });
  }, [reduced, seen]);

  return (
    <div ref={root} className="tpl-body" data-body="printer">
      <SectionStrip marker="nozzles" prefix="pr" className="pr-strip" chip="pr-key">
        {(category) => <span className="pr-key-label">{category.name}</span>}
      </SectionStrip>
      <main id="menu" className="min-w-0">
        {categories.map((category, index) => {
          const products = byCategory.get(category.id) ?? [];
          return (
            <section key={category.id} id={`cat-${category.slug}`} aria-labelledby={`h-${category.slug}`} className="tpl-section tpl-tall-last pr-part">
              <ShapeHeading id={`h-${category.slug}`} name={category.name} count={n(products.length)} className="pr-head" title="pr-title" />
              <ul className="pr-grid">
                {products.map((product, at) => (
                  <Cell key={product.id} product={product} at={at} priority={index < 2 && at < 6} />
                ))}
              </ul>
            </section>
          );
        })}
      </main>
    </div>
  );
}

/** A dish as a card with a print bed: the photo under its cover, the counter on the bed's corner, the name, then the price and the add. */
function Cell({ product, at, priority }: { product: MenuProductView; at: number; priority: boolean }) {
  const { openProduct } = useTemplate();
  const { tenant } = useApp();
  return (
    <li data-row data-slab={product.id} className="pr-card" style={{ '--d': `${sweepDelay(at)}ms` } as CSSProperties}>
      <div className="pr-bed">
        <div data-photo className="pr-photo tpl-cover-media tpl-plate">
          <ProductMedia product={product} suffix="printer" sizes="(min-width: 640px) 240px, 44vw" priority={priority} className="pr-img" rounded={false} />
        </div>
        <i aria-hidden className="pr-cover" />
        <span aria-hidden data-pct className="pr-pct">
          {counterText(1, tenant.numeralSystem)}
        </span>
        <SaleChip product={product} className="tpl-photo-off pr-off" />
      </div>
      <button type="button" onClick={() => openProduct(product.id)} className="tpl-open tpl-dish-name pr-name text-start">
        {product.name}
      </button>
      <DishCounts product={product} />
      <div className="pr-foot">
        <Price product={product} className="tpl-price-tight pr-price" />
        <QuickAction product={product} variant="icon" className="pr-add relative z-[2]" />
      </div>
    </li>
  );
}
