'use client';

import { useRef, type CSSProperties } from 'react';
import { formatCount } from '@/server/domain/money';
import { useApp } from '@/ui/AppProviders';
import { useTemplate } from '../context';
import { Badges, Description, Price, ProductMedia, QuickAction } from '../parts';
import { SectionStrip, ShapeHeading } from './shared/SectionStrip';
import { useOnceInView } from './shared/useOnceInView';
import { usePlaceOf } from './shared/usePlaceOf';
import { useSpineHold, useSpineWatch } from './useSpineMotion';
import './shared/photo-card.css';
import './shared/shapes.css';
import './pshtwen.css';

/** The side a wrap of the sash comes in from and leans to: the first from the start, then turn about (1 start, -1 end). */
export function wrapSide(at: number): 1 | -1 {
  return at % 2 === 0 ? 1 : -1;
}

/** The sash's weave for a section: which of the three stripe patterns it is woven in, so neighbouring sashes differ. */
export function sashWeave(place: number): 0 | 1 | 2 {
  return (((place % 3) + 3) % 3) as 0 | 1 | 2;
}

/** The knot's fringe: how many tassels hang, and each one's length (rem), the same for the same section. */
export function knotFringe(place: number, count = 7): number[] {
  return Array.from({ length: count }, (_, at) => 1.5 + (((place + 1) * 7 + at * 5) % 4) * 0.25);
}

/**
 * The wrap family (spec 2026-10-28-menu-styles-77-addendum.md), kind `pshtwen`, «البشتوين»: the long Kurdish cloth sash
 * wound round the waist. Every section is a striped sash and every dish one wrap of it, laid over the one above and
 * tilted the other way, with its photo, name, price and add on the cloth; the sash ends in a knot with swinging fringes.
 * As the page scrolls, each wrap winds in from its side and settles, once (the first screen is settled already); the
 * fringes swing only while their knot is on screen and no finger is down. With less motion all of it is still.
 */
export function PshtwenBody() {
  const { locale, tenant } = useApp();
  const { categories, byCategory, reduced, openProduct } = useTemplate();
  const n = (value: number) => formatCount(value, locale, tenant.numeralSystem);
  const placeOf = usePlaceOf();
  const root = useRef<HTMLDivElement>(null);

  useOnceInView(root, reduced, { item: 'data-wrap', id: 'data-wrap', mark: 'data-in', line: 0.92 });
  useSpineWatch(root, !reduced, '.pw-knot', 'data-live');
  useSpineHold(root, !reduced);

  // A dish added: the wrap is pulled tight, a quick squeeze and back.
  const tighten = (button: HTMLButtonElement) => {
    if (reduced) return;
    button
      .closest('[data-row]')
      ?.animate([{ scale: '1 1' }, { scale: '1.03 0.92' }, { scale: '1 1' }], { duration: 360, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' });
  };

  return (
    <div ref={root} className="tpl-body" data-body="pshtwen">
      <SectionStrip marker="sashes" prefix="pw">
        {(category) => (
          <>
            <i aria-hidden className="pw-chip-band" data-weave={sashWeave(placeOf(category))} />
            <span>{category.name}</span>
          </>
        )}
      </SectionStrip>
      <main id="menu" className="min-w-0 pw-main">
        {categories.map((category, index) => {
          const products = byCategory.get(category.id) ?? [];
          const place = placeOf(category);
          return (
            <section
              key={category.id}
              id={`cat-${category.slug}`}
              aria-labelledby={`h-${category.slug}`}
              data-weave={sashWeave(place)}
              className="tpl-section tpl-tall-last pw-section"
            >
              <ShapeHeading id={`h-${category.slug}`} name={category.name} count={n(products.length)} className="pw-head" title="pw-title" />
              <ul className="pw-sash">
                {products.map((product, at) => (
                  <li key={product.id} data-row data-wrap={product.id} className="pw-wrap" style={{ '--s': wrapSide(at) } as CSSProperties}>
                    <div data-photo className="pw-photo tpl-plate">
                      <ProductMedia product={product} suffix="pshtwen" sizes="64px" priority={index === 0 && at < 6} className="pw-img" />
                    </div>
                    <div className="pw-text">
                      <button type="button" onClick={() => openProduct(product.id)} className="tpl-open pw-name text-start">
                        {product.name}
                      </button>
                      <Description product={product} lines={1} className="pw-desc" />
                      <Badges product={product} className="pw-badges" />
                    </div>
                    <Price product={product} className="pw-price" />
                    <QuickAction product={product} variant="icon" className="pw-add relative z-[2]" onAdded={tighten} />
                  </li>
                ))}
              </ul>
              <div aria-hidden className="pw-knot">
                <i className="pw-tie" />
                <span className="pw-fringe">
                  {knotFringe(place).map((length, at) => (
                    <i key={at} style={{ '--len': `${length}rem`, '--dl': `${-(at % 3) * 0.6}s` } as CSSProperties} />
                  ))}
                </span>
              </div>
            </section>
          );
        })}
      </main>
    </div>
  );
}
