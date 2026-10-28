'use client';

import { useRef, type CSSProperties } from 'react';
import { localDigits } from '@/lib/digits';
import { formatCount } from '@/server/domain/money';
import { useApp } from '@/ui/AppProviders';
import { useTemplate } from '../context';
import { Badges, Price, ProductMedia, QuickAction } from '../parts';
import { NEON_HUES, useLiveZones } from './coverflow-shared';
import { hueAt } from './shared/hue';
import { SectionStrip, ShapeHeading } from './shared/SectionStrip';
import { usePlaceOf } from './shared/usePlaceOf';
import './shared/photo-card.css';
import './shared/shapes.css';
import './pedestal.css';
import './space-lift.css';
import './space-holo.css';

export const PEDESTAL_MOTIFS = ['space-lift', 'space-holo'] as const;
export type PedestalMotif = (typeof PEDESTAL_MOTIFS)[number];

/** A steady pseudo-random number in [0, 1) from a seed: the same dish always gets the same clock. */
function noise(seed: number): number {
  const value = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return value - Math.floor(value);
}

/**
 * A floating card's own clock: how long one bob takes (5 to 8 seconds) and how far into it the card starts (0 to 6
 * seconds), so the cards of a grid never rise together.
 */
export function clockOf(seed: number): { period: number; offset: number } {
  return { period: Number((5 + noise(seed) * 3).toFixed(2)), offset: Number((noise(seed + 7) * 6).toFixed(2)) };
}

/**
 * The Pedestal family (spec 2026-10-28-menu-styles-77-addendum.md): every section a grid of cards (two on a phone,
 * three wider) floating above a light base, so a phone's first screen shows four dishes. The `motif` draws the style:
 *
 * - `space-lift` (Levitation): every card hovers over a glowing pad in its section's hue and bobs on its own clock; as
 *   it rises the pool of light under it shrinks and fades, as it sinks it grows.
 * - `space-holo` (Hologram): every card is a hologram over a small projector, lifted by a beam in the section's hue,
 *   with scan lines and a slight flicker (none with less motion).
 *
 * The floating stops while a finger is on a section and while it is off screen, and is off with less motion.
 */
export function PedestalBody({ motif }: { motif: PedestalMotif }) {
  const { locale, tenant } = useApp();
  const { categories, byCategory, reduced, openProduct } = useTemplate();
  const n = (value: number) => formatCount(value, locale, tenant.numeralSystem);
  const placeOf = usePlaceOf();
  const root = useRef<HTMLDivElement>(null);
  useLiveZones(root, reduced, categories);

  const added = (button: HTMLButtonElement) => {
    if (reduced) return;
    button
      .closest('[data-row]')
      ?.querySelector('[data-card]')
      ?.animate([{ scale: '1' }, { scale: '1.06' }, { scale: '1' }], { duration: 380, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' });
  };

  return (
    <div ref={root} className="tpl-body" data-body={motif} data-still={reduced ? '' : undefined}>
      <SectionStrip marker="pads" prefix="pd" chipStyle={(category) => ({ '--g': hueAt(NEON_HUES, placeOf(category)) }) as CSSProperties}>
        {(category) => (
          <>
            <i aria-hidden className="pd-chip-mark" />
            <span>{category.name}</span>
          </>
        )}
      </SectionStrip>
      <main id="menu" className="min-w-0">
        {categories.map((category, index) => {
          const products = byCategory.get(category.id) ?? [];
          const place = placeOf(category);
          return (
            <section
              key={category.id}
              id={`cat-${category.slug}`}
              aria-labelledby={`h-${category.slug}`}
              data-live-zone
              className="tpl-section tpl-tall-last pd-section"
              style={{ '--g': hueAt(NEON_HUES, place) } as CSSProperties}
            >
              <ShapeHeading
                id={`h-${category.slug}`}
                name={category.name}
                label={localDigits(String(place + 1).padStart(2, '0'), tenant.numeralSystem)}
                count={n(products.length)}
                className="pd-head"
                title="pd-title"
              />
              <ul className="pd-field">
                {products.map((product, at) => {
                  const clock = clockOf(place * 31 + at);
                  return (
                    <li key={product.id} data-row className="pd-spot" style={{ '--t': `${clock.period}s`, '--dl': `-${clock.offset}s` } as CSSProperties}>
                      <div data-card className="pd-card">
                        <div data-photo className="pd-photo tpl-plate">
                          <ProductMedia product={product} suffix={motif} sizes="(min-width: 640px) 240px, 46vw" priority={index === 0 && at < 4} rounded={false} className="pd-img" />
                          <Badges product={product} className="pd-badges" />
                        </div>
                        <button type="button" onClick={() => openProduct(product.id)} className="tpl-open pd-name">
                          {product.name}
                        </button>
                        <span className="pd-meta">
                          <Price product={product} className="pd-price" />
                          <QuickAction product={product} variant="icon" className="pd-add relative z-[2]" onAdded={added} />
                        </span>
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

export function SpaceLiftBody() {
  return <PedestalBody motif="space-lift" />;
}

export function SpaceHoloBody() {
  return <PedestalBody motif="space-holo" />;
}
