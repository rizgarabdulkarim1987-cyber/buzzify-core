'use client';

import { useRef } from 'react';
import { formatCount } from '@/server/domain/money';
import { useApp } from '@/ui/AppProviders';
import { useTemplate } from '../context';
import { Badges, Price, ProductMedia, QuickAction } from '../parts';
import { SectionStrip, ShapeHeading } from './shared/SectionStrip';
import { useOnceInView } from './shared/useOnceInView';
import { usePlaceOf } from './shared/usePlaceOf';
import { drawingRef, sheetOf, twoDigits } from './signature-24';
import './shared/photo-card.css';
import './shared/shapes.css';
import './blueprint.css';

/**
 * The Blueprint (kind `blueprint`, mockup `signature` / `bp`): the menu as an engineer's drawing set on blue paper with
 * a fine grid. Each section is a sheet with a title block (its sheet number of all the menu's); every dish is a technical
 * drawing in two columns: the photo in a round frame ringed by a dashed outline, corner ticks, a drawing number, and a
 * dimension line under the photo, its name and price below on solid paper so the grid never runs under the words.
 *
 * Motion: a drawing's dimension line and corner ticks draw themselves the first time it is seen (`data-in`); adding a
 * dish turns its dashed ring a quarter, as a compass would. With less motion everything is simply drawn.
 */
export function BlueprintBody() {
  const { locale, tenant } = useApp();
  const { view, categories, byCategory, reduced, openProduct } = useTemplate();
  const n = (value: number) => formatCount(value, locale, tenant.numeralSystem);
  const placeOf = usePlaceOf();
  const root = useRef<HTMLDivElement>(null);
  const total = view.categories.length;

  useOnceInView(root, reduced, { item: 'data-dwg', id: 'data-dwg', mark: 'data-in' });

  const added = (button: HTMLButtonElement) => {
    if (reduced) return;
    button
      .closest('[data-dwg]')
      ?.querySelector('.bp-ring')
      ?.animate([{ rotate: '0deg' }, { rotate: '90deg' }], { duration: 420, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' });
  };

  return (
    <div ref={root} className="tpl-body" data-body="blueprint">
      <SectionStrip marker="sheets" prefix="bp">
        {(category) => (
          <>
            <b aria-hidden dir="ltr" className="bp-chip-no">
              {twoDigits(placeOf(category) + 1, n)}
            </b>
            <span>{category.name}</span>
          </>
        )}
      </SectionStrip>
      <main id="menu" className="min-w-0 bp-main">
        {categories.map((category, index) => {
          const products = byCategory.get(category.id) ?? [];
          const place = placeOf(category);
          return (
            <section key={category.id} id={`cat-${category.slug}`} aria-labelledby={`h-${category.slug}`} className="tpl-section tpl-tall-last bp-section">
              <div className="bp-block">
                <ShapeHeading id={`h-${category.slug}`} name={category.name} count={n(products.length)} className="bp-head" title="bp-title" />
                <span aria-hidden dir="ltr" className="bp-sheet">
                  {sheetOf(place, total, n)}
                </span>
              </div>
              <ul className="bp-grid">
                {products.map((product, at) => (
                  <li key={product.id} data-dwg={product.id} className="bp-dwg">
                    <div className="bp-pic">
                      <span aria-hidden dir="ltr" className="bp-ref">
                        {drawingRef(place, at, n)}
                      </span>
                      <div className="bp-ring-wrap">
                        <i aria-hidden className="bp-ring" />
                        <div data-photo className="bp-photo tpl-plate tpl-fill-media">
                          <ProductMedia product={product} suffix="blueprint" sizes="(min-width: 640px) 200px, 30vw" priority={index === 0 && at < 4} rounded={false} />
                        </div>
                      </div>
                      <i aria-hidden className="bp-dim" />
                      <QuickAction product={product} variant="icon" className="bp-add relative z-[2]" onAdded={added} />
                    </div>
                    <div className="bp-text">
                      <button type="button" onClick={() => openProduct(product.id)} className="tpl-open bp-name text-start">
                        {product.name}
                      </button>
                      <span className="bp-meta">
                        <Price product={product} className="bp-price" />
                        <Badges product={product} className="bp-badges" />
                      </span>
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
