'use client';

import { useRef, type CSSProperties } from 'react';
import type { MenuProductView } from '@/server/data/menu-view';
import { formatCount } from '@/server/domain/money';
import { useApp } from '@/ui/AppProviders';
import { useTemplate } from '../context';
import { Price, ProductMedia, QuickAction } from '../parts';
import { hueAt } from './shared/hue';
import { useKeepInView } from './shared/useKeepInView';
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
 * badge on the corner), four across on a phone. Every section is a folder band (its name and dish count in the menu's
 * numerals) holding its icons, and a dock of app tiles stays at the top and jumps, lighting the folder in view. All
 * folders are on the page, so the template's own jump and `#cat-<slug>` scrolling reach them.
 */
export function HomescreenBody() {
  const { t, locale, tenant } = useApp();
  const { categories, byCategory, activeId, jumpTo, reduced } = useTemplate();
  const strip = useRef<HTMLUListElement>(null);
  const n = (value: number) => formatCount(value, locale, tenant.numeralSystem);

  // Keep the lit tile in view, moving only the dock (never the page).
  useKeepInView(strip, activeId, 'x', reduced);

  return (
    <div className="tpl-body" data-body="homescreen">
      <nav aria-label={t('menu.categories')} data-dock className="tpl-strip-sticky hs-dock">
        <ul ref={strip} className="scroll-hidden hs-dock-list">
          {categories.map((category, index) => (
            <li key={category.id}>
              <button
                type="button"
                data-category={category.id}
                aria-current={category.id === activeId ? 'true' : undefined}
                onClick={() => jumpTo(category.id)}
                className="hs-tile"
                style={{ '--app-h': appHue(index) } as CSSProperties}
              >
                <span aria-hidden className="hs-glyph">
                  {n(index + 1)}
                </span>
                <span className="hs-label">{category.name}</span>
              </button>
            </li>
          ))}
        </ul>
      </nav>
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
              <div tabIndex={-1} data-heading className="outline-none hs-head">
                <h2 id={`h-${category.slug}`} className="tpl-display hs-title">
                  <span>{category.name}</span>
                  <b data-count aria-hidden>
                    {n(products.length)}
                  </b>
                </h2>
              </div>
              <ul className="hs-apps">
                {products.map((product, row) => (
                  <App key={product.id} product={product} priority={index === 0 && row < 8} order={Math.min(index * 4 + row, 8)} />
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
        <Price product={product} className="hs-badge" />
        <QuickAction product={product} className="hs-add relative z-[2]" />
      </div>
      <button type="button" onClick={() => openProduct(product.id)} className="tpl-open hs-name text-center">
        {product.name}
      </button>
    </li>
  );
}
