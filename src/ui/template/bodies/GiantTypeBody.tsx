'use client';

import { useRef, type CSSProperties } from 'react';
import { formatCount } from '@/server/domain/money';
import { useApp } from '@/ui/AppProviders';
import type { MenuProductView } from '@/server/data/menu-view';
import { useTemplate } from '../context';
import { Badges, Description, Price, ProductMedia, QuickAction } from '../parts';
import { SectionStrip, ShapeHeading } from './shared/SectionStrip';
import { usePlaceOf } from './shared/usePlaceOf';
import { bandSeconds, cssUrl, fillOf, giantSize, giantTone } from './signature-24';
import { useSpineHold, useSpineWatch } from './useSpineMotion';
import './shared/photo-card.css';
import './shared/shapes.css';
import './giant-type.css';

/**
 * Giant Type (kind `giant-type`, mockup `signature` / `type`): every section's name set in letters as large as the
 * screen allows, filled with the photo of one of its dishes, on a loud colour of its own (the accent turned round the
 * wheel). Under the name: the section's first dish as a wide card, the rest three to a row in thick-bordered cards with
 * a hard shadow that press flat under a finger; a band of the section's dish names runs along its foot.
 *
 * The name is sized from its length (`giantSize`) so it fits on one line, or wraps between whole words: its letters are
 * never split apart (Arabic stays joined). The band runs only while on screen, stops under a finger, and is still with
 * less motion.
 */
export function GiantTypeBody() {
  const { locale, tenant } = useApp();
  const { categories, byCategory, reduced, openProduct } = useTemplate();
  const n = (value: number) => formatCount(value, locale, tenant.numeralSystem);
  const placeOf = usePlaceOf();
  const root = useRef<HTMLDivElement>(null);

  useSpineWatch(root, !reduced, '.gt-band', 'data-live');
  useSpineHold(root, !reduced);

  const added = (button: HTMLButtonElement) => {
    if (reduced) return;
    button
      .closest('[data-it]')
      ?.animate([{ translate: '0 0' }, { translate: '0 -0.375rem' }, { translate: '0 0' }], { duration: 320, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' });
  };

  const card = (product: MenuProductView, big: boolean, priority: boolean) => (
    <li key={product.id} data-it className={big ? 'gt-it gt-big' : 'gt-it'}>
      <div data-photo className="gt-photo tpl-plate tpl-fill-media">
        <ProductMedia product={product} suffix="giant-type" sizes={big ? '(min-width: 640px) 240px, 34vw' : '(min-width: 640px) 200px, 30vw'} priority={priority} rounded={false} />
        {big ? null : <Badges product={product} className="gt-badges" />}
        {big ? null : <QuickAction product={product} variant="icon" className="gt-add tpl-rim-add z-[2]" onAdded={added} />}
      </div>
      <div className="gt-text">
        <button type="button" onClick={() => openProduct(product.id)} className="tpl-open gt-name text-start">
          {product.name}
        </button>
        {big ? <Description product={product} lines={2} className="gt-desc" /> : null}
        {big ? <Badges product={product} className="gt-big-badges" /> : null}
        <span className="gt-meta">
          <Price product={product} className={big ? 'gt-price' : 'gt-price tpl-price-tight'} />
          {big ? <QuickAction product={product} variant="label" className="gt-big-add relative z-[2]" onAdded={added} /> : null}
        </span>
      </div>
    </li>
  );

  return (
    <div ref={root} className="tpl-body" data-body="giant-type">
      <SectionStrip marker="letters" prefix="gt">
        {(category) => <span>{category.name}</span>}
      </SectionStrip>
      <main id="menu" className="min-w-0 gt-main">
        {categories.map((category, index) => {
          const products = byCategory.get(category.id) ?? [];
          const place = placeOf(category);
          const fill = fillOf(products);
          const style = {
            '--gt-size': `${giantSize(category.name)}cqi`,
            '--gt-fill': fill ? cssUrl(fill) : 'none',
            '--gt-dur': `${bandSeconds(products.length)}s`,
          } as CSSProperties;
          return (
            <section
              key={category.id}
              id={`cat-${category.slug}`}
              aria-labelledby={`h-${category.slug}`}
              data-tone={giantTone(place)}
              data-filled={fill ? '' : undefined}
              className="tpl-section tpl-tall-last gt-section"
              style={style}
            >
              <ShapeHeading id={`h-${category.slug}`} name={category.name} count={n(products.length)} className="gt-head" title="gt-title" />
              <ul className="gt-grid">{products.map((product, at) => card(product, at === 0, index === 0 && at < 4))}</ul>
              {products.length > 0 ? (
                <div aria-hidden className="gt-band">
                  <div className="gt-track">
                    {[0, 1].map((copy) => (
                      <span key={copy} className="gt-run">
                        {products.map((product) => (
                          <span key={product.id} className="gt-word">
                            {product.name}
                            <i>✦</i>
                          </span>
                        ))}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}
            </section>
          );
        })}
      </main>
    </div>
  );
}
