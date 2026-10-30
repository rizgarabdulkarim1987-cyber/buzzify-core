'use client';

import { useRef, type CSSProperties } from 'react';
import type { MenuProductView } from '@/server/data/menu-view';
import { formatCount } from '@/server/domain/money';
import { useApp } from '@/ui/AppProviders';
import { useTemplate } from '../context';
import { Badges, Price, ProductMedia, QuickAction } from '../parts';
import { SectionStrip, ShapeHeading } from './shared/SectionStrip';
import { useOnceInView } from './shared/useOnceInView';
import { usePlaceOf } from './shared/usePlaceOf';
import { useSpineHold, useSpineWatch } from './useSpineMotion';
import './shared/photo-card.css';
import './shared/shapes.css';
import './andalus.css';

/**
 * The dish a section's reflecting pool mirrors: the first the restaurant singles out (featured, then signature, then
 * most ordered), else the section's first. Null for an empty section (a search left nothing), which draws no pool.
 */
export function andalusMirror<T extends Pick<MenuProductView, 'featured' | 'isSignature' | 'mostOrdered'>>(products: readonly T[]): T | null {
  return (
    products.find((product) => product.featured) ??
    products.find((product) => product.isSignature) ??
    products.find((product) => product.mostOrdered) ??
    products[0] ??
    null
  );
}

/** A section's zellige star: neighbours turn opposite ways, each at its own slow pace (seconds per turn). */
export function andalusStar(place: number): { turn: 1 | -1; time: number } {
  const at = Math.max(0, place);
  return { turn: at % 2 === 0 ? 1 : -1, time: 16 + (at % 3) * 4 };
}

/**
 * Andalusia (kind `andalus`, الأندلس): a court of the Alhambra. A sticky strip of arch-topped tabs under a zellige
 * band; each section is a court: its heading crowned with a turning eight-point zellige star, its dishes standing in an
 * arcade of horseshoe arches two to a row (photo under the arch, name, price and add below), and at its foot a long
 * reflecting pool between zellige borders, mirroring the section's chosen dish, with fountain rings spreading. All the
 * dishes are on the page; the star, the water and the rings move only while their court is on screen, stop under a
 * finger, and stop with less motion (the arches rise in once, the first time seen).
 */
export function AndalusBody() {
  const { locale, tenant } = useApp();
  const { categories, byCategory, reduced, openProduct } = useTemplate();
  const n = (value: number) => formatCount(value, locale, tenant.numeralSystem);
  const placeOf = usePlaceOf();
  const root = useRef<HTMLDivElement>(null);

  useOnceInView(root, reduced, { item: 'data-step', id: 'data-step', mark: 'data-in' });
  useSpineWatch(root, !reduced, '.an-section', 'data-live');
  useSpineHold(root, !reduced);

  const added = (button: HTMLButtonElement) => {
    if (reduced) return;
    button
      .closest('[data-row]')
      ?.querySelector('[data-photo]')
      ?.animate([{ scale: '1' }, { scale: '1.06' }, { scale: '1' }], { duration: 380, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' });
  };

  return (
    <div ref={root} className="tpl-body" data-body="andalus" data-still={reduced ? '' : undefined}>
      <SectionStrip marker="courts" prefix="an" lead={<i aria-hidden className="an-zel an-zel-top" />}>
        {(category) => <span>{category.name}</span>}
      </SectionStrip>
      <main id="menu" className="min-w-0 an-main">
        {categories.map((category, index) => {
          const products = byCategory.get(category.id) ?? [];
          const place = placeOf(category);
          const star = andalusStar(place);
          const mirror = andalusMirror(products);
          return (
            <section key={category.id} id={`cat-${category.slug}`} aria-labelledby={`h-${category.slug}`} className="tpl-section tpl-tall-last an-section">
              <ShapeHeading
                id={`h-${category.slug}`}
                name={category.name}
                count={n(products.length)}
                className="an-head"
                title="an-title"
                lead={<i aria-hidden className="an-star" style={{ '--turn': star.turn, '--t': `${star.time}s` } as CSSProperties} />}
              />
              <ul className="an-arcade">
                {products.map((product, at) => (
                  <li key={product.id} data-row data-step={product.id} className="an-arch" style={{ '--i': at % 2 } as CSSProperties}>
                    <div data-photo className="an-photo tpl-plate">
                      <ProductMedia product={product} suffix="andalus" sizes="(min-width: 640px) 220px, 45vw" priority={index === 0 && at < 4} rounded={false} className="an-img" />
                      <Badges product={product} className="an-badges" />
                    </div>
                    <button type="button" onClick={() => openProduct(product.id)} className="tpl-open an-name">
                      {product.name}
                    </button>
                    <span className="an-meta">
                      <Price product={product} className="an-price" />
                      <QuickAction product={product} variant="icon" className="an-add relative z-[2]" onAdded={added} />
                    </span>
                  </li>
                ))}
              </ul>
              {mirror ? (
                <div aria-hidden className="an-pool">
                  <i className="an-zel" />
                  <div className="an-water">
                    <div className="an-refl">
                      <ProductMedia product={mirror} suffix="andalus-pool" sizes="(min-width: 640px) 600px, 100vw" rounded={false} dim={false} className="an-refl-img" />
                    </div>
                    <i className="an-ring" />
                    <i className="an-ring" />
                    <i className="an-ring" />
                  </div>
                  <i className="an-zel" />
                </div>
              ) : null}
            </section>
          );
        })}
      </main>
    </div>
  );
}
