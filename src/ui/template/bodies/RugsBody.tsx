'use client';

import type { CSSProperties } from 'react';
import type { MenuProductView } from '@/server/data/menu-view';
import { formatCount } from '@/server/domain/money';
import { useApp } from '@/ui/AppProviders';
import { useTemplate } from '../context';
import { Price, ProductMedia, QuickAction, SaleChip } from '../parts';
import { frameOf, RUG_VARS, weaveOf } from './rug-weave';
import { SectionStrip, ShapeHeading } from './shared/SectionStrip';
import { usePlaceOf } from './shared/usePlaceOf';
import './shared/photo-card.css';
import './shared/shapes.css';
import './rugs.css';

/**
 * Jajim and Nowruz (spec 2026-10-26-menu-styles-in-templates-design.md). Kurdish woven jajim rugs on a bright ivory page.
 * Every section is a RUG: a rectangular panel with a woven frame (a repeating geometric border drawn in CSS gradients:
 * zigzags, diamonds, chevrons or dots in red, indigo, saffron, green and ivory, its pattern by the section's place), the
 * section's title woven into the top border as an ivory cartouche with its number and dish count, and a field of
 * lozenge medallions inside laid out like a jajim's own pattern: rows of two and three that interlock (two, then three
 * offset by half a medallion, then two again), so the stagger shows from the first row; on a wide screen rows of three
 * and four. A thin fringe line closes each rug. The sticky strip is a row of small rug swatches, each with its own
 * border pattern; the swatch in view is lit, and the rug in view carries a tiny static Nowruz flame by its title. The
 * fixed colours come from rug-weave.ts as custom properties on the body (one source). Nothing moves. All rugs are on the
 * page, so the template's own jump and `#cat-<slug>` scrolling reach them.
 */
export function RugsBody() {
  const { locale, tenant } = useApp();
  const { categories, byCategory, activeId } = useTemplate();
  const n = (value: number) => formatCount(value, locale, tenant.numeralSystem);
  // Patterns and numbers go by the section's place in the full menu, so a search never reweaves or renumbers a rug.
  const placeOf = usePlaceOf();

  return (
    <div className="tpl-body" data-body="rugs" style={RUG_VARS as CSSProperties}>
      <SectionStrip marker="swatches" prefix="rg" className="rg-strip" chip="rg-swatch" chipStyle={(category) => weaveStyle(placeOf(category), 6)}>
        {(category) => <span className="rg-swatch-label">{category.name}</span>}
      </SectionStrip>
      <main id="menu" className="min-w-0">
        {categories.map((category, index) => {
          const products = byCategory.get(category.id) ?? [];
          const place = placeOf(category);
          return (
            <section
              key={category.id}
              id={`cat-${category.slug}`}
              aria-labelledby={`h-${category.slug}`}
              data-lit={category.id === activeId ? '' : undefined}
              style={weaveStyle(place, 10)}
              className="tpl-section tpl-tall-last rg-section"
            >
              <ShapeHeading id={`h-${category.slug}`} name={category.name} label={n(place + 1)} count={n(products.length)} className="rg-front" title="rg-title" />
              <div className="rg-rug">
                <div className="rg-field">
                  <ul className="rg-grid">
                    {products.map((product, at) => (
                      <Medallion key={product.id} product={product} priority={index < 2 && at < 6} />
                    ))}
                  </ul>
                </div>
              </div>
              <i aria-hidden className="rg-fringe" />
            </section>
          );
        })}
      </main>
    </div>
  );
}

/** A rug's frame (its pattern at `tile` px) and its field's tint as custom properties, read by the rug and the swatch. */
function weaveStyle(place: number, tile: number): CSSProperties {
  const weave = weaveOf(place);
  return { '--rg-frame': frameOf(weave, tile), '--rg-field': weave.field, '--rg-rim': weave.one } as CSSProperties;
}

/**
 * A dish on the rug: the lozenge photo in its woven rim with the add and the discount in its box's free corners, then
 * the price and the name (rugs.css sets them above the lozenge in a band's upper row). The whole cell opens the dish.
 */
function Medallion({ product, priority }: { product: MenuProductView; priority: boolean }) {
  const { openProduct } = useTemplate();
  return (
    <li data-row className="rg-medallion">
      <div className="rg-tile">
        <div className="rg-lozenge">
          <div data-photo className="rg-photo tpl-cover-media tpl-plate">
            <ProductMedia product={product} suffix="rugs" sizes="(min-width: 640px) 200px, 34vw" priority={priority} className="rg-img" rounded={false} />
          </div>
        </div>
        <SaleChip product={product} className="tpl-photo-off rg-off" />
        <QuickAction product={product} variant="icon" className="tpl-rim-add rg-add" />
      </div>
      <Price product={product} className="tpl-price-tight rg-price" />
      <button type="button" onClick={() => openProduct(product.id)} className="tpl-open tpl-dish-name rg-name">
        {product.name}
      </button>
    </li>
  );
}
