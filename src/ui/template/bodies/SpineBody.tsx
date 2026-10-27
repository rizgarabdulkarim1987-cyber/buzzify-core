'use client';

import { formatCount } from '@/server/domain/money';
import { useApp } from '@/ui/AppProviders';
import { useTemplate } from '../context';
import { Badges, Price, ProductMedia, QuickAction } from '../parts';
import { SectionStrip, ShapeHeading } from './shared/SectionStrip';
import { usePlaceOf } from './shared/usePlaceOf';
import './shared/photo-card.css';
import './shared/shapes.css';
import './spine.css';

/** The side of the thread a dish's words sit on: the first dish of a section at the start, then turn about. */
export function spineSide(at: number): 'start' | 'end' {
  return at % 2 === 0 ? 'start' : 'end';
}

/**
 * The Prayer Beads (spec 2026-10-28-menu-styles-77-addendum.md, family `spine`). The menu is one long amber misbaha: a
 * single thread runs down the middle of the page and every dish is a round bead on it, its photo inside the amber, its
 * name, price and add button beside it, on alternate sides. Each section starts with the shahid, the long bead with a
 * tassel that carries the section's name and dish count. A sticky strip of small beads jumps to a section. Adding a
 * dish clicks its bead down the thread and back, like counting (none with reduced motion). All sections are on the page,
 * so the template's own jump and `#cat-<slug>` scrolling reach them.
 */
export function SpineBody() {
  const { locale, tenant } = useApp();
  const { categories, byCategory, reduced, openProduct } = useTemplate();
  const n = (value: number) => formatCount(value, locale, tenant.numeralSystem);
  const placeOf = usePlaceOf();

  const click = (button: HTMLButtonElement) => {
    if (reduced) return;
    button
      .closest('[data-row]')
      ?.querySelector('[data-photo]')
      ?.animate([{ transform: 'translateY(0)' }, { transform: 'translateY(0.6rem)' }, { transform: 'translateY(0)' }], { duration: 260, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' });
  };

  return (
    <div className="tpl-body" data-body="spine">
      <SectionStrip marker="beads" prefix="sn">
        {(category) => (
          <>
            <i aria-hidden className="sn-chip-bead" />
            <span>{category.name}</span>
          </>
        )}
      </SectionStrip>
      <main id="menu" className="min-w-0">
        {categories.map((category, index) => {
          const products = byCategory.get(category.id) ?? [];
          return (
            <section key={category.id} id={`cat-${category.slug}`} aria-labelledby={`h-${category.slug}`} className="tpl-section tpl-tall-last sn-section">
              <ShapeHeading
                id={`h-${category.slug}`}
                name={category.name}
                label={n(placeOf(category) + 1)}
                count={n(products.length)}
                className="sn-head"
                title="sn-title"
                lead={<i aria-hidden className="sn-shahid" />}
              />
              <ul className="sn-thread">
                {products.map((product, at) => (
                  <li key={product.id} data-row data-side={spineSide(at)} className="sn-bead">
                    <div data-photo className="sn-ball tpl-plate">
                      <ProductMedia product={product} suffix="spine" sizes="96px" priority={index === 0 && at < 6} className="sn-img" />
                    </div>
                    <div className="sn-text">
                      <button type="button" onClick={() => openProduct(product.id)} className="tpl-open sn-name text-start">
                        {product.name}
                      </button>
                      <span className="sn-meta">
                        <Price product={product} className="sn-price" />
                        <Badges product={product} className="sn-badges" />
                        <QuickAction product={product} variant="icon" className="sn-add relative z-[2]" onAdded={click} />
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
