'use client';

import type { CSSProperties, MouseEvent } from 'react';
import { formatCount } from '@/server/domain/money';
import type { MenuProductView } from '@/server/data/menu-view';
import { useApp } from '@/ui/AppProviders';
import { PlusIcon } from '@/ui/Icons';
import { useTemplate } from '../context';
import { Price, ProductMedia, SaleChip, useAvailability } from '../parts';
import { flyToCart } from './fly-flight';
import { SectionStrip, ShapeHeading } from './shared/SectionStrip';
import './shared/shapes.css';
import './fly.css';

/**
 * The add button of a card: the same quick add as everywhere (`quickAdd` from the template; a dish that needs a choice
 * opens its details instead), and when the dish is added a copy of its photo flies to the cart bar (`flyToCart`).
 */
function FlyAdd({ product }: { product: MenuProductView }) {
  const { t } = useApp();
  const { canOrder, quickAdd, openProduct, reduced } = useTemplate();
  const { orderable } = useAvailability(product);
  if (!canOrder || !orderable) return null;
  const choose = product.needsChoices;
  const label = choose ? t('tpl.chooseNamed', { name: product.name }) : t('product.quickAdd', { name: product.name });
  const act = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (choose) {
      openProduct(product.id);
      return;
    }
    const button = event.currentTarget;
    quickAdd(product);
    flyToCart({ photo: button.closest('[data-photo]'), button, reduced });
  };
  return (
    <button type="button" onClick={act} aria-label={label} className="tpl-add tpl-rim-add fl-add">
      <PlusIcon />
    </button>
  );
}

/**
 * Fly to Cart (spec 2026-10-26-menu-styles-in-templates-design.md). An ordering-first dense menu: every section is a
 * labelled shelf (its name, its dish count, a ledge line) holding a uniform grid of compact square dish cards, three
 * across on a phone (more on a wide screen): the photo, the name, the price, and a big round + on the photo's corner.
 * Adding with + flies a small copy of the photo to the cart bar, which then pulses once (fly-flight.ts). Where ordering
 * is off the cards are plain tap-to-open cards with no +. A sticky strip of pill tabs at the top jumps to a section; all
 * sections are on the page, so the template's own jump and `#cat-<slug>` scrolling reach them.
 */
export function FlyBody() {
  const { locale, tenant } = useApp();
  const { categories, byCategory, openProduct } = useTemplate();
  const n = (value: number) => formatCount(value, locale, tenant.numeralSystem);

  return (
    <div className="tpl-body" data-body="fly">
      <SectionStrip marker="tabs" prefix="fl">
        {(category) => <span>{category.name}</span>}
      </SectionStrip>
      <main id="menu" className="min-w-0">
        {categories.map((category, index) => {
          const products = byCategory.get(category.id) ?? [];
          return (
            <section key={category.id} id={`cat-${category.slug}`} aria-labelledby={`h-${category.slug}`} data-shelf={n(index + 1)} className="tpl-section tpl-tall-last fl-section">
              <ShapeHeading id={`h-${category.slug}`} name={category.name} count={n(products.length)} className="fl-head" title="fl-title" />
              <ul className="fl-grid">
                {products.map((product, at) => (
                  <li key={product.id} data-row className="fl-card" style={{ '--i': Math.min(index * 3 + at, 8) } as CSSProperties}>
                    <div data-photo className="fl-photo tpl-cover-media">
                      <ProductMedia product={product} suffix="fly" sizes="(min-width: 1024px) 220px, (min-width: 640px) 25vw, 33vw" priority={index === 0 && at < 6} className="fl-img" rounded={false} />
                      <SaleChip product={product} className="fl-off" />
                      <FlyAdd product={product} />
                    </div>
                    <div className="fl-bar">
                      <button type="button" onClick={() => openProduct(product.id)} className="tpl-open tpl-dish-name fl-name">
                        {product.name}
                      </button>
                      <Price product={product} className="tpl-price-tight fl-price" />
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </main>
    </div>
  );
}
