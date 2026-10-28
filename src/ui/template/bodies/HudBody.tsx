'use client';

import { useRef } from 'react';
import { localDigits } from '@/lib/digits';
import { formatCount } from '@/server/domain/money';
import { useApp } from '@/ui/AppProviders';
import { useTemplate } from '../context';
import { Badges, Price, ProductMedia, QuickAction } from '../parts';
import { targetCode } from './signature-25';
import { SectionStrip, ShapeHeading } from './shared/SectionStrip';
import { useOnceInView } from './shared/useOnceInView';
import { usePlaceOf } from './shared/usePlaceOf';
import { useSpineHold, useSpineWatch } from './useSpineMotion';
import './shared/photo-card.css';
import './shared/shapes.css';
import './hud.css';

/**
 * The Fighter Radar (kind `hud`, mockup signature-2 `hud`): a fighter pilot's targeting screen. Each section is a
 * sector with a small radar sweeping by its name and a scan line passing down behind its dishes; the dishes stand two
 * by two, each photo inside four targeting brackets with a crosshair and its target code. The brackets close in on a
 * dish the first time it comes into view (it "locks on"), and turn to the lock colour when the dish is added.
 *
 * Sweep and scan run only while the sector is on screen (`data-live`), stop while a finger is down (`data-hold`) and
 * are off with less motion. All sections are on the page, so the template's jump and `#cat-<slug>` reach them.
 */
export function HudBody() {
  const { locale, tenant } = useApp();
  const { categories, byCategory, reduced, openProduct } = useTemplate();
  const n = (value: number) => formatCount(value, locale, tenant.numeralSystem);
  const two = (value: number) => (value < 10 ? n(0) : '') + n(value);
  const placeOf = usePlaceOf();
  const root = useRef<HTMLDivElement>(null);

  useOnceInView(root, reduced, { item: 'data-target', id: 'data-target', mark: 'data-in' });
  useSpineWatch(root, !reduced, '.hd-section', 'data-live');
  useSpineHold(root, !reduced);

  /** Added: the brackets lock on the dish in the lock colour (and stay so, as on the pilot's screen). */
  const lock = (button: HTMLButtonElement) => {
    const target = button.closest<HTMLElement>('[data-target]');
    if (!target) return;
    target.setAttribute('data-locked', '');
    if (reduced) return;
    target
      .querySelector('.hd-reticle')
      ?.animate([{ scale: '1.18' }, { scale: '0.94' }, { scale: '1' }], { duration: 360, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' });
  };

  return (
    <div ref={root} className="tpl-body" data-body="hud">
      <SectionStrip marker="sectors" prefix="hd">
        {(category) => (
          <>
            <small aria-hidden dir="ltr" className="hd-chip-code">
              S-{two(placeOf(category) + 1)}
            </small>
            <span>{category.name}</span>
          </>
        )}
      </SectionStrip>
      <main id="menu" className="min-w-0 hd-main">
        {categories.map((category, index) => {
          const products = byCategory.get(category.id) ?? [];
          const place = placeOf(category);
          return (
            <section key={category.id} id={`cat-${category.slug}`} aria-labelledby={`h-${category.slug}`} className="tpl-section tpl-tall-last hd-section">
              <span aria-hidden className="hd-scan">
                <i />
              </span>
              <ShapeHeading
                id={`h-${category.slug}`}
                name={category.name}
                label={`S-${two(place + 1)}`}
                count={n(products.length)}
                className="hd-head"
                title="hd-title"
                lead={<i aria-hidden className="hd-radar" />}
              />
              <ul className="hd-grid">
                {products.map((product, at) => (
                  <li key={product.id} data-row data-target={product.id} className="hd-target">
                    <div data-photo className="hd-frame tpl-plate">
                      <ProductMedia product={product} suffix="hud" sizes="(min-width: 640px) 220px, 46vw" priority={index === 0 && at < 4} rounded={false} className="hd-img" />
                      <span aria-hidden className="hd-reticle">
                        <i />
                        <i />
                        <i />
                        <i />
                      </span>
                      <span aria-hidden dir="ltr" className="hd-code">
                        TGT-{localDigits(targetCode(place, at), tenant.numeralSystem)}
                      </span>
                      <Badges product={product} className="hd-badges" />
                    </div>
                    <button type="button" onClick={() => openProduct(product.id)} className="tpl-open hd-name text-start">
                      {product.name}
                    </button>
                    <span className="hd-meta">
                      <Price product={product} className="hd-price" />
                      <QuickAction product={product} variant="icon" className="hd-add relative z-[2]" onAdded={lock} />
                    </span>
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
