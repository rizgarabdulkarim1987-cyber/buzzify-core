'use client';

import type { MenuProductView } from '@/server/data/menu-view';
import { formatCount } from '@/server/domain/money';
import { useApp } from '@/ui/AppProviders';
import { useTemplate } from '../context';
import { Price, ProductMedia, QuickAction, SaleChip } from '../parts';
import { SectionStrip, ShapeHeading } from './shared/SectionStrip';
import { usePlaceOf } from './shared/usePlaceOf';
import './shared/shapes.css';
import './shared/photo-card.css';
import './lattice.css';

/**
 * Baghdad Shanashil (spec 2026-10-26-menu-styles-in-templates-design.md). The wooden oriel windows of old Baghdad, in
 * carved wood and turquoise. Every section is a bay of the facade: a carved wooden header board with the section's
 * number (a small window) and name and the dish count, a band of mashrabiya lattice under it edged with a Tigris wave
 * line, then the dishes as window panes in a dark wooden panel, three across: an arch-topped photo in a turquoise
 * frame (the lattice is on the frame only, never over the photo), the name on a small carved plaque under the pane and
 * the price on a brass tag. A corbelled wooden bracket closes each bay. The sticky strip is a row of tiny oriel-window
 * chips (the window of the section in view is lit). All bays are on the page, so the template's own jump and
 * `#cat-<slug>` scrolling reach them. Nothing moves.
 */
export function LatticeBody() {
  const { locale, tenant } = useApp();
  const { categories, byCategory, activeId } = useTemplate();
  const n = (value: number) => formatCount(value, locale, tenant.numeralSystem);
  // Numbers go by the section's place in the full menu, so a search never renumbers a bay or its window.
  const placeOf = usePlaceOf();

  return (
    <div className="tpl-body" data-body="lattice">
      <SectionStrip marker="oriels" prefix="sh" className="sh-strip" chip="sh-chip">
        {(category) => (
          <>
            <span aria-hidden data-pane={category.id === activeId ? 'active' : 'rest'} className="sh-glass">
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
            <section key={category.id} id={`cat-${category.slug}`} aria-labelledby={`h-${category.slug}`} className="tpl-section tpl-tall-last sh-bay">
              <ShapeHeading id={`h-${category.slug}`} name={category.name} label={n(placeOf(category) + 1)} count={n(products.length)} className="sh-head" title="sh-title tpl-banner" />
              <ul className="sh-grid">
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

/** A dish as a window pane: the photo in its arched turquoise frame, the add and the discount on the photo's foot, the name plaque, the brass price tag. The whole pane opens the dish. */
function Pane({ product, priority }: { product: MenuProductView; priority: boolean }) {
  const { openProduct } = useTemplate();
  return (
    <li data-row className="sh-pane">
      <div className="sh-frame">
        <div data-photo className="sh-photo tpl-cover-media tpl-plate">
          <ProductMedia product={product} suffix="lattice" sizes="(min-width: 1024px) 190px, (min-width: 640px) 22vw, 31vw" priority={priority} className="sh-img" rounded={false} />
          <SaleChip product={product} className="tpl-photo-off sh-off" />
          <QuickAction product={product} variant="icon" className="tpl-rim-add sh-add" />
        </div>
      </div>
      <button type="button" onClick={() => openProduct(product.id)} className="tpl-open tpl-dish-name sh-name">
        {product.name}
      </button>
      <Price product={product} className="tpl-price-tight sh-price" />
    </li>
  );
}
