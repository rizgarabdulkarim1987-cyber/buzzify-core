'use client';

import { useRef, type CSSProperties } from 'react';
import { formatCount } from '@/server/domain/money';
import { useApp } from '@/ui/AppProviders';
import { useTemplate } from '../context';
import { QuickAction } from '../parts';
import { PhotoCard } from './shared/PhotoCard';
import { SectionStrip, ShapeHeading } from './shared/SectionStrip';
import { useOnceInView } from './shared/useOnceInView';
import { usePlaceOf } from './shared/usePlaceOf';
import './shared/shapes.css';
import './frost.css';

/**
 * Frosted Window (spec 2026-10-26-menu-styles-in-templates-design.md). The menu is a winter window. A sticky strip of
 * icicle chips (a pale pill with the section's number and its name, an icicle hanging under it; the one in view is
 * dark and ringed) jumps to a section. Each section is one big window pane: a frame with rime on its edge, a glass of
 * night blue, a label plate with a fringe of icicles, and the dishes as frost cards in three columns that stagger, tall
 * and short by turns (a tall card has the taller photo). Condensation lies faintly over a pane that is still below the
 * screen and is wiped away once, the first time the pane comes into view (`useOnceInView` on `[data-glass]`; a
 * transform on a layer that never takes a tap or hides a dish, off with less motion, never replayed). All panes are on
 * the page, so the template's own jump and `#cat-<slug>` scrolling reach them.
 */
export function FrostBody() {
  const { locale, tenant } = useApp();
  const { categories, byCategory, activeId, reduced } = useTemplate();
  const root = useRef<HTMLDivElement>(null);
  useOnceInView(root, reduced, { item: 'data-glass', id: 'data-glass', mark: 'data-open' });
  const n = (value: number) => formatCount(value, locale, tenant.numeralSystem);
  // Numbers go by the section's place in the full menu, so a search never renumbers a pane or its chip.
  const placeOf = usePlaceOf();

  return (
    <div ref={root} className="tpl-body" data-body="frost">
      <SectionStrip marker="icicles" prefix="fr" className="fr-strip" chip="fr-chip">
        {(category) => (
          <>
            <span aria-hidden data-pane={category.id === activeId ? 'active' : 'rest'} className="fr-chip-no">
              {n(placeOf(category) + 1)}
            </span>
            <span className="fr-chip-name">{category.name}</span>
          </>
        )}
      </SectionStrip>
      <main id="menu" className="min-w-0">
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
                    // Tall, short, short, tall: the columns never end together, so the cards stagger.
                    className={`fr-card ${at % 4 === 0 || at % 4 === 3 ? 'fr-tall' : 'fr-short'}`}
                    style={{ '--at': at } as CSSProperties}
                    sizes="(min-width: 1024px) 220px, (min-width: 640px) 28vw, 44vw"
                    priority={index < 1 && at < 6}
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
