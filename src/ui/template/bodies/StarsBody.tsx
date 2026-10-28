'use client';

import { useRef, type CSSProperties } from 'react';
import { formatCount } from '@/server/domain/money';
import { useApp } from '@/ui/AppProviders';
import { useTemplate } from '../context';
import { Badges, Price, ProductMedia, QuickAction } from '../parts';
import { hueAt, SHAPE_HUES } from './shared/hue';
import { SectionStrip, ShapeHeading } from './shared/SectionStrip';
import { usePlaceOf } from './shared/usePlaceOf';
import { starChart, starDown, starLetter, starNoise } from './stars-chart';
import { useSpineHold, useSpineWatch } from './useSpineMotion';
import './shared/shapes.css';
import './stars.css';

/** The faint stars twinkling behind each constellation. */
const DUST = 9;

/**
 * The Constellations (kind `space-const`, spec 2026-10-28-menu-styles-77-addendum.md): a deep-space sky chart. Every
 * section is a constellation in its own hue (--g): its dishes are round glowing star photos, each with its Bayer letter
 * (α, β, γ…), joined by dotted lines like a chart of the sky. The layout comes from a fixed pattern per count
 * (stars-chart.ts), rows of three and two, so a phone shows several dishes at once and every one is tapped directly.
 * Adding a dish lights its star for good. The faint stars behind twinkle only on screen and with motion allowed.
 */
export function StarsBody() {
  const { locale, tenant } = useApp();
  const { categories, byCategory, reduced, openProduct } = useTemplate();
  const n = (value: number) => formatCount(value, locale, tenant.numeralSystem);
  const placeOf = usePlaceOf();
  const root = useRef<HTMLDivElement>(null);

  useSpineWatch(root, !reduced, '.st-sky', 'data-live');
  useSpineHold(root, !reduced);

  const added = (button: HTMLButtonElement) => {
    const star = button.closest<HTMLElement>('[data-row]');
    star?.setAttribute('data-lit', '');
    if (reduced) return;
    star?.querySelector('[data-photo]')?.animate([{ scale: '1' }, { scale: '1.15' }, { scale: '1' }], { duration: 420, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' });
  };

  const hue = (place: number) => ({ '--g': hueAt(SHAPE_HUES, place) }) as CSSProperties;

  return (
    <div ref={root} className="tpl-body" data-body="space-const" data-still={reduced ? '' : undefined}>
      <SectionStrip marker="constellations" prefix="st" chipStyle={(category) => hue(placeOf(category))}>
        {(category) => (
          <>
            <i aria-hidden className="st-chip-mark" />
            <span>{category.name}</span>
          </>
        )}
      </SectionStrip>
      <main id="menu" className="min-w-0 st-main">
        {categories.map((category, index) => {
          const products = byCategory.get(category.id) ?? [];
          const place = placeOf(category);
          const chart = starChart(products.length);
          return (
            <section
              key={category.id}
              id={`cat-${category.slug}`}
              aria-labelledby={`h-${category.slug}`}
              className="tpl-section tpl-tall-last st-section"
              style={hue(place)}
            >
              <ShapeHeading id={`h-${category.slug}`} name={category.name} label={(place < 9 ? n(0) : '') + n(place + 1)} count={n(products.length)} className="st-head" title="st-title" />
              <div className="st-sky" style={{ '--rows': chart.rows } as CSSProperties}>
                <span aria-hidden className="st-dust">
                  {Array.from({ length: DUST }, (_, at) => (
                    <i
                      key={at}
                      style={
                        {
                          '--dx': Math.round(starNoise(place * 31 + at) * 96 + 2),
                          '--dd': Math.round(starNoise(place * 17 + at * 5 + 3) * 94 + 3),
                          '--tw': `${(2 + starNoise(place + at * 7) * 3).toFixed(2)}s`,
                        } as CSSProperties
                      }
                    />
                  ))}
                </span>
                <svg aria-hidden className="st-lines" focusable="false">
                  {chart.stars.slice(1).map((spot, at) => {
                    const from = chart.stars[at]!;
                    return <line key={at} x1={`${from.x}%`} y1={`${starDown(from, chart.rows)}%`} x2={`${spot.x}%`} y2={`${starDown(spot, chart.rows)}%`} />;
                  })}
                </svg>
                <ul className="st-stars">
                  {products.map((product, at) => {
                    const spot = chart.stars[at]!;
                    return (
                      <li key={product.id} data-row className="st-star" style={{ '--x': spot.x, '--r': spot.row, '--dy': spot.dy } as CSSProperties}>
                        <div data-photo className="st-photo tpl-plate">
                          <ProductMedia product={product} suffix="space-const" sizes="88px" priority={index === 0 && at < 6} rounded={false} className="st-img" />
                        </div>
                        <Badges product={product} className="st-badges" />
                        <QuickAction product={product} variant="icon" className="tpl-rim-add st-add z-[2]" onAdded={added} />
                        <span aria-hidden className="st-letter">
                          {starLetter(at, n)}
                        </span>
                        <button type="button" onClick={() => openProduct(product.id)} className="tpl-open st-name">
                          {product.name}
                        </button>
                        <Price product={product} className="tpl-price-tight st-price" />
                      </li>
                    );
                  })}
                </ul>
              </div>
            </section>
          );
        })}
      </main>
    </div>
  );
}
