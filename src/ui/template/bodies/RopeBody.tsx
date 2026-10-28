'use client';

import { useRef, type CSSProperties } from 'react';
import { formatCount } from '@/server/domain/money';
import { useApp } from '@/ui/AppProviders';
import { useTemplate } from '../context';
import { Badges, Description, Price, ProductMedia, QuickAction } from '../parts';
import { SectionStrip, ShapeHeading } from './shared/SectionStrip';
import { hueAt, SHAPE_HUES } from './shared/hue';
import { usePlaceOf } from './shared/usePlaceOf';
import { swayOf, useSwayLive } from './swing-sway';
import './shared/photo-card.css';
import './shared/shapes.css';
import './rope.css';
import './rope-cable.css';
import './rope-kiosk.css';
import './rope-arcade.css';

export const ROPE_MOTIFS = ['cable', 'kiosk', 'arcade'] as const;
export type RopeMotif = (typeof ROPE_MOTIFS)[number];

const EASE = 'cubic-bezier(0.23, 1, 0.32, 1)';

/**
 * The line family (spec 2026-10-28-menu-styles-77-addendum.md, family `rope`): every section is one horizontal line
 * (a mountain cable, a kiosk's rope, a khan's arcade) that scrolls sideways by hand, its dishes hung from it, several in
 * view at once; the sections are stacked down the page. The motif draws the line and what hangs: cable-car cabins with
 * the photo in their window (`cable`), whole newspapers pegged on a rope whose masthead is the restaurant's name and
 * whose headline is the dish (`kiosk`), or pointed stone arches, each with a copper lantern (`arcade`). The hung pieces
 * sway in CSS on the sections on screen only, never while a finger is on the line, and not with reduced motion. Adding
 * a dish rocks its cabin, flips its paper, or lights its lantern.
 */
export function RopeBody({ motif }: { motif: RopeMotif }) {
  const { locale, tenant } = useApp();
  const { categories, byCategory, reduced, openProduct } = useTemplate();
  const n = (value: number) => formatCount(value, locale, tenant.numeralSystem);
  const placeOf = usePlaceOf();
  const root = useRef<HTMLDivElement>(null);
  useSwayLive(root, reduced);

  const added = (button: HTMLButtonElement) => {
    const row = button.closest<HTMLElement>('[data-row]');
    if (!row) return;
    // The lantern stays lit once its dish is ordered: a state, not a motion, so it lights with reduced motion too.
    if (motif === 'arcade') row.setAttribute('data-lit', '');
    if (reduced) return;
    if (motif === 'cable') {
      row
        .querySelector('[data-swing]')
        ?.animate([{ rotate: '0deg' }, { rotate: '7deg' }, { rotate: '-5deg' }, { rotate: '2deg' }, { rotate: '0deg' }], { duration: 800, easing: EASE });
    } else if (motif === 'kiosk') {
      row
        .querySelector('[data-paper]')
        ?.animate([{ transform: 'perspective(600px) rotateY(0deg)' }, { transform: 'perspective(600px) rotateY(360deg)' }], { duration: 700, easing: EASE });
    } else {
      row
        .querySelector('[data-lamp]')
        ?.animate([{ scale: '1', filter: 'brightness(1)' }, { scale: '1.35', filter: 'brightness(1.6)', offset: 0.35 }, { scale: '1', filter: 'brightness(1)' }], {
          duration: 600,
          easing: EASE,
        });
    }
  };

  return (
    <div ref={root} className="tpl-body rp-body" data-body={motif} data-still={reduced ? '' : undefined}>
      <SectionStrip marker="lines" prefix="rp">
        {(category) => (
          <>
            <i aria-hidden className="rp-chip-mark" />
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
              data-sway
              className="tpl-section tpl-tall-last rp-section"
              style={{ '--rp-hue': hueAt(SHAPE_HUES, place) } as CSSProperties}
            >
              <ShapeHeading
                id={`h-${category.slug}`}
                name={category.name}
                label={n(place + 1)}
                count={n(products.length)}
                className="rp-head"
                title="rp-title"
                lead={<i aria-hidden className="rp-mark" />}
              />
              <div className="rp-line">
                <ul className="scroll-hidden rp-row">
                  {products.map((product, at) => {
                    const sway = swayOf(product.id);
                    const style = { '--rp-t': `${sway.period}s`, '--rp-d': `${sway.delay}s`, '--rp-a': `${sway.angle}deg` } as CSSProperties;
                    const first = index === 0 && at < 4;
                    return (
                      <li key={product.id} data-row className="rp-item" style={style}>
                        {motif === 'arcade' ? <i aria-hidden data-lamp data-swing className="rp-lamp" /> : null}
                        {motif === 'kiosk' ? <i aria-hidden className="rp-peg" /> : null}
                        <div data-swing={motif === 'arcade' ? undefined : ''} className="rp-hang">
                          <div data-paper className="rp-piece">
                            {motif === 'kiosk' ? (
                              <p aria-hidden className="rp-mast tpl-display">
                                {tenant.logoText}
                              </p>
                            ) : null}
                            {motif === 'kiosk' ? (
                              <button type="button" onClick={() => openProduct(product.id)} className="tpl-open rp-name tpl-display text-start">
                                {product.name}
                              </button>
                            ) : null}
                            <div data-photo className="rp-win tpl-plate">
                              <ProductMedia product={product} suffix="rope" sizes="(min-width: 640px) 220px, 46vw" priority={first} rounded={false} className="rp-img" />
                            </div>
                            {motif === 'kiosk' ? null : (
                              <button type="button" onClick={() => openProduct(product.id)} className="tpl-open rp-name text-start">
                                {product.name}
                              </button>
                            )}
                            {motif === 'kiosk' ? <Description product={product} lines={2} className="rp-desc" /> : null}
                            <span className="rp-meta">
                              <Price product={product} className="rp-price" />
                              <QuickAction product={product} variant="icon" className="rp-add relative z-[2]" onAdded={added} />
                            </span>
                            <Badges product={product} className="rp-badges" />
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </section>
          );
        })}
      </main>
    </div>
  );
}

/** The Cable Car: each section a mountain cable line, each dish a cabin hanging from it with its photo in the window. */
export function CableBody() {
  return <RopeBody motif="cable" />;
}

/** The Newspaper Kiosk: each section a rope of pegged newspapers, each dish a paper under the restaurant's masthead. */
export function KioskBody() {
  return <RopeBody motif="kiosk" />;
}

/** The Khan Arcade: each section a corridor of pointed stone arches, each dish under an arch with a copper lantern. */
export function ArcadeBody() {
  return <RopeBody motif="arcade" />;
}
