'use client';

import { useEffect, useRef, type CSSProperties, type RefObject } from 'react';
import { formatCount } from '@/server/domain/money';
import { useApp } from '@/ui/AppProviders';
import { useTemplate } from '../context';
import { Badges, Price, ProductMedia, QuickAction } from '../parts';
import { SectionStrip, ShapeHeading } from './shared/SectionStrip';
import { usePlaceOf } from './shared/usePlaceOf';
import { useSpineHold, useSpineWatch } from './useSpineMotion';
import './shared/photo-card.css';
import './shared/shapes.css';
import './shan.css';

/** A steady pseudo-random number in [0, 1) for a seed: the same window always sways the same way. */
export function shanNoise(seed: number): number {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

/** A window's sway: its period (s) and its phase (s, negative: already swaying), so neighbours never move together. */
export function shanSway(seed: number): { time: number; delay: number } {
  return { time: Number((5 + shanNoise(seed) * 3).toFixed(2)), delay: -Number((shanNoise(seed + 7) * 6).toFixed(2)) };
}

/**
 * How far down the house the page has come (0 at its top, 1 at its foot), from the house's top edge on the screen
 * (`top`, negative once scrolled past), its height and the screen's height. A house shorter than the screen is 0.
 */
export function railProgress(top: number, height: number, viewport: number): number {
  const run = height - viewport;
  if (run <= 0) return 0;
  return Math.max(0, Math.min(1, -top / run));
}

/**
 * The progress rail down the side: while the house is on the screen, its dot (`--p`, 0 to 1) follows how far down the
 * page has come, written once a frame while it moves; off the house the rail hides (`data-off`).
 */
function useShanRail(house: RefObject<HTMLElement | null>, rail: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const main = house.current;
    const line = rail.current;
    if (!main || !line) return;
    let frame = 0;
    const run = () => {
      frame = 0;
      const box = main.getBoundingClientRect();
      const shown = box.bottom > 0 && box.top < window.innerHeight;
      line.toggleAttribute('data-off', !shown);
      line.style.setProperty('--p', railProgress(box.top, box.height, window.innerHeight).toFixed(3));
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(run);
    };
    run();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [house, rail]);
}

/**
 * The Baghdadi house (kind `shan`, spec 2026-10-28-menu-styles-77-addendum.md): an old brick house of Baghdad, the
 * restaurant's name on a plaque under its cornice. Every section is a floor with a wooden bridge-beam carrying its name;
 * every dish is a wooden shanashil oriel window with a carved lattice over its photo, its name and price on the sill. The
 * oriels float and sway lightly (on screen only, never under a finger, never with less motion); a dish added lights its
 * lattice. A progress rail with a glowing dot runs down the side. Unlike the older `lattice` shape, every colour comes
 * from the template's tokens. All floors are on the page, so the template's jump and `#cat-<slug>` scrolling reach them.
 */
export function ShanBody() {
  const { locale, tenant } = useApp();
  const { categories, byCategory, reduced, openProduct } = useTemplate();
  const n = (value: number) => formatCount(value, locale, tenant.numeralSystem);
  const placeOf = usePlaceOf();
  const root = useRef<HTMLDivElement>(null);
  const house = useRef<HTMLElement>(null);
  const rail = useRef<HTMLDivElement>(null);

  useSpineWatch(root, !reduced, '.shn-floor', 'data-live');
  useSpineHold(root, !reduced);
  useShanRail(house, rail);

  const added = (button: HTMLButtonElement) => {
    const pane = button.closest<HTMLElement>('[data-row]');
    pane?.setAttribute('data-lit', '');
    if (reduced) return;
    pane
      ?.querySelector('[data-photo]')
      ?.animate([{ scale: '1' }, { scale: '1.06' }, { scale: '1' }], { duration: 360, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' });
  };

  return (
    <div ref={root} className="tpl-body" data-body="shan">
      <SectionStrip marker="floors" prefix="shn">
        {(category) => <span>{category.name}</span>}
      </SectionStrip>
      <main ref={house} id="menu" className="min-w-0 shn-main">
        <div aria-hidden className="shn-cornice">
          <span className="shn-plaque">{tenant.logoText}</span>
        </div>
        {categories.map((category, index) => {
          const products = byCategory.get(category.id) ?? [];
          const place = placeOf(category);
          return (
            <section key={category.id} id={`cat-${category.slug}`} aria-labelledby={`h-${category.slug}`} className="tpl-section tpl-tall-last shn-floor">
              <ShapeHeading id={`h-${category.slug}`} name={category.name} count={n(products.length)} className="shn-beam" title="shn-title" />
              <ul className="shn-wins">
                {products.map((product, at) => {
                  const sway = shanSway(place * 50 + at + 1);
                  return (
                    <li key={product.id} data-row className="shn-win" style={{ '--t': `${sway.time}s`, '--dl': `${sway.delay}s` } as CSSProperties}>
                      <div className="shn-oriel">
                        <i aria-hidden className="shn-lattice" />
                        <div data-photo className="shn-photo tpl-cover-media tpl-plate">
                          <ProductMedia product={product} suffix="shan" sizes="(min-width: 640px) 220px, 46vw" priority={index === 0 && at < 4} className="shn-img" rounded={false} />
                        </div>
                      </div>
                      <div className="shn-sill">
                        <button type="button" onClick={() => openProduct(product.id)} className="tpl-open shn-name text-start">
                          {product.name}
                        </button>
                        <span className="shn-meta">
                          <Price product={product} className="shn-price" />
                          <QuickAction product={product} variant="icon" className="shn-add relative z-[2]" onAdded={added} />
                        </span>
                        <Badges product={product} className="shn-badges" />
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </main>
      <div ref={rail} aria-hidden className="shn-rail" data-off="">
        <i />
      </div>
    </div>
  );
}
