'use client';

import type { CSSProperties, MouseEvent } from 'react';
import { formatCount } from '@/server/domain/money';
import { useApp } from '@/ui/AppProviders';
import { useTemplate } from '../context';
import { Price, ProductMedia, QuickAction, SaleChip } from '../parts';
import { morphOpen, tileSpan } from './morph-open';
import { SectionStrip, ShapeHeading } from './shared/SectionStrip';
import './shared/shapes.css';
import './morph.css';

/**
 * Photo to Details (spec 2026-10-26-menu-styles-in-templates-design.md). A photo-first mosaic: every section is a block
 * with a heading that stays pinned under the strip while its dishes pass, and a dense grid of full-bleed photo tiles, two
 * across on a phone (three or four on a wide screen) in tall and short turns that interlock like bricks, each with a solid
 * caption bar (the name, the price) under its photo. Tapping a tile opens the dish and its photo grows from the tile into
 * the details (`morphOpen`: a clone moved with `transform` only, only when motion is wanted; otherwise a plain open).
 * A sticky strip of chips jumps to a section. All sections are on the page, so the template's own jump and `#cat-<slug>`
 * scrolling reach them.
 */
export function MorphBody() {
  const { locale, tenant } = useApp();
  const { categories, byCategory, openProduct, reduced } = useTemplate();
  const n = (value: number) => formatCount(value, locale, tenant.numeralSystem);

  return (
    <div className="tpl-body" data-body="morph">
      <SectionStrip marker="chips" prefix="mo">
        {(category) => <span>{category.name}</span>}
      </SectionStrip>
      <main id="menu" className="min-w-0">
        {categories.map((category, index) => {
          const products = byCategory.get(category.id) ?? [];
          return (
            <section key={category.id} id={`cat-${category.slug}`} aria-labelledby={`h-${category.slug}`} data-morph={n(index + 1)} className="tpl-section tpl-tall-last mo-section">
              <ShapeHeading id={`h-${category.slug}`} name={category.name} count={n(products.length)} className="mo-head" title="mo-title" />
              <ul className="mo-grid">
                {products.map((product, at) => (
                  <li key={product.id} data-row className="mo-tile tpl-rise" style={{ '--span': tileSpan(at), '--i': Math.min(index * 3 + at, 8) } as CSSProperties}>
                    <div data-photo className="mo-photo tpl-cover-media">
                      <ProductMedia product={product} suffix="morph" sizes="(min-width: 1024px) 320px, (min-width: 640px) 33vw, 50vw" priority={index === 0 && at < 4} className="mo-img" rounded={false} />
                      <SaleChip product={product} className="mo-off" />
                      <QuickAction product={product} variant="icon" className="tpl-rim-add mo-add relative z-[2]" />
                    </div>
                    <div className="mo-bar">
                      <button
                        type="button"
                        onClick={(event: MouseEvent<HTMLButtonElement>) =>
                          morphOpen({ photo: event.currentTarget.closest('li')?.querySelector('[data-photo]') ?? null, open: () => openProduct(product.id), reduced })
                        }
                        className="tpl-open tpl-dish-name mo-name"
                      >
                        {product.name}
                      </button>
                      <Price product={product} className="tpl-price-tight mo-price" />
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
