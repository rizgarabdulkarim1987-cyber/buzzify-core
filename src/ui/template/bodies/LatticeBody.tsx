'use client';

import type { MenuProductView } from '@/server/data/menu-view';
import { formatCount } from '@/server/domain/money';
import { useApp } from '@/ui/AppProviders';
import { useTemplate } from '../context';
import { Description, Price, ProductMedia, QuickAction, SaleChip } from '../parts';
import { SectionStrip, ShapeHeading } from './shared/SectionStrip';
import { usePlaceOf } from './shared/usePlaceOf';
import './shared/shapes.css';
import './shared/photo-card.css';
import './shared/arch-chip.css';
import './lattice.css';

/**
 * Baghdad Shanashil (spec 2026-10-26-menu-styles-in-templates-design.md). The wooden oriel windows of old Baghdad, in
 * carved wood and turquoise. Every section is a bay of the facade: a carved wooden header board with the section's
 * number (a small window), name and dish count, a band of mashrabiya lattice under it edged with a Tigris wave line,
 * then the dishes as a LIST of wide oriel panes, one under the other (two columns on a wide screen): each pane is a
 * wooden plank with the photo in an arched turquoise lattice window at its start (the lattice is on the frame only,
 * never over the photo) and a carved plaque beside it with the name, one line of description and the price on a brass
 * tag. A corbelled wooden bracket closes each bay. The sticky strip is a row of oriel-window chips, each a numbered
 * window with the section's name beside it (the window of the section in view is lit). All bays are on the page, so
 * the template's own jump and `#cat-<slug>` scrolling reach them. Nothing moves.
 */
export function LatticeBody() {
  const { locale, tenant } = useApp();
  const { categories, byCategory, activeId } = useTemplate();
  const n = (value: number) => formatCount(value, locale, tenant.numeralSystem);
  // Numbers go by the section's place in the full menu, so a search never renumbers a bay or its window.
  const placeOf = usePlaceOf();

  return (
    <div className="tpl-body" data-body="lattice">
      <SectionStrip marker="oriels" prefix="sh" className="sh-strip" chip="tpl-arch-chip sh-chip">
        {(category) => (
          <>
            <span aria-hidden data-pane={category.id === activeId ? 'active' : 'rest'} className="tpl-arch-glass sh-glass">
              {n(placeOf(category) + 1)}
            </span>
            <span className="tpl-arch-label">{category.name}</span>
          </>
        )}
      </SectionStrip>
      <main id="menu" className="min-w-0">
        {categories.map((category, index) => {
          const products = byCategory.get(category.id) ?? [];
          return (
            <section key={category.id} id={`cat-${category.slug}`} aria-labelledby={`h-${category.slug}`} className="tpl-section tpl-tall-last sh-bay">
              <ShapeHeading id={`h-${category.slug}`} name={category.name} label={n(placeOf(category) + 1)} count={n(products.length)} className="sh-head" title="sh-title tpl-banner tpl-arch-title" />
              <ul className="sh-list">
                {products.map((product, at) => (
                  <Pane key={product.id} product={product} priority={index < 2 && at < 6} />
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
 * A dish as a wide oriel pane: the photo in its arched turquoise lattice window at the start (the discount on its foot),
 * the carved plaque beside it (name, one line of description, the brass price tag) and the add at the plaque's end. The
 * whole pane opens the dish.
 */
function Pane({ product, priority }: { product: MenuProductView; priority: boolean }) {
  const { openProduct } = useTemplate();
  return (
    <li data-row className="sh-pane">
      <div className="sh-frame">
        <div data-photo className="sh-photo tpl-cover-media tpl-plate">
          <ProductMedia product={product} suffix="lattice" sizes="(min-width: 768px) 160px, 34vw" priority={priority} className="sh-img" rounded={false} />
          <SaleChip product={product} className="tpl-photo-off sh-off" />
        </div>
      </div>
      <div className="sh-plaque">
        <button type="button" onClick={() => openProduct(product.id)} className="tpl-open tpl-dish-name sh-name">
          {product.name}
        </button>
        <Description product={product} lines={1} className="sh-desc" />
        <Price product={product} className="tpl-price-tight tpl-tag sh-price" />
      </div>
      <QuickAction product={product} variant="icon" className="tpl-rim-add sh-add" />
    </li>
  );
}
