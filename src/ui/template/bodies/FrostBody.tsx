'use client';

import { useLayoutEffect, useRef, type RefObject } from 'react';
import { formatCount } from '@/server/domain/money';
import { useApp } from '@/ui/AppProviders';
import { useTemplate } from '../context';
import { QuickAction } from '../parts';
import { PhotoCard } from './shared/PhotoCard';
import { SectionStrip, ShapeHeading } from './shared/SectionStrip';
import { useOnceInView } from './shared/useOnceInView';
import { usePlaceOf } from './shared/usePlaceOf';
import { useProductPlace } from './shared/useProductPlace';
import './shared/shapes.css';
import './shared/name-chip.css';
import './frost.css';

/** The packing grid's row, in px (frost.css `grid-auto-rows: 0.5rem`). */
const PACK_ROW = 8;

/** Whether the dish at `place` in its section (its place in the full list) has the tall photo: every third, from the second. */
export function isTallFrost(place: number): boolean {
  return place % 3 === 1;
}

/**
 * Packs the panes into a MASONRY of columns: each pane (`[data-glass]`) spans as many of the grid's small rows as its
 * height needs, so the grid's own placement drops it into the column that frees up first. Heights are measured with a
 * ResizeObserver (a search, a font or a photo that changes a pane re-packs it); `data-packed` on `main` turns the small
 * rows on, so before the script runs the panes simply sit in rows. It packs in the same commit that hydrates the page
 * (a layout effect that measures every pane at once), so a jump tapped as soon as the chips work already aims at a
 * pane's packed place; later changes go through the observer. Layout only: nothing moves.
 */
function usePackedPanes(main: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const host = main.current;
    if (!host || typeof ResizeObserver === 'undefined') return;
    const span = (pane: HTMLElement) => {
      // The pane's margins are part of its grid area (the plate straddles the frame above it).
      const style = getComputedStyle(pane);
      const room = (parseFloat(style.marginBlockStart) || 0) + (parseFloat(style.marginBlockEnd) || 0);
      pane.style.gridRowEnd = `span ${Math.max(1, Math.ceil((pane.getBoundingClientRect().height + room) / PACK_ROW))}`;
    };
    const sizes = new ResizeObserver((entries) => entries.forEach((entry) => span(entry.target as HTMLElement)));
    const watch = () =>
      host.querySelectorAll<HTMLElement>(':scope > [data-glass]').forEach((pane) => {
        span(pane);
        sizes.observe(pane);
      });
    watch();
    host.setAttribute('data-packed', '');
    const changes = new MutationObserver(watch);
    changes.observe(host, { childList: true });
    return () => {
      sizes.disconnect();
      changes.disconnect();
      host.removeAttribute('data-packed');
    };
  }, [main]);
}

/**
 * Frosted Window (spec 2026-10-26-menu-styles-in-templates-design.md). The menu is a wall of winter windows. A sticky strip
 * of icicle chips (a pale pill with the section's number and its name, an icicle hanging under it; the one in view is
 * dark and ringed) jumps to a section. Each section is its own window pane, and the panes stand side by side in a
 * MASONRY of two columns (three and four on wider screens): a pane is as tall as its dishes need and drops into the
 * column that frees up first, so the first screen shows the first two sections at once. A pane is a frame with rime, a
 * night-blue glass crossed by a mullion and by glazing bars between its dishes, a label plate with a fringe of icicles,
 * and its dishes one under the other as frost cards whose photos are tall or short (every third dish, by its place in
 * the full section, has the tall one, so a search never resizes a card). The last pane lies across the whole wall, as
 * the sill. Condensation lies faintly over a pane that is still below the screen and is wiped away once, the first time
 * the pane comes into view (`useOnceInView` on `[data-glass]`; a transform on a layer that never takes a tap or hides a
 * dish, off with less motion, never replayed). All panes are on the page, so the template's own jump and `#cat-<slug>`
 * scrolling reach them.
 */
export function FrostBody() {
  const { locale, tenant } = useApp();
  const { categories, byCategory, activeId, reduced } = useTemplate();
  const root = useRef<HTMLDivElement>(null);
  const wall = useRef<HTMLElement>(null);
  useOnceInView(root, reduced, { item: 'data-glass', id: 'data-glass', mark: 'data-open' });
  usePackedPanes(wall);
  const n = (value: number) => formatCount(value, locale, tenant.numeralSystem);
  // Numbers go by the section's place in the full menu, so a search never renumbers a pane or its chip.
  const placeOf = usePlaceOf();
  const dishPlace = useProductPlace();

  return (
    <div ref={root} className="tpl-body" data-body="frost">
      <SectionStrip marker="icicles" prefix="fr" className="fr-strip" chip="tpl-name-chip fr-chip">
        {(category) => (
          <>
            <span aria-hidden data-pane={category.id === activeId ? 'active' : 'rest'} className="tpl-chip-no fr-chip-no">
              {n(placeOf(category) + 1)}
            </span>
            <span className="tpl-chip-name fr-chip-name">{category.name}</span>
          </>
        )}
      </SectionStrip>
      <main ref={wall} id="menu" className="min-w-0 fr-wall" data-wall>
        {categories.map((category, index) => {
          const products = byCategory.get(category.id) ?? [];
          return (
            <section key={category.id} id={`cat-${category.slug}`} data-glass={category.id} aria-labelledby={`h-${category.slug}`} className="tpl-section tpl-tall-last fr-pane">
              <ShapeHeading id={`h-${category.slug}`} name={category.name} label={n(placeOf(category) + 1)} count={n(products.length)} className="fr-head" title="fr-title" />
              <ul className="fr-grid">
                {products.map((product, at) => (
                  <PhotoCard
                    key={product.id}
                    product={product}
                    prefix="fr"
                    suffix="frost"
                    className={`fr-card ${isTallFrost(dishPlace(product)) ? 'fr-tall' : 'fr-short'}`}
                    sizes="(min-width: 1024px) 240px, (min-width: 640px) 30vw, 45vw"
                    priority={index < 2 && at < 3}
                    add={<QuickAction product={product} variant="icon" className="tpl-rim-add fr-add" />}
                  />
                ))}
              </ul>
              {/* The condensation: a faint layer over the pane that a transform wipes away once. Decoration only. */}
              <span aria-hidden className="fr-fogbox">
                <span aria-hidden className="fr-fog" />
              </span>
            </section>
          );
        })}
      </main>
    </div>
  );
}
