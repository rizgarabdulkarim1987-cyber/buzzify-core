'use client';

import { useEffect, useRef, type CSSProperties, type RefObject } from 'react';
import type { MenuProductView } from '@/server/data/menu-view';
import { formatCount } from '@/server/domain/money';
import { useApp } from '@/ui/AppProviders';
import { useTemplate } from '../context';
import { Badges, Price, ProductMedia, QuickAction } from '../parts';
import { hueAt, SHAPE_HUES } from './shared/hue';
import { SectionStrip, ShapeHeading } from './shared/SectionStrip';
import { usePlaceOf } from './shared/usePlaceOf';
import { useSpineHold, useSpineWatch } from './useSpineMotion';
import './shared/photo-card.css';
import './shared/shapes.css';
import './isle.css';
import './space-isle.css';
import './flying-carpet.css';

/** The styles of the isle family (each section a block floating on the page); each is its own body kind. */
export const ISLE_MOTIFS = ['space-isle', 'flying-carpet'] as const;
export type IsleMotif = (typeof ISLE_MOTIFS)[number];

/** How far in from the start each island sits (percent of the page), turn about near the start and near the end. */
const OFFSETS = [1, 5, 0, 6, 2, 4] as const;
export function isleOffset(place: number): number {
  return OFFSETS[((place % OFFSETS.length) + OFFSETS.length) % OFFSETS.length]!;
}

/** A steady pseudo-random number in [0, 1) for a seed: the same island always floats the same way. */
export function isleNoise(seed: number): number {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

/** An island's float: its period (s), its phase (s, negative: already moving) and its tilt (deg, turn about), so no two move together. */
export function isleSway(place: number): { time: number; delay: number; tilt: number } {
  return {
    time: Number((5 + isleNoise(place + 40) * 3).toFixed(2)),
    delay: -Number((isleNoise(place + 47) * 6).toFixed(2)),
    tilt: place % 2 === 0 ? -1.2 : 1.2,
  };
}

/** The space islands' parallax: how far (px) an island lags the scroll, from its centre's distance to the screen's middle, capped. */
export function isleDrift(fromMiddle: number, factor = 0.05, cap = 24): number {
  const shift = -fromMiddle * factor;
  return Math.round(Math.max(-cap, Math.min(cap, shift)) * 10) / 10 + 0;
}

/**
 * The space islands' slow parallax (sp-isle's `parallax(-0.05)`): every island on screen (`data-live`) lags the scroll a
 * little by its distance from the screen's middle, written as `--is-drift` once a frame while the page moves.
 */
function useIsleDrift(root: RefObject<HTMLElement | null>, active: boolean) {
  useEffect(() => {
    const host = root.current;
    if (!host || !active) return;
    let frame = 0;
    const run = () => {
      frame = 0;
      const middle = window.innerHeight / 2;
      const islands = [...host.querySelectorAll<HTMLElement>('.is-section[data-live]')];
      const shifts = islands.map((node) => {
        const box = node.getBoundingClientRect();
        return isleDrift(box.top + box.height / 2 - middle);
      });
      islands.forEach((node, at) => node.style.setProperty('--is-drift', `${shifts[at]}px`));
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
      host.querySelectorAll<HTMLElement>('.is-section').forEach((node) => node.style.removeProperty('--is-drift'));
    };
  }, [root, active]);
}

/**
 * The isle family (spec 2026-10-28-menu-styles-77-addendum.md): every section a block floating on the page, set in a
 * little from the start or the end by turns, bobbing gently on its own clock; its dishes three across on it. Each motif
 * is its own body kind with its own drawing (the CSS under `[data-body='<motif>']`):
 *
 * - `space-isle`, The Floating Islands: deep space, every section a glass deck on a rock island with crystals in the
 *   section's hue under it and pebbles round it; the islands lag the scroll a little (buzzify.me's look only).
 * - `flying-carpet`, The Flying Carpet: an Arabian night with a crescent, every section a patterned flying carpet with
 *   tassel fringes that flutter, round photos three per row; each carpet floats and sways in its own rhythm.
 *
 * Every colour comes from the template's tokens (the section hue of the islands is decoration only). The motion runs only
 * on screen (`data-live`), stops while a finger is down (`data-hold`) and is off with less motion. All sections are on
 * the page, so the template's own jump and `#cat-<slug>` scrolling reach them.
 */
export function IsleFamily({ motif }: { motif: IsleMotif }) {
  const { locale, tenant } = useApp();
  const { categories, byCategory, reduced } = useTemplate();
  const n = (value: number) => formatCount(value, locale, tenant.numeralSystem);
  const two = (value: number) => (value < 10 ? n(0) : '') + n(value);
  const placeOf = usePlaceOf();
  const root = useRef<HTMLDivElement>(null);
  const space = motif === 'space-isle';

  useSpineWatch(root, !reduced, '.is-section', 'data-live');
  useSpineHold(root, !reduced);
  useIsleDrift(root, !reduced && space);

  const added = (button: HTMLButtonElement) => {
    if (reduced) return;
    const cell = button.closest('[data-row]');
    const target = space ? cell : cell?.querySelector('[data-photo]');
    target?.animate([{ scale: '1' }, { scale: space ? '1.05' : '1.12' }, { scale: '1' }], { duration: 360, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' });
  };
  const hue = (place: number) => (space ? ({ '--h': hueAt(SHAPE_HUES, place) } as CSSProperties) : undefined);

  return (
    <div ref={root} className="tpl-body" data-body={motif}>
      <SectionStrip marker={space ? 'islands' : 'carpets'} prefix="is" chipStyle={space ? (category) => hue(placeOf(category)) : undefined}>
        {(category) => (
          <>
            <i aria-hidden className="is-chip-mark" />
            <span>{category.name}</span>
          </>
        )}
      </SectionStrip>
      <main id="menu" className="min-w-0 is-main">
        {space ? null : <i aria-hidden className="is-moon" />}
        {categories.map((category, index) => {
          const products = byCategory.get(category.id) ?? [];
          const place = placeOf(category);
          const sway = isleSway(place);
          return (
            <section
              key={category.id}
              id={`cat-${category.slug}`}
              aria-labelledby={`h-${category.slug}`}
              className="tpl-section tpl-tall-last is-section"
              style={{ ...hue(place), '--o': `${isleOffset(place)}%`, '--t': `${sway.time}s`, '--dl': `${sway.delay}s`, '--r': `${sway.tilt}deg` } as CSSProperties}
            >
              <div className="is-drift">
                <div className="is-float">
                  {space ? null : <i aria-hidden className="is-fringe is-fringe-top" />}
                  <div className="is-deck">
                    <ShapeHeading
                      id={`h-${category.slug}`}
                      name={category.name}
                      label={space ? two(place + 1) : undefined}
                      count={n(products.length)}
                      className="is-head"
                      title="is-title"
                      lead={space ? null : <i aria-hidden className="is-star" />}
                    />
                    <ul className="is-grid">
                      {products.map((product, at) => (
                        <IsleDish key={product.id} product={product} motif={motif} priority={index === 0 && at < 6} onAdded={added} />
                      ))}
                    </ul>
                  </div>
                  {space ? (
                    <>
                      <div aria-hidden className="is-rock">
                        <i className="is-crystal" />
                        <i className="is-crystal" />
                        <i className="is-crystal" />
                      </div>
                      <i aria-hidden className="is-pebble" style={{ '--w': `${10 + Math.round(isleNoise(place + 3) * 8)}px`, '--x': '-0.5rem', '--y': '72%' } as CSSProperties} />
                      <i aria-hidden className="is-pebble" style={{ '--w': `${7 + Math.round(isleNoise(place + 5) * 6)}px`, '--x': '96%', '--y': '86%' } as CSSProperties} />
                      <i aria-hidden className="is-pebble" style={{ '--w': '6px', '--x': '12%', '--y': '97%' } as CSSProperties} />
                    </>
                  ) : (
                    <i aria-hidden className="is-fringe is-fringe-end" />
                  )}
                </div>
              </div>
            </section>
          );
        })}
      </main>
    </div>
  );
}

/** A dish on an island or a carpet: the photo, the name (the whole cell opens it), the price with its badges, the add. */
function IsleDish({ product, motif, priority, onAdded }: { product: MenuProductView; motif: IsleMotif; priority: boolean; onAdded: (button: HTMLButtonElement) => void }) {
  const { openProduct } = useTemplate();
  return (
    <li data-row className="is-dish">
      <div data-photo className="is-photo tpl-cover-media tpl-plate">
        <ProductMedia product={product} suffix={motif} sizes="(min-width: 640px) 160px, 30vw" priority={priority} className="is-img" rounded={false} />
      </div>
      <button type="button" onClick={() => openProduct(product.id)} className="tpl-open tpl-dish-name is-name">
        {product.name}
      </button>
      <Price product={product} className="is-price" />
      <Badges product={product} className="is-badges" />
      <QuickAction product={product} variant="icon" className="is-add relative z-[2]" onAdded={onAdded} />
    </li>
  );
}

/** The Floating Islands (kind `space-isle`). */
export function SpaceIsleBody() {
  return <IsleFamily motif="space-isle" />;
}
/** The Flying Carpet (kind `flying-carpet`). */
export function FlyingCarpetBody() {
  return <IsleFamily motif="flying-carpet" />;
}
