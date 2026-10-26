'use client';

import type { CSSProperties } from 'react';
import type { MenuProductView } from '@/server/data/menu-view';
import { formatCount } from '@/server/domain/money';
import { useApp } from '@/ui/AppProviders';
import { useTemplate } from '../context';
import { Price, ProductMedia, QuickAction, SaleChip } from '../parts';
import { SectionStrip, ShapeHeading } from './shared/SectionStrip';
import './shared/shapes.css';
import './bento.css';

/** The most compartments one tray has; a box with more dishes gets several trays, each with a pattern of its own. */
const TRAY_MAX = 6;

/**
 * How a box's dishes split into trays: as many full trays of six as fit, and the rest on one more. A lone dish never
 * ends a longer box (7 is 4 and 3, not 6 and 1): it is a tray only when it is the box's only dish.
 */
export function compartmentSizes(count: number): number[] {
  const sizes: number[] = [];
  let left = count;
  while (left > TRAY_MAX) {
    const take = left - TRAY_MAX === 1 ? TRAY_MAX - 2 : TRAY_MAX;
    sizes.push(take);
    left -= take;
  }
  if (left > 0) sizes.push(left);
  return sizes;
}

/**
 * The Bento Box (spec 2026-10-26-menu-styles-in-templates-design.md). Every section is a lacquered bento box: a rounded
 * tray divided into compartments of unequal size (a big one for the lead dish, smaller ones for the rest, the pattern
 * chosen by how many dishes the box holds), each dish's photo filling its compartment. A paper flag pinned on the
 * compartment carries the name, a smaller flag the price. A strip of lid-handle tabs stays at the top and jumps,
 * lighting the box in view. All boxes are on the page, so the template's own jump and `#cat-<slug>` scrolling reach them.
 */
export function BentoBody() {
  const { t, locale, tenant } = useApp();
  const { categories, byCategory } = useTemplate();
  const n = (value: number) => formatCount(value, locale, tenant.numeralSystem);

  return (
    <div className="tpl-body" data-body="bento">
      <SectionStrip marker="lids" prefix="bn" className="bn-lids" chip="bn-lid">
        {(category) => <span className="bn-lid-label">{category.name}</span>}
      </SectionStrip>
      <main id="menu" className="min-w-0">
        {categories.map((category, index) => {
          const products = byCategory.get(category.id) ?? [];
          let from = 0;
          return (
            <section key={category.id} id={`cat-${category.slug}`} aria-labelledby={`h-${category.slug}`} data-box={n(index + 1)} className="tpl-section tpl-tall-last bn-box">
              <ShapeHeading id={`h-${category.slug}`} name={category.name} label={t('tpl.bnt.box', { n: n(index + 1) })} count={n(products.length)} className="bn-head" title="bn-tag" />
              {compartmentSizes(products.length).map((size, tray) => {
                const start = from;
                from += size;
                return (
                  <ul key={tray} className="bn-tray" data-n={size}>
                    {products.slice(start, start + size).map((product, at) => (
                      <Compartment key={product.id} product={product} slot={at} priority={index === 0 && start + at < 6} order={Math.min(index * 3 + start + at, 8)} />
                    ))}
                  </ul>
                );
              })}
            </section>
          );
        })}
      </main>
    </div>
  );
}

const AREAS = ['a', 'b', 'c', 'd', 'e', 'f'] as const;

function Compartment({ product, slot, priority, order }: { product: MenuProductView; slot: number; priority: boolean; order: number }) {
  const { openProduct } = useTemplate();
  return (
    <li data-row className="bn-cell tpl-rise" style={{ gridArea: AREAS[slot], '--i': order } as CSSProperties}>
      <div data-photo className="bn-photo tpl-cover-media">
        <ProductMedia product={product} suffix="bento" sizes="(min-width: 640px) 360px, 70vw" priority={priority} className="bn-img" rounded={false} />
      </div>
      <div className="bn-price-flag">
        <Price product={product} className="tpl-price-tight bn-price" />
        <SaleChip product={product} className="bn-off" />
      </div>
      <QuickAction product={product} variant="icon" className="tpl-rim-add bn-add relative z-[2]" />
      <button type="button" onClick={() => openProduct(product.id)} className="tpl-open tpl-dish-name bn-name text-start">
        {product.name}
      </button>
    </li>
  );
}
