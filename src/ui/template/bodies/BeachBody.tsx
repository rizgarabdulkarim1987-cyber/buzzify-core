'use client';

import { useRef, type CSSProperties } from 'react';
import { formatCount } from '@/server/domain/money';
import { useApp } from '@/ui/AppProviders';
import { useTemplate } from '../context';
import { QuickAction } from '../parts';
import { towelOf } from './beach-fills';
import { PhotoCard } from './shared/PhotoCard';
import { SectionStrip, ShapeHeading } from './shared/SectionStrip';
import { useOnceInView } from './shared/useOnceInView';
import { usePlaceOf } from './shared/usePlaceOf';
import './shared/shapes.css';
import './beach.css';

/**
 * How a towel lies in its section (the pattern the CSS draws; pure, so the pattern is pinned): the dishes go in pairs, row
 * after row, each a landscape towel with its photo at the start in one row and at the end in the next; a last dish left
 * without a partner lies across the whole row (wide), with its photo on its row's side.
 */
export function towelLayout(at: number, total: number): { wide: boolean; end: boolean } {
  return { wide: at === total - 1 && at % 2 === 0, end: (at >> 1) % 2 === 1 };
}

/**
 * Summer Beach (spec 2026-10-26-menu-styles-in-templates-design.md). The menu is a stretch of beach. A sticky strip of
 * buoy chips (a cream pill with a lifebuoy ring around the section's number, and its name; the one in view is dark and
 * ringed) jumps to a section. Each section is a full-width band of sand or sea in turns, its top edge a wave; the dishes
 * are striped beach towels in two columns (landscape, in pairs, the photo at the start in one row and at the end in
 * the next; a last one left alone lies across the row). The wave drifts once, the first time its band comes
 * into view (`useOnceInView` on `[data-band]`; a transform on a layer that takes no tap, off with less motion, never
 * replayed). All bands are on the page, so the template's own jump and `#cat-<slug>` scrolling reach them.
 */
export function BeachBody() {
  const { locale, tenant } = useApp();
  const { categories, byCategory, activeId, reduced } = useTemplate();
  const root = useRef<HTMLDivElement>(null);
  useOnceInView(root, reduced, { item: 'data-band', id: 'data-band', mark: 'data-open' });
  const n = (value: number) => formatCount(value, locale, tenant.numeralSystem);
  // Numbers and the sand/sea turn go by the section's place in the full menu, so a search never renumbers or recolours a band.
  const placeOf = usePlaceOf();

  return (
    <div ref={root} className="tpl-body" data-body="beach">
      <SectionStrip marker="buoys" prefix="bc" className="bc-strip" chip="bc-chip">
        {(category) => (
          <>
            <span aria-hidden className="bc-chip-no">
              <b data-pane={category.id === activeId ? 'active' : 'rest'}>{n(placeOf(category) + 1)}</b>
            </span>
            <span className="bc-chip-name">{category.name}</span>
          </>
        )}
      </SectionStrip>
      <main id="menu" className="min-w-0">
        {categories.map((category, index) => {
          const products = byCategory.get(category.id) ?? [];
          return (
            <section
              key={category.id}
              id={`cat-${category.slug}`}
              data-band={category.id}
              data-tone={placeOf(category) % 2 === 0 ? 'sand' : 'sea'}
              aria-labelledby={`h-${category.slug}`}
              className="tpl-section tpl-tall-last bc-band"
            >
              {/* The wave along the band's top edge: decoration only; one drift when the band is first seen. */}
              <span aria-hidden className="bc-wave" />
              <ShapeHeading id={`h-${category.slug}`} name={category.name} label={n(placeOf(category) + 1)} count={n(products.length)} className="bc-head" title="bc-title" />
              <ul className="bc-grid">
                {products.map((product, at) => {
                  const { wide, end } = towelLayout(at, products.length);
                  return (
                    <PhotoCard
                      key={product.id}
                      product={product}
                      prefix="bc"
                      suffix="beach"
                      className={`bc-tile${wide ? ' bc-wide' : ''}${end ? ' bc-end' : ''}`}
                      style={{ '--towel': towelOf(at) } as CSSProperties}
                      sizes="(min-width: 640px) 320px, 50vw"
                      priority={index < 1 && at < 6}
                      add={<QuickAction product={product} variant="icon" className="tpl-rim-add bc-add" />}
                    />
                  );
                })}
              </ul>
            </section>
          );
        })}
      </main>
    </div>
  );
}
