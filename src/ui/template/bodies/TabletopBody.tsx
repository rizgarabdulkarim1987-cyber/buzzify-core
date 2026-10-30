'use client';

import type { CSSProperties } from 'react';
import type { MenuProductView } from '@/server/data/menu-view';
import { formatCount } from '@/server/domain/money';
import { useApp } from '@/ui/AppProviders';
import { useTemplate } from '../context';
import { DishCounts, Price, ProductMedia, QuickAction, SaleChip } from '../parts';
import { hueAt } from './shared/hue';
import { SectionStrip, ShapeHeading } from './shared/SectionStrip';
import './shared/photo-card.css';
import './shared/shapes.css';
import './tabletop.css';

/** The hues (degrees) of the placemats, spread around the wheel so neighbours differ; a seventh placemat starts again. */
const HUES = [8, 38, 150, 215, 280, 330] as const;

/** The hue (in degrees) of the nth placemat. */
export function matHue(index: number): number {
  return hueAt(HUES, index);
}

/**
 * The Table from Above (spec 2026-10-26-menu-styles-in-templates-design.md). The menu is a wood table seen from above:
 * every section is a placemat (its place-setting number, name and dish count in the menu's numerals) and its dishes are
 * big round plates, two across on a phone, each with a fork and a knife laid beside it and a little card under it (the add
 * button, the name and the price). A strip of napkin chips stays at the top
 * and jumps, and lights the placemat in view. All placemats are on the page, so the template's own jump and
 * `#cat-<slug>` scrolling reach them.
 */
export function TabletopBody() {
  const { t, locale, tenant } = useApp();
  const { categories, byCategory } = useTemplate();
  const n = (value: number) => formatCount(value, locale, tenant.numeralSystem);

  return (
    <div className="tpl-body" data-body="tabletop">
      <SectionStrip marker="placemats" prefix="tt" className="tt-napkins" chip="tt-napkin">
        {(category) => category.name}
      </SectionStrip>
      <main id="menu" className="min-w-0">
        {categories.map((category, index) => {
          const products = byCategory.get(category.id) ?? [];
          return (
            <section
              key={category.id}
              id={`cat-${category.slug}`}
              aria-labelledby={`h-${category.slug}`}
              data-mat={n(index + 1)}
              style={{ '--mat-h': matHue(index) } as CSSProperties}
              className="tpl-section tpl-tall-last tt-mat"
            >
              <ShapeHeading id={`h-${category.slug}`} name={category.name} label={t('tpl.top.setting', { n: n(index + 1) })} count={n(products.length)} className="tt-head" title="tt-title" />
              <ul className="tt-plates">
                {products.map((product, row) => (
                  <Plate key={product.id} product={product} priority={index === 0 && row < 6} order={Math.min(index * 3 + row, 8)} />
                ))}
              </ul>
            </section>
          );
        })}
      </main>
    </div>
  );
}

function Plate({ product, priority, order }: { product: MenuProductView; priority: boolean; order: number }) {
  const { openProduct } = useTemplate();
  return (
    <li data-row className="tt-plate" style={{ '--i': order } as CSSProperties}>
      <div className="tt-disc">
        <i aria-hidden className="tt-fork" />
        <div data-photo className="tt-photo">
          <ProductMedia product={product} suffix="tabletop" sizes="132px" priority={priority} className="tt-img" rounded={false} />
        </div>
        <i aria-hidden className="tt-knife" />
        <SaleChip product={product} className="tpl-photo-off tt-off" />
      </div>
      <div className="tt-card">
        <QuickAction product={product} variant="icon" className="tt-add relative z-[2]" />
        <span className="tt-info">
          <button type="button" onClick={() => openProduct(product.id)} className="tpl-open tt-name text-start">
            {product.name}
          </button>
          <DishCounts product={product} />
          <Price product={product} className="tt-price" />
        </span>
      </div>
    </li>
  );
}
