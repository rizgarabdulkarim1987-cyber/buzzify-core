'use client';

import type { CSSProperties } from 'react';
import type { MenuProductView } from '@/server/data/menu-view';
import { formatCount } from '@/server/domain/money';
import { useApp } from '@/ui/AppProviders';
import { useTemplate } from '../context';
import { DishCounts, Price, ProductMedia, QuickAction, SaleChip } from '../parts';
import { SectionStrip, ShapeHeading } from './shared/SectionStrip';
import './shared/photo-card.css';
import './shared/shapes.css';
import './shelves.css';

/**
 * Supermarket shelves (spec 2026-10-26-menu-styles-in-templates-design.md). Every section is a bay: an aisle sign (its
 * number and name, and its dish count in the menu's numerals) over a shelf plank, with the dishes standing on the plank
 * as product boxes, three across on a phone and wrapping to more rows, each with a price tag hanging under the plank (the add button
 * and the price, the old price struck above a sale price). The whole box opens the
 * dish. A strip
 * of aisle signs stays at the top and jumps. All bays are on the page, so the template's own jump and `#cat-<slug>`
 * scrolling reach them, and the strip lights the aisle in view.
 */
export function ShelvesBody() {
  const { t, locale, tenant } = useApp();
  const { categories, byCategory } = useTemplate();
  const n = (value: number) => formatCount(value, locale, tenant.numeralSystem);

  return (
    <div className="tpl-body" data-body="shelves">
      <SectionStrip marker="signs" prefix="sf" className="sf-signs" chip="sf-sign-chip">
        {(category) => category.name}
      </SectionStrip>
      <main id="menu" className="min-w-0">
        {categories.map((category, index) => {
          const products = byCategory.get(category.id) ?? [];
          return (
            <section key={category.id} id={`cat-${category.slug}`} aria-labelledby={`h-${category.slug}`} data-aisle={n(index + 1)} className="tpl-section tpl-tall-last sf-bay">
              <ShapeHeading id={`h-${category.slug}`} name={category.name} label={t('tpl.shf.aisle', { n: n(index + 1) })} count={n(products.length)} className="sf-head" title="sf-label" />
              <ul className="sf-shelf" data-plank>
                {products.map((product, row) => (
                  <Box key={product.id} product={product} priority={index === 0 && row < 8} order={Math.min(index * 3 + row, 8)} />
                ))}
              </ul>
            </section>
          );
        })}
      </main>
    </div>
  );
}

function Box({ product, priority, order }: { product: MenuProductView; priority: boolean; order: number }) {
  const { openProduct } = useTemplate();
  return (
    <li data-row className="sf-box" style={{ '--i': order } as CSSProperties}>
      <div className="sf-pack">
        <div data-photo className="sf-photo">
          <ProductMedia product={product} suffix="shelves" sizes="128px" priority={priority} className="sf-img" />
        </div>
        <SaleChip product={product} className="tpl-photo-off sf-off" />
      </div>
      <button type="button" onClick={() => openProduct(product.id)} className="tpl-open sf-name text-center">
        {product.name}
      </button>
      <DishCounts product={product} />
      <span className="sf-tag">
        <QuickAction product={product} variant="icon" className="sf-add" />
        <Price product={product} className="sf-price" />
      </span>
    </li>
  );
}
