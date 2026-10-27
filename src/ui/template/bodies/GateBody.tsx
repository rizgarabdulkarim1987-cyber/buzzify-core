'use client';

import { useRef } from 'react';
import type { MenuProductView } from '@/server/data/menu-view';
import { formatCount } from '@/server/domain/money';
import { useApp } from '@/ui/AppProviders';
import { useTemplate } from '../context';
import { Price, ProductMedia, QuickAction, SaleChip } from '../parts';
import { SectionStrip, ShapeHeading } from './shared/SectionStrip';
import { useOnceInView } from './shared/useOnceInView';
import { usePlaceOf } from './shared/usePlaceOf';
import './shared/shapes.css';
import './shared/photo-card.css';
import './gate.css';

/**
 * Ishtar Gate (spec 2026-10-26-menu-styles-in-templates-design.md). Babylon's glazed lapis-blue gate with its gold
 * rosettes. Every section is a gate: a tall arched frame of lapis brick (gradients) with a crown of gold rosettes along
 * the arch and a column of them down each jamb, a lintel with the section's number (a small arch), name and dish count
 * in the menu's numerals, and below it the opening, where the dishes stand as sandy relief tiles three across: a
 * framed photo (the ornament is on the frame only, never over the photo), the name on a lapis cartouche and the price
 * on a gold rosette badge. The two door leaves of a gate part once, the first time it comes into view
 * (`useOnceInView` on `[data-gate]`; a translate, off with less motion, never replayed; the dishes are never hidden
 * when the observer does not report). A sticky strip of tiny gate-arch chips jumps (the one in view is lit). All gates
 * are on the page, so the template's own jump and `#cat-<slug>` scrolling reach them.
 */
export function GateBody() {
  const { locale, tenant } = useApp();
  const { categories, byCategory, activeId, reduced } = useTemplate();
  const root = useRef<HTMLDivElement>(null);
  useOnceInView(root, reduced, { item: 'data-gate', id: 'data-gate', mark: 'data-open' });
  const n = (value: number) => formatCount(value, locale, tenant.numeralSystem);
  // Numbers go by the section's place in the full menu, so a search never renumbers a gate or its chip.
  const placeOf = usePlaceOf();

  return (
    <div ref={root} className="tpl-body" data-body="gate">
      <SectionStrip marker="gates" prefix="gt" className="gt-strip" chip="gt-chip">
        {(category) => (
          <>
            <span aria-hidden data-pane={category.id === activeId ? 'active' : 'rest'} className="gt-glass">
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
            <section key={category.id} id={`cat-${category.slug}`} data-gate={category.id} aria-labelledby={`h-${category.slug}`} className="tpl-section tpl-tall-last gt-gate">
              <span aria-hidden className="gt-crown" />
              <ShapeHeading id={`h-${category.slug}`} name={category.name} label={n(placeOf(category) + 1)} count={n(products.length)} className="gt-head" title="gt-title tpl-banner" />
              <div className="gt-opening">
                <ul className="gt-grid">
                  {products.map((product, at) => (
                    <Tile key={product.id} product={product} priority={index < 2 && at < 6} />
                  ))}
                </ul>
                <span aria-hidden className="gt-leaf gt-leaf-s" />
                <span aria-hidden className="gt-leaf gt-leaf-e" />
              </div>
            </section>
          );
        })}
      </main>
    </div>
  );
}

/** A dish as a relief tile: the photo in its framed relief, the add on the photo's foot, the discount on the tile's corner, the name cartouche, the gold price badge. The whole tile opens the dish. */
function Tile({ product, priority }: { product: MenuProductView; priority: boolean }) {
  const { openProduct } = useTemplate();
  return (
    <li data-row className="gt-tile">
      <div className="gt-relief">
        <div data-photo className="gt-photo tpl-cover-media tpl-plate">
          <ProductMedia product={product} suffix="gate" sizes="(min-width: 1024px) 170px, (min-width: 640px) 20vw, 28vw" priority={priority} className="gt-img" rounded={false} />
          <QuickAction product={product} variant="icon" className="tpl-rim-add gt-add" />
        </div>
      </div>
      <SaleChip product={product} className="tpl-photo-off gt-off" />
      <button type="button" onClick={() => openProduct(product.id)} className="tpl-open tpl-dish-name gt-name">
        {product.name}
      </button>
      <Price product={product} className="tpl-price-tight gt-price" />
    </li>
  );
}
