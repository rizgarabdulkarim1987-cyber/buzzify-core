'use client';

import { useRef, type CSSProperties } from 'react';
import { formatCount } from '@/server/domain/money';
import { useApp } from '@/ui/AppProviders';
import { useTemplate } from '../context';
import { Badges, Price, ProductMedia, QuickAction } from '../parts';
import { hueAt, SHAPE_HUES } from './shared/hue';
import { SectionStrip, ShapeHeading } from './shared/SectionStrip';
import { usePlaceOf } from './shared/usePlaceOf';
import './shared/photo-card.css';
import './shared/shapes.css';
import './city.css';

/** How much lower a tower's roof sits than the tallest one's (rem): a step per dish it has fewer, at most `cap`. */
export function roofDrop(count: number, tallest: number, step = 0.75, cap = 6): number {
  return Math.min(cap, Math.max(0, tallest - count) * step);
}

/** A floor's number, counted from the street: the top floor of a tower of `count` is `count`, its last floor 1. */
export function floorNumber(at: number, count: number): number {
  return count - at;
}

/**
 * The towers family (spec 2026-10-28-menu-styles-77-addendum.md), kind `city`, «مدينة الأكل»: the menu is a city at
 * night. Every section is a tower with a neon sign in its own hue on its roof; every dish is a floor whose lit window
 * shows its photo, with its name and price beside it. The towers stand side by side on one road, the tallest the section
 * with the most dishes (the others' roofs step down), and the row scrolls sideways; a phone shows two towers and the edge
 * of a third, so the first screen holds two columns of windows.
 *
 * Every tower is its section (`#cat-<slug>`): the page scrolls down through all of them at once, and the template's own
 * jump scrolls the row sideways and the page down to the tower's sign (`scrollIntoView` moves both), which then flickers.
 * The strip's signs light as a tower comes into the row's view.
 */
export function CityBody() {
  const { locale, tenant } = useApp();
  const { categories, byCategory, reduced, openProduct } = useTemplate();
  const n = (value: number) => formatCount(value, locale, tenant.numeralSystem);
  const placeOf = usePlaceOf();
  const root = useRef<HTMLDivElement>(null);
  const tallest = Math.max(0, ...categories.map((category) => byCategory.get(category.id)?.length ?? 0));
  const hue = (place: number) => ({ '--h': hueAt(SHAPE_HUES, place) }) as CSSProperties;

  // A tapped sign: its tower's sign on the roof buzzes on like a neon tube, once.
  const flicker = (categoryId: string) => {
    if (reduced) return;
    root.current
      ?.querySelector<HTMLElement>(`[data-tower="${categoryId}"] .ct-sign`)
      ?.animate([{ opacity: 1 }, { opacity: 0.25 }, { opacity: 1 }, { opacity: 0.4 }, { opacity: 1 }], { duration: 520, easing: 'steps(5, end)' });
  };
  // A dish added: its window flares and settles.
  const lit = (button: HTMLButtonElement) => {
    if (reduced) return;
    button
      .closest('[data-row]')
      ?.querySelector('[data-photo]')
      ?.animate([{ filter: 'brightness(1)' }, { filter: 'brightness(1.6)' }, { filter: 'brightness(1)' }], { duration: 480, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' });
  };

  return (
    <div ref={root} className="tpl-body" data-body="city">
      <SectionStrip marker="signs" prefix="ct" chipStyle={(category) => hue(placeOf(category))} onPick={(category) => flicker(category.id)}>
        {(category) => (
          <>
            <i aria-hidden className="ct-chip-tube" />
            <span>{category.name}</span>
          </>
        )}
      </SectionStrip>
      <main id="menu" className="min-w-0 ct-main">
        <i aria-hidden className="ct-moon" />
        <div className="scroll-hidden ct-row">
          {categories.map((category, index) => {
            const products = byCategory.get(category.id) ?? [];
            const place = placeOf(category);
            return (
              <section
                key={category.id}
                id={`cat-${category.slug}`}
                aria-labelledby={`h-${category.slug}`}
                data-tower={category.id}
                className="ct-tower"
                style={{ ...hue(place), '--drop': `${roofDrop(products.length, tallest)}rem` } as CSSProperties}
              >
                <i aria-hidden className="ct-mast" />
                <ShapeHeading id={`h-${category.slug}`} name={category.name} count={n(products.length)} className="ct-head" title="ct-sign" />
                <div className="ct-bld">
                  <ul className="ct-floors">
                    {products.map((product, at) => (
                      <li key={product.id} data-row className="ct-floor">
                        <div data-photo className="ct-window tpl-plate">
                          <ProductMedia product={product} suffix="city" sizes="72px" priority={index < 2 && at < 6} rounded={false} className="ct-img" />
                        </div>
                        <div className="ct-text">
                          <button type="button" onClick={() => openProduct(product.id)} className="tpl-open ct-name text-start">
                            {product.name}
                          </button>
                          <small aria-hidden className="ct-level">
                            {n(floorNumber(at, products.length))}
                          </small>
                          <span className="ct-meta">
                            <Price product={product} className="ct-price" />
                            <QuickAction product={product} variant="icon" className="ct-add relative z-[2]" onAdded={lit} />
                          </span>
                          <Badges product={product} className="ct-badges" />
                        </div>
                      </li>
                    ))}
                  </ul>
                  <i aria-hidden className="ct-door" />
                </div>
              </section>
            );
          })}
        </div>
        <i aria-hidden className="ct-road" />
      </main>
    </div>
  );
}
