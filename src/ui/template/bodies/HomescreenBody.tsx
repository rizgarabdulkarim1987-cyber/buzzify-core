'use client';

import type { CSSProperties } from 'react';
import type { MenuProductView } from '@/server/data/menu-view';
import { formatCount } from '@/server/domain/money';
import { useApp } from '@/ui/AppProviders';
import { useTemplate } from '../context';
import { Price, ProductMedia, QuickAction } from '../parts';
import { hueAt } from './shared/hue';
import { SectionStrip, ShapeHeading } from './shared/SectionStrip';
import './shared/shapes.css';
import './homescreen.css';

/** The hues (degrees) of the dock's app tiles, spread around the wheel so neighbours differ; a seventh starts again. */
const HUES = [340, 28, 150, 205, 265, 48] as const;

/** The hue (in degrees) of the nth dock tile. */
export function appHue(index: number): number {
  return hueAt(HUES, index);
}

/**
 * Phone Home Screen (spec 2026-10-26-menu-styles-in-templates-design.md). The menu is a phone's home screen: every
 * dish is an app icon (a rounded square photo, its name below in two lines at most, its price as a red notification
 * badge on the corner), four across on a phone. Every section is a folder band whose first cell is its label tile (name
 * and dish count in the menu's numerals), so a short section takes one row and the first screen holds several folders.
 * A slim dock of app tiles stays at the top and jumps, lighting the folder in view. All folders are on the page, so the
 * template's own jump and `#cat-<slug>` scrolling reach them.
 */
export function HomescreenBody() {
  const { locale, tenant } = useApp();
  const { categories, byCategory } = useTemplate();
  const n = (value: number) => formatCount(value, locale, tenant.numeralSystem);

  return (
    <div className="tpl-body" data-body="homescreen">
      <SectionStrip marker="dock" prefix="hs" className="hs-dock" chip="hs-tile" chipStyle={(_, index) => ({ '--app-h': appHue(index) }) as CSSProperties}>
        {(category, index) => (
          <>
            <span aria-hidden className="hs-glyph">
              {n(index + 1)}
            </span>
            <span className="hs-label">{category.name}</span>
          </>
        )}
      </SectionStrip>
      <main id="menu" className="min-w-0">
        {categories.map((category, index) => {
          const products = byCategory.get(category.id) ?? [];
          return (
            <section
              key={category.id}
              id={`cat-${category.slug}`}
              aria-labelledby={`h-${category.slug}`}
              data-folder={n(index + 1)}
              className="tpl-section tpl-tall-last hs-folder"
            >
              <ul className="hs-apps">
                {/* The folder's label sits in the grid as its first tile; it is not one of the list's dishes. */}
                <li role="none" className="hs-label-tile">
                  <ShapeHeading id={`h-${category.slug}`} name={category.name} count={n(products.length)} className="hs-head" title="hs-title" />
                </li>
                {products.map((product, row) => (
                  <App key={product.id} product={product} priority={index < 3 && row < 4} order={Math.min(index * 4 + row, 8)} />
                ))}
              </ul>
            </section>
          );
        })}
      </main>
    </div>
  );
}

function App({ product, priority, order }: { product: MenuProductView; priority: boolean; order: number }) {
  const { openProduct } = useTemplate();
  return (
    <li data-row className="hs-app" style={{ '--i': order } as CSSProperties}>
      <div className="hs-icon">
        <div data-photo className="hs-photo">
          <ProductMedia product={product} suffix="homescreen" sizes="96px" priority={priority} className="hs-img" rounded={false} />
        </div>
        <Price product={product} className="tpl-price-tight hs-badge" />
        <QuickAction product={product} variant="icon" className="hs-add relative z-[2]" />
      </div>
      <button type="button" onClick={() => openProduct(product.id)} className="tpl-open hs-name text-center">
        {product.name}
      </button>
    </li>
  );
}
