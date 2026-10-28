'use client';

import type { CSSProperties } from 'react';
import { formatCount } from '@/server/domain/money';
import { useApp } from '@/ui/AppProviders';
import { useTemplate } from '../context';
import type { MenuProductView } from '@/server/data/menu-view';
import { Price, ProductMedia, QuickAction, SaleChip } from '../parts';
import { hueAt } from './shared/hue';
import { SectionStrip, ShapeHeading } from './shared/SectionStrip';
import './shared/shapes.css';
import './treasure.css';

/** The coastlines (a CSS `border-radius`, eight radii) the islands take in turn, so neighbours differ; a sixth starts again. */
const COASTS = [
  '34% 40% 36% 30% / 28% 32% 38% 34%',
  '40% 30% 34% 38% / 32% 36% 30% 40%',
  '30% 36% 42% 32% / 38% 28% 36% 34%',
  '36% 34% 30% 40% / 30% 40% 34% 28%',
  '32% 42% 34% 30% / 36% 30% 40% 32%',
] as const;

/** The coastline (a `border-radius` value) of the nth island. */
export function islandShape(index: number): string {
  return COASTS[hueAt([0, 1, 2, 3, 4], index)]!;
}

/**
 * The Treasure Map (spec 2026-10-26-menu-styles-in-templates-design.md). The menu is an old map on parchment: every
 * section is an island (a hand-drawn blob) with its name on a banner and its dish count in the menu's numerals, every
 * dish a pin on it (a round photo, the price on a flag hung from it, the name below), three across on a phone. A dotted
 * route runs down the page past the islands, and a strip of compass points stays at the top and jumps, lighting the
 * island in view. All islands are on the page, so the template's own jump and `#cat-<slug>` scrolling reach them.
 */
export function TreasureBody() {
  const { locale, tenant } = useApp();
  const { categories, byCategory } = useTemplate();
  const n = (value: number) => formatCount(value, locale, tenant.numeralSystem);

  return (
    <div className="tpl-body" data-body="treasure">
      <SectionStrip marker="compass" prefix="tm" className="tm-compass" chip="tm-point">
        {(category, index) => (
          <>
            <span aria-hidden className="tm-bearing">
              {n(index + 1)}
            </span>
            <span className="tm-label">{category.name}</span>
          </>
        )}
      </SectionStrip>
      <main id="menu" className="min-w-0 tm-sea">
        {categories.map((category, index) => {
          const products = byCategory.get(category.id) ?? [];
          return (
            <section
              key={category.id}
              id={`cat-${category.slug}`}
              aria-labelledby={`h-${category.slug}`}
              data-island={n(index + 1)}
              style={{ '--coast': islandShape(index) } as CSSProperties}
              className="tpl-section tpl-tall-last tm-island"
            >
              <ShapeHeading id={`h-${category.slug}`} name={category.name} count={n(products.length)} className="tm-head" title="tm-title" />
              <ul className="tm-pins">
                {products.map((product, row) => (
                  <Pin key={product.id} product={product} priority={index === 0 && row < 6} order={Math.min(index * 3 + row, 8)} />
                ))}
              </ul>
            </section>
          );
        })}
      </main>
    </div>
  );
}

function Pin({ product, priority, order }: { product: MenuProductView; priority: boolean; order: number }) {
  const { openProduct } = useTemplate();
  return (
    <li data-row className="tm-pin tpl-rise" style={{ '--i': order } as CSSProperties}>
      <div className="tm-disc">
        <div data-photo className="tm-photo tpl-fill-media">
          <ProductMedia product={product} suffix="treasure" sizes="96px" priority={priority} className="tm-img" rounded={false} />
        </div>
        <SaleChip product={product} className="tm-off" />
        <QuickAction product={product} variant="icon" className="tpl-rim-add tm-add relative z-[2]" />
      </div>
      <Price product={product} className="tpl-price-tight tm-tag" />
      <button type="button" onClick={() => openProduct(product.id)} className="tpl-open tpl-dish-name tm-name text-center">
        {product.name}
      </button>
    </li>
  );
}
