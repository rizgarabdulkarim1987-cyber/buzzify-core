'use client';

import { Fragment, useRef, type CSSProperties } from 'react';
import type { MenuProductView } from '@/server/data/menu-view';
import { formatCount } from '@/server/domain/money';
import { useApp } from '@/ui/AppProviders';
import { useTemplate } from '../context';
import { Badges, Price, ProductMedia, QuickAction } from '../parts';
import { hueAt } from './shared/hue';
import { useKeepInView } from './shared/useKeepInView';
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
 * round plates, three across on a phone, each with the price on a chip on the rim, an add button on the opposite rim and
 * the name under it. A fork and knife lie between placemats (decoration only). A strip of napkin chips stays at the top
 * and jumps, and lights the placemat in view. All placemats are on the page, so the template's own jump and
 * `#cat-<slug>` scrolling reach them.
 */
export function TabletopBody() {
  const { t, locale, tenant } = useApp();
  const { categories, byCategory, activeId, jumpTo, reduced } = useTemplate();
  const strip = useRef<HTMLUListElement>(null);
  const n = (value: number) => formatCount(value, locale, tenant.numeralSystem);

  // Keep the lit napkin in view, moving only the strip (never the page).
  useKeepInView(strip, activeId, 'x', reduced);

  return (
    <div className="tpl-body" data-body="tabletop">
      <nav aria-label={t('menu.categories')} data-placemats className="tpl-strip-sticky tt-napkins">
        <ul ref={strip} className="scroll-hidden tt-napkins-list">
          {categories.map((category) => (
            <li key={category.id}>
              <button
                type="button"
                data-category={category.id}
                aria-current={category.id === activeId ? 'true' : undefined}
                onClick={() => jumpTo(category.id)}
                className="tt-napkin"
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
            <Fragment key={category.id}>
              <section
                id={`cat-${category.slug}`}
                aria-labelledby={`h-${category.slug}`}
                data-mat={n(index + 1)}
                style={{ '--mat-h': matHue(index) } as CSSProperties}
                className="tpl-section tpl-tall-last tt-mat"
              >
                <div tabIndex={-1} data-heading className="outline-none tt-head">
                  <h2 id={`h-${category.slug}`} className="tpl-display tt-title">
                    <small aria-hidden>{t('tpl.top.setting', { n: n(index + 1) })}</small>
                    <span>{category.name}</span>
                    <b data-count aria-hidden>
                      {n(products.length)}
                    </b>
                  </h2>
                </div>
                <ul className="tt-plates">
                  {products.map((product, row) => (
                    <Plate key={product.id} product={product} priority={index === 0 && row < 6} order={Math.min(index * 3 + row, 8)} />
                  ))}
                </ul>
              </section>
              {index < categories.length - 1 ? (
                <div aria-hidden className="tt-cutlery">
                  <i className="tt-fork" />
                  <i className="tt-napkin-fold" />
                  <i className="tt-knife" />
                </div>
              ) : null}
            </Fragment>
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
        <div data-photo className="tt-photo">
          <ProductMedia product={product} suffix="tabletop" sizes="120px" priority={priority} className="tt-img" rounded={false} />
        </div>
        <Price product={product} className="tt-price" />
        <QuickAction product={product} className="tt-add relative z-[2]" />
      </div>
      <button type="button" onClick={() => openProduct(product.id)} className="tpl-open tt-name text-center">
        {product.name}
      </button>
      <Badges product={product} className="tt-badges" />
    </li>
  );
}
