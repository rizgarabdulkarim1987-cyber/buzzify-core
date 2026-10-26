'use client';

import { useRef, type CSSProperties } from 'react';
import type { MenuProductView } from '@/server/data/menu-view';
import { formatCount } from '@/server/domain/money';
import { useApp } from '@/ui/AppProviders';
import { useTemplate } from '../context';
import { Badges, Price, ProductMedia, QuickAction } from '../parts';
import { useKeepInView } from './shared/useKeepInView';
import './shared/shapes.css';
import './shelves.css';

/**
 * Supermarket shelves (spec 2026-10-26-menu-styles-in-templates-design.md). Every section is a bay: an aisle sign (its
 * number and name, and its dish count in the menu's numerals) over a shelf plank, with the dishes standing on the plank
 * as product boxes, four across on a phone and wrapping to more rows, each with a price tag hanging under it. A strip
 * of aisle signs stays at the top and jumps. All bays are on the page, so the template's own jump and `#cat-<slug>`
 * scrolling reach them, and the strip lights the aisle in view.
 */
export function ShelvesBody() {
  const { t, locale, tenant } = useApp();
  const { categories, byCategory, activeId, jumpTo, reduced } = useTemplate();
  const strip = useRef<HTMLUListElement>(null);
  const n = (value: number) => formatCount(value, locale, tenant.numeralSystem);

  // Keep the lit aisle sign in view, moving only the strip (never the page).
  useKeepInView(strip, activeId, 'x', reduced);

  return (
    <div className="tpl-body" data-body="shelves">
      <nav aria-label={t('menu.categories')} data-signs className="tpl-strip-sticky sf-signs">
        <ul ref={strip} className="scroll-hidden sf-signs-list">
          {categories.map((category) => (
            <li key={category.id}>
              <button
                type="button"
                data-category={category.id}
                aria-current={category.id === activeId ? 'true' : undefined}
                onClick={() => jumpTo(category.id)}
                className="sf-sign-chip"
              >
                {category.name}
              </button>
            </li>
          ))}
        </ul>
      </nav>
      <main id="menu" className="min-w-0">
        {categories.map((category, index) => {
          const products = byCategory.get(category.id) ?? [];
          return (
            <section key={category.id} id={`cat-${category.slug}`} aria-labelledby={`h-${category.slug}`} data-aisle={n(index + 1)} className="tpl-section sf-bay">
              <div tabIndex={-1} data-heading className="outline-none sf-head">
                <h2 id={`h-${category.slug}`} className="tpl-display sf-label">
                  <small aria-hidden>{t('tpl.shf.aisle', { n: n(index + 1) })}</small>
                  <span>{category.name}</span>
                  <b data-count aria-hidden>
                    {n(products.length)}
                  </b>
                </h2>
              </div>
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
      <div data-photo className="sf-photo">
        <ProductMedia product={product} suffix="shelves" sizes="120px" priority={priority} className="sf-img" />
      </div>
      <button type="button" onClick={() => openProduct(product.id)} className="tpl-open sf-name text-center">
        {product.name}
      </button>
      <span className="sf-tag">
        <Price product={product} className="sf-price" />
        <QuickAction product={product} className="sf-add relative z-[2]" />
      </span>
      <Badges product={product} className="sf-badges" />
    </li>
  );
}
