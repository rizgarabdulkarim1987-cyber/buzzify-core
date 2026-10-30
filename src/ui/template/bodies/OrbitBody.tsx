'use client';

import { useRef, type CSSProperties, type ReactNode } from 'react';
import { formatCount } from '@/server/domain/money';
import { useApp } from '@/ui/AppProviders';
import { useTemplate } from '../context';
import { Badges, Price, ProductMedia, QuickAction } from '../parts';
import { hueAt, SHAPE_HUES } from './shared/hue';
import { RowDish } from './shared/RowDish';
import { SectionStrip, ShapeHeading } from './shared/SectionStrip';
import { usePlaceOf } from './shared/usePlaceOf';
import { orbitPlace, orbitSize, orbitSplit } from './orbit-rings';
import { useSpineHold, useSpineWatch } from './useSpineMotion';
import './shared/photo-card.css';
import './shared/rows.css';
import './shared/shapes.css';
import './orbit.css';
import './space-orbit.css';
import './tannour.css';
import './daf.css';

/** The styles of the orbit family (dishes on a ring round each section's centre); each is its own body kind. */
export const ORBIT_MOTIFS = ['space-orbit', 'tannour', 'daf'] as const;
export type OrbitMotif = (typeof ORBIT_MOTIFS)[number];

/** The metal rings round the daf's rim. */
const DAF_JINGLES = 16;

const MARKERS: Record<OrbitMotif, string> = { 'space-orbit': 'planets', tannour: 'ovens', daf: 'drums' };

/**
 * The orbit family (spec 2026-10-28-menu-styles-77-addendum.md): every section is a circle, its name and dish count in
 * the centre, its dishes on one ring round it (at most `ORBIT_CAP`; the rest continue as a compact list under the
 * circle, so every dish is always on the page and tappable). The ring turns very slowly in CSS, the photos staying
 * upright; it stops while a finger, the pointer or the focus is on it, off screen, and with less motion.
 *
 * - `space-orbit`, The Solar System: a glowing planet in the section's hue, the dishes moons on a dotted orbit.
 * - `tannour`, The Tannour: a clay oven seen from above, the fire in the middle, the dishes stuck to its wall like bread.
 * - `daf`, The Daf: a Kurdish frame drum, its skin, wooden frame and metal rings; the dishes turn inside it.
 */
export function OrbitFamily({ motif }: { motif: OrbitMotif }) {
  const { locale, tenant } = useApp();
  const { categories, byCategory, reduced, openProduct } = useTemplate();
  const n = (value: number) => formatCount(value, locale, tenant.numeralSystem);
  const placeOf = usePlaceOf();
  const root = useRef<HTMLDivElement>(null);
  const hued = motif === 'space-orbit';

  useSpineWatch(root, !reduced, '.ob-system', 'data-live');
  useSpineHold(root, !reduced);

  const added = (button: HTMLButtonElement) => {
    if (reduced) return;
    const photo = button.closest('[data-row]')?.querySelector<HTMLElement>('[data-photo]');
    if (motif === 'space-orbit') {
      photo?.animate([{ scale: '1' }, { scale: '1.18' }, { scale: '1' }], { duration: 380, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' });
      return;
    }
    if (motif === 'tannour') {
      photo?.animate(
        [
          { filter: 'brightness(1)', boxShadow: '0 0 0 0 transparent' },
          { filter: 'brightness(1.35) sepia(0.35)', boxShadow: '0 0 1.5rem 0.4rem rgb(255 150 50 / 0.75)' },
          { filter: 'brightness(1)', boxShadow: '0 0 0 0 transparent' },
        ],
        { duration: 560, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' },
      );
      return;
    }
    // The daf: the drum shivers and its rings ring.
    const drum = button.closest('.ob-orbit');
    drum?.animate([{ rotate: '0deg' }, { rotate: '-3deg' }, { rotate: '2.5deg' }, { rotate: '-1.5deg' }, { rotate: '0deg' }], { duration: 420, easing: 'linear' });
    drum?.querySelectorAll('.df-jingle').forEach((jingle, at) =>
      jingle.animate([{ translate: '0 0' }, { translate: '0 -3px' }, { translate: '0 2px' }, { translate: '0 0' }], { duration: 260, delay: (at % 4) * 30, iterations: 2 }),
    );
  };

  const decor = (): ReactNode => {
    if (motif === 'tannour')
      return (
        <span aria-hidden className="tn-oven">
          <i className="tn-wall" />
          <i className="tn-fire" />
          <i className="tn-glow" />
        </span>
      );
    if (motif === 'daf')
      return (
        <span aria-hidden className="df-drum">
          <i className="df-skin" />
          {Array.from({ length: DAF_JINGLES }, (_, at) => {
            const spot = orbitPlace(at, DAF_JINGLES, 52);
            return <i key={at} className="df-jingle" style={{ '--x': spot.x, '--y': spot.y } as CSSProperties} />;
          })}
        </span>
      );
    return (
      <span aria-hidden className="so-sky">
        <i className="so-path" />
        <i className="so-planet" />
      </span>
    );
  };

  return (
    <div ref={root} className="tpl-body" data-body={motif} data-still={reduced ? '' : undefined}>
      <SectionStrip marker={MARKERS[motif]} prefix="ob" chipStyle={hued ? (category) => ({ '--g': hueAt(SHAPE_HUES, placeOf(category)) }) as CSSProperties : undefined}>
        {(category) => (
          <>
            <i aria-hidden className="ob-chip-mark" />
            <span>{category.name}</span>
          </>
        )}
      </SectionStrip>
      <main id="menu" className="min-w-0 ob-main">
        {categories.map((category, index) => {
          const products = byCategory.get(category.id) ?? [];
          const split = orbitSplit(products.length);
          const ring = products.slice(0, split.ring);
          const rest = products.slice(split.ring);
          const place = placeOf(category);
          return (
            <section
              key={category.id}
              id={`cat-${category.slug}`}
              aria-labelledby={`h-${category.slug}`}
              className="tpl-section tpl-tall-last ob-section"
              style={hued ? ({ '--g': hueAt(SHAPE_HUES, place) } as CSSProperties) : undefined}
            >
              <div className="ob-system">
                <div className="ob-orbit" style={{ '--s': orbitSize(ring.length) } as CSSProperties}>
                  {decor()}
                  <ShapeHeading id={`h-${category.slug}`} name={category.name} count={n(products.length)} className="ob-core" title="ob-title" />
                  <ul className="ob-ring">
                    {ring.map((product, at) => {
                      const spot = orbitPlace(at, ring.length);
                      return (
                        <li key={product.id} data-row className="ob-slot" style={{ '--x': spot.x, '--y': spot.y } as CSSProperties}>
                          <div className="ob-moon">
                            <div data-photo className="ob-photo tpl-plate">
                              <ProductMedia product={product} suffix={motif} sizes="96px" priority={index === 0 && at < 4} rounded={false} className="ob-img" />
                            </div>
                            <Badges product={product} className="ob-badges" />
                            <QuickAction product={product} variant="icon" className="tpl-rim-add ob-add z-[2]" onAdded={added} />
                            <div className="ob-words">
                              <button type="button" onClick={() => openProduct(product.id)} className="tpl-open ob-name">
                                {product.name}
                              </button>
                              <Price product={product} className="tpl-price-tight ob-price" />
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </div>
              {rest.length > 0 ? (
                <ul className="ob-rest">
                  {rest.map((product) => (
                    <RowDish key={product.id} product={product} prefix="obr" suffix={`${motif}-row`} sizes="56px" priority={false} plate />
                  ))}
                </ul>
              ) : null}
            </section>
          );
        })}
      </main>
    </div>
  );
}

/** The Solar System (kind `space-orbit`). */
export function SpaceOrbitBody() {
  return <OrbitFamily motif="space-orbit" />;
}
/** The Tannour (kind `tannour`). */
export function TannourBody() {
  return <OrbitFamily motif="tannour" />;
}
/** The Daf (kind `daf`). */
export function DafBody() {
  return <OrbitFamily motif="daf" />;
}
