'use client';

import { useMemo, useRef, type CSSProperties } from 'react';
import { formatCount } from '@/server/domain/money';
import { useApp } from '@/ui/AppProviders';
import { useTemplate } from '../context';
import { Badges, Price, ProductMedia, QuickAction } from '../parts';
import { SectionStrip, ShapeHeading } from './shared/SectionStrip';
import { usePlaceOf } from './shared/usePlaceOf';
import { useSpineHold, useSpineWatch } from './useSpineMotion';
import './shared/photo-card.css';
import './shared/shapes.css';
import './film.css';

/** A steady pseudo-random number in [0, 1) for a seed, so a frame always flickers the same way. */
function noise(seed: number): number {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

/** A frame's flicker: its period (s) and its phase (s, negative: already running), so neighbours never flicker together. */
export function frameFlicker(seed: number): { time: number; delay: number } {
  return { time: Number((3 + noise(seed) * 2.5).toFixed(2)), delay: -Number((noise(seed + 11) * 5).toFixed(2)) };
}

/**
 * The edge code printed in the film's margin beside each frame: the frame's number on the whole reel (1-based, counting
 * across the sections shown), so a search that hides dishes renumbers the reel as a re-cut would.
 */
export function edgeCodes(sizes: readonly number[]): number[][] {
  let next = 1;
  return sizes.map((size) => Array.from({ length: size }, () => next++));
}

/**
 * The filmstrip family (spec 2026-10-28-menu-styles-77-addendum.md), kind `film`, «شريط السينما»: an old film strip runs
 * down the page with sprocket holes on both sides. Every dish is a frame, shown in black and white until it is in the
 * guest's order, when it turns to colour; its name, price and add sit on the frame's foot. Between the sections an
 * ornate silent-film title card carries the section's name (the first card also the restaurant's name, as the opening
 * title). The frames flicker and the film grains, only while their reel is on screen and no finger is down, and not at
 * all with less motion.
 */
export function FilmBody() {
  const { locale, tenant, cart, hydrated } = useApp();
  const { categories, byCategory, reduced, openProduct } = useTemplate();
  const n = (value: number) => formatCount(value, locale, tenant.numeralSystem);
  const placeOf = usePlaceOf();
  const root = useRef<HTMLDivElement>(null);
  // What the guest has ordered (read once the cart is restored, so the server's page and the first paint agree).
  const ordered = useMemo(() => new Set(hydrated ? cart.lines.map((line) => line.productId) : []), [cart.lines, hydrated]);
  const codes = edgeCodes(categories.map((category) => byCategory.get(category.id)?.length ?? 0));

  useSpineWatch(root, !reduced, '.fm-section', 'data-live');
  useSpineHold(root, !reduced);

  // A dish added: its frame flashes like a projector catching it, as it turns to colour.
  const flash = (button: HTMLButtonElement) => {
    if (reduced) return;
    button
      .closest('[data-row]')
      ?.querySelector('[data-photo]')
      ?.animate([{ filter: 'brightness(1)' }, { filter: 'brightness(1.8)' }, { filter: 'brightness(1)' }], { duration: 420, easing: 'steps(3, end)' });
  };

  return (
    <div ref={root} className="tpl-body" data-body="film">
      <SectionStrip marker="reels" prefix="fm">
        {(category) => <span>{category.name}</span>}
      </SectionStrip>
      <main id="menu" className="min-w-0 fm-main">
        {categories.map((category, index) => {
          const products = byCategory.get(category.id) ?? [];
          const place = placeOf(category);
          return (
            <section key={category.id} id={`cat-${category.slug}`} aria-labelledby={`h-${category.slug}`} className="tpl-section tpl-tall-last fm-section">
              <div className="fm-card">
                {index === 0 ? (
                  <p aria-hidden className="fm-presents">
                    {tenant.logoText}
                  </p>
                ) : null}
                <ShapeHeading
                  id={`h-${category.slug}`}
                  name={category.name}
                  label={n(place + 1)}
                  count={n(products.length)}
                  className="fm-head"
                  title="fm-title"
                  lead={<i aria-hidden className="fm-flourish" />}
                />
              </div>
              <ul className="fm-reel">
                {products.map((product, at) => {
                  const flicker = frameFlicker(index * 50 + at + 1);
                  return (
                    <li
                      key={product.id}
                      data-row
                      data-ordered={ordered.has(product.id) || undefined}
                      className="fm-frame"
                      style={{ '--t': `${flicker.time}s`, '--dl': `${flicker.delay}s` } as CSSProperties}
                    >
                      <span aria-hidden dir="ltr" className="fm-code">
                        {n(codes[index]![at]!)}
                      </span>
                      <div data-photo className="fm-shot tpl-plate">
                        <ProductMedia product={product} suffix="film" sizes="(min-width: 640px) 560px, 80vw" priority={index === 0 && at < 3} rounded={false} className="fm-img" />
                      </div>
                      <div className="fm-cap">
                        <button type="button" onClick={() => openProduct(product.id)} className="tpl-open fm-name text-start">
                          {product.name}
                        </button>
                        <span className="fm-meta">
                          <Price product={product} className="fm-price" />
                          <Badges product={product} className="fm-badges" />
                        </span>
                        <QuickAction product={product} variant="label" className="fm-add relative z-[2]" onAdded={flash} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </main>
    </div>
  );
}
