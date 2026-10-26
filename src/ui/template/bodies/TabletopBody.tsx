'use client';

import { Fragment, type CSSProperties } from 'react';
import type { MenuProductView } from '@/server/data/menu-view';
import { formatCount } from '@/server/domain/money';
import { useApp } from '@/ui/AppProviders';
import { useTemplate } from '../context';
import { Price, ProductMedia, QuickAction } from '../parts';
import { hueAt } from './shared/hue';
import { SectionStrip, ShapeHeading } from './shared/SectionStrip';
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
            <Fragment key={category.id}>
              <section
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
        <Price product={product} className="tpl-price-tight tt-price" />
        <QuickAction product={product} variant="icon" className="tt-add relative z-[2]" />
      </div>
      <button type="button" onClick={() => openProduct(product.id)} className="tpl-open tt-name text-center">
        {product.name}
      </button>
    </li>
  );
}
