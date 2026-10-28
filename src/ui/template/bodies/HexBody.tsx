'use client';

import { useRef, type CSSProperties } from 'react';
import { formatCount } from '@/server/domain/money';
import { useApp } from '@/ui/AppProviders';
import { useTemplate } from '../context';
import { Badges, Price, ProductMedia, QuickAction } from '../parts';
import { SectionStrip, ShapeHeading } from './shared/SectionStrip';
import { usePlaceOf } from './shared/usePlaceOf';
import { beeFlight, COMB_COLUMNS, combCell } from './hex-comb';
import { useSpineHold, useSpineWatch } from './useSpineMotion';
import './shared/shapes.css';
import './honey.css';

/** The bees flying round each frame, and the honey drops falling from its top. */
const BEES = 2;
const DROPS = 3;

/**
 * Mountain Honey (kind `honey`, spec 2026-10-28-menu-styles-77-addendum.md): every section is a wooden comb frame with
 * honey dripping from its top; every dish a hexagonal comb cell, its photo inside, its name in honey colour, the cells
 * interlocking like real comb (hex-comb.ts: two columns on a phone, three, then four). A few bees fly round each frame
 * (decoration only: no motion with less motion, paused off screen and under a finger). Adding a dish makes its cell
 * swell and glow.
 */
export function HexBody() {
  const { locale, tenant } = useApp();
  const { categories, byCategory, reduced, openProduct } = useTemplate();
  const n = (value: number) => formatCount(value, locale, tenant.numeralSystem);
  const placeOf = usePlaceOf();
  const root = useRef<HTMLDivElement>(null);

  useSpineWatch(root, !reduced, '.hx-section', 'data-live');
  useSpineHold(root, !reduced);

  const added = (button: HTMLButtonElement) => {
    if (reduced) return;
    button
      .closest('[data-row]')
      ?.animate([{ scale: '1', filter: 'brightness(1)' }, { scale: '1.08', filter: 'brightness(1.25)' }, { scale: '1', filter: 'brightness(1)' }], {
        duration: 420,
        easing: 'cubic-bezier(0.23, 1, 0.32, 1)',
      });
  };

  return (
    <div ref={root} className="tpl-body" data-body="honey" data-still={reduced ? '' : undefined}>
      <SectionStrip marker="frames" prefix="hx">
        {(category) => (
          <>
            <i aria-hidden className="hx-chip-mark" />
            <span>{category.name}</span>
          </>
        )}
      </SectionStrip>
      <main id="menu" className="min-w-0 hx-main">
        {categories.map((category, index) => {
          const products = byCategory.get(category.id) ?? [];
          const place = placeOf(category);
          return (
            <section key={category.id} id={`cat-${category.slug}`} aria-labelledby={`h-${category.slug}`} className="tpl-section tpl-tall-last hx-section">
              <div className="hx-frame">
                <span aria-hidden className="hx-drip">
                  {Array.from({ length: DROPS }, (_, at) => (
                    <i key={at} style={{ '--at': at } as CSSProperties} />
                  ))}
                </span>
                <ShapeHeading id={`h-${category.slug}`} name={category.name} count={n(products.length)} className="hx-head" title="hx-title" />
                <div className="hx-wrap">
                  <ul className="hx-comb">
                    {products.map((product, at) => {
                      const [two, three, four] = COMB_COLUMNS.map((cols) => combCell(at, cols));
                      const style = {
                        '--c2': two!.column,
                        '--r2': two!.row,
                        '--c3': three!.column,
                        '--r3': three!.row,
                        '--c4': four!.column,
                        '--r4': four!.row,
                      } as CSSProperties;
                      return (
                        <li key={product.id} data-row className="hx-cell" style={style}>
                          <div data-photo className="hx-photo tpl-plate">
                            <ProductMedia product={product} suffix="honey" sizes="(min-width: 640px) 200px, 50vw" priority={index === 0 && at < 4} rounded={false} className="hx-img" />
                          </div>
                          <QuickAction product={product} variant="icon" className="tpl-rim-add hx-add z-[2]" onAdded={added} />
                          <Badges product={product} className="hx-badges" />
                          <div className="hx-label">
                            <button type="button" onClick={() => openProduct(product.id)} className="tpl-open hx-name">
                              {product.name}
                            </button>
                            <Price product={product} className="tpl-price-tight hx-price" />
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </div>
              {Array.from({ length: BEES }, (_, at) => {
                const bee = beeFlight(place * 7 + at * 3 + 1);
                return (
                  <i
                    key={at}
                    aria-hidden
                    className="hx-bee"
                    style={{ '--x': bee.x, '--y': bee.y, '--bx': `${bee.swing}px`, '--t': `${bee.time}s`, '--dl': `${bee.delay}s` } as CSSProperties}
                  />
                );
              })}
            </section>
          );
        })}
      </main>
    </div>
  );
}
