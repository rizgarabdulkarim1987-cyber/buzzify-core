'use client';

import type { MenuProductView } from '@/server/data/menu-view';
import { formatCount } from '@/server/domain/money';
import { useApp } from '@/ui/AppProviders';
import { useTemplate } from '../context';
import { Price, ProductMedia, QuickAction, SaleChip } from '../parts';
import { SectionStrip, ShapeHeading } from './shared/SectionStrip';
import { usePlaceOf } from './shared/usePlaceOf';
import './shared/photo-card.css';
import './shared/shapes.css';
import './shared/arch-chip.css';
import './shared/name-chip.css';
import './lattice.css';

/**
 * Baghdad Shanashil (spec 2026-10-26-menu-styles-in-templates-design.md). The wooden oriel windows of old Baghdad, in
 * carved wood and turquoise. Every section is a MASHRABIYA SCREEN: a carved wooden header board with the section's number
 * (a small window), its name and its dish count, a band of lattice under it edged with a Tigris wave line, then the
 * dishes as a dense lattice of small window cells, three across on a phone (four, then six, on wider screens), held in
 * a grid of wooden bars with a turned bead at every joint. Each cell is a window: the photo cut to an octagon on a
 * turquoise lattice ground (the lattice shows only in the cut corners, never over the photo), the brass price tag and the
 * add on a ledge under it, and the name under that. A corbelled wooden bracket closes each screen. The sticky strip is a
 * row of oriel-window chips, each a numbered window with the section's name beside it (the window of the section in
 * view is lit). All screens are on the page, so the template's own jump and `#cat-<slug>` scrolling reach them. Nothing
 * moves.
 */
export function LatticeBody() {
  const { locale, tenant } = useApp();
  const { categories, byCategory, activeId } = useTemplate();
  const n = (value: number) => formatCount(value, locale, tenant.numeralSystem);
  // Numbers go by the section's place in the full menu, so a search never renumbers a screen or its window.
  const placeOf = usePlaceOf();

  return (
    <div className="tpl-body" data-body="lattice">
      <SectionStrip marker="oriels" prefix="sh" className="sh-strip" chip="tpl-arch-chip sh-chip">
        {(category) => (
          <>
            <span aria-hidden data-pane={category.id === activeId ? 'active' : 'rest'} className="tpl-arch-glass sh-glass">
              {n(placeOf(category) + 1)}
            </span>
            <span className="tpl-chip-name tpl-arch-label">{category.name}</span>
          </>
        )}
      </SectionStrip>
      <main id="menu" className="min-w-0">
        {categories.map((category, index) => {
          const products = byCategory.get(category.id) ?? [];
          return (
            <section key={category.id} id={`cat-${category.slug}`} aria-labelledby={`h-${category.slug}`} className="tpl-section tpl-tall-last sh-bay">
              <ShapeHeading id={`h-${category.slug}`} name={category.name} label={n(placeOf(category) + 1)} count={n(products.length)} className="sh-head" title="sh-title tpl-banner tpl-arch-title" />
              <ul className="sh-screen" data-screen>
                {products.map((product, at) => (
                  <Cell key={product.id} product={product} priority={index < 2 && at < 6} />
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
 * A dish as a window cell of the screen: the photo cut to an octagon on its turquoise lattice ground (the discount on
 * the cut corner at its start), the ledge under it with the brass price tag and the add, and the name under the ledge.
 * The whole cell opens the dish.
 */
function Cell({ product, priority }: { product: MenuProductView; priority: boolean }) {
  const { openProduct } = useTemplate();
  return (
    <li data-row data-cell className="sh-cell">
      <div className="sh-window">
        <div data-photo className="sh-photo tpl-cover-media tpl-plate">
          <ProductMedia product={product} suffix="lattice" sizes="(min-width: 1024px) 160px, (min-width: 640px) 24vw, 32vw" priority={priority} className="sh-img" rounded={false} />
        </div>
        <SaleChip product={product} className="tpl-photo-off sh-off" />
      </div>
      <div className="sh-ledge">
        <Price product={product} className="tpl-price-tight tpl-tag sh-price" />
        <QuickAction product={product} variant="icon" className="tpl-rim-add sh-add" />
      </div>
      <button type="button" onClick={() => openProduct(product.id)} className="tpl-open tpl-dish-name sh-name">
        {product.name}
      </button>
    </li>
  );
}
