'use client';

import { useRef, type CSSProperties } from 'react';
import { formatCount } from '@/server/domain/money';
import { useApp } from '@/ui/AppProviders';
import { useTemplate } from '../context';
import { Badges, Price, ProductMedia, QuickAction } from '../parts';
import { aquaBubbles, aquaSwim } from './signature-25';
import { SectionStrip, ShapeHeading } from './shared/SectionStrip';
import { usePlaceOf } from './shared/usePlaceOf';
import { useSpineHold, useSpineWatch } from './useSpineMotion';
import './shared/photo-card.css';
import './shared/shapes.css';
import './aqua.css';

/**
 * The Aquarium (kind `aqua`, mockup signature-2 `aqua`): the menu under water. Light ripples over each section (the
 * caustics), bubbles rise behind the dishes, and the dishes swim as a school in two staggered columns, each photo a
 * glassy bubble bobbing gently on its own rhythm. Only the photo swims: a dish's name, price and add button stay still,
 * and its tap area (the name's) covers the whole dish and never moves, so reading and tapping are never disturbed.
 *
 * The water moves only while the section is on screen (`data-live`), stops while a finger is down (`data-hold`) or a
 * dish is pointed at, and is off with less motion. All sections are on the page, so the template's jump reaches them.
 */
export function AquaBody() {
  const { locale, tenant } = useApp();
  const { categories, byCategory, reduced, openProduct } = useTemplate();
  const n = (value: number) => formatCount(value, locale, tenant.numeralSystem);
  const placeOf = usePlaceOf();
  const root = useRef<HTMLDivElement>(null);

  useSpineWatch(root, !reduced, '.aq-section', 'data-live');
  useSpineHold(root, !reduced);

  /** Added: the bubble gives a soft wobble, like a fish taking the bait. */
  const wobble = (button: HTMLButtonElement) => {
    if (reduced) return;
    button
      .closest('[data-row]')
      ?.querySelector('[data-photo]')
      ?.animate([{ scale: '1' }, { scale: '1.1 0.92' }, { scale: '0.96 1.06' }, { scale: '1' }], { duration: 480, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' });
  };

  return (
    <div ref={root} className="tpl-body" data-body="aqua">
      <SectionStrip marker="waters" prefix="aq">
        {(category) => (
          <>
            <i aria-hidden className="aq-chip-bubble" />
            <span>{category.name}</span>
          </>
        )}
      </SectionStrip>
      <main id="menu" className="min-w-0 aq-main">
        {categories.map((category, index) => {
          const products = byCategory.get(category.id) ?? [];
          const place = placeOf(category);
          return (
            <section key={category.id} id={`cat-${category.slug}`} aria-labelledby={`h-${category.slug}`} className="tpl-section tpl-tall-last aq-section">
              <span aria-hidden className="aq-water">
                <i className="aq-caustics" />
                {aquaBubbles(7, place + 1).map((bubble, at) => (
                  <i
                    key={at}
                    className="aq-bubble"
                    style={{ '--x': `${bubble.x}%`, '--s': `${bubble.size}px`, '--t': `${bubble.time}s`, '--dl': `${bubble.delay}s` } as CSSProperties}
                  />
                ))}
              </span>
              <ShapeHeading
                id={`h-${category.slug}`}
                name={category.name}
                count={n(products.length)}
                className="aq-head"
                title="aq-title"
                lead={<i aria-hidden className="aq-head-bubble" />}
              />
              <ul className="aq-school">
                {products.map((product, at) => {
                  const swim = aquaSwim(place * 61 + at + 1);
                  return (
                    <li
                      key={product.id}
                      data-row
                      className="aq-fish"
                      style={{ '--t': `${swim.time}s`, '--dl': `${swim.delay}s`, '--dx': `${swim.dx}px` } as CSSProperties}
                    >
                      <div className="aq-tank">
                        <div data-photo className="aq-orb tpl-plate">
                          <ProductMedia product={product} suffix="aqua" sizes="(min-width: 640px) 180px, 34vw" priority={index === 0 && at < 4} rounded={false} className="aq-img" />
                        </div>
                        <Badges product={product} className="aq-badges" />
                      </div>
                      <button type="button" onClick={() => openProduct(product.id)} className="tpl-open aq-name">
                        {product.name}
                      </button>
                      <span className="aq-meta">
                        <Price product={product} className="aq-price" />
                        <QuickAction product={product} variant="icon" className="aq-add relative z-[2]" onAdded={wobble} />
                      </span>
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
