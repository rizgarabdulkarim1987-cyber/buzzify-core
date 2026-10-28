'use client';

import { useRef, type CSSProperties } from 'react';
import { formatCount } from '@/server/domain/money';
import { useApp } from '@/ui/AppProviders';
import type { MenuProductView } from '@/server/data/menu-view';
import { useTemplate } from '../context';
import { Badges, Price, ProductMedia, QuickAction } from '../parts';
import { SectionStrip, ShapeHeading } from './shared/SectionStrip';
import { hueAt } from './shared/hue';
import { usePlaceOf } from './shared/usePlaceOf';
import { chainDrop, pegTilt, rowsOf, stringLength, swayOf, useSwayLive } from './swing-sway';
import './shared/photo-card.css';
import './shared/shapes.css';
import './swing.css';
import './swing-peg.css';
import './swing-kew.css';
import './swing-lira.css';
import './swing-balloon.css';

export const SWING_MOTIFS = ['peg', 'kew', 'lira', 'balloon'] as const;
export type SwingMotif = (typeof SWING_MOTIFS)[number];

/** Coins per gold chain: a chain droops in an arc, so its middle coin hangs lowest. */
const COINS_PER_CHAIN = 3;

/** The balloon bunches' hues: each section is a bunch of its own colour, mixed with the palette's accent (decoration only). */
const BALLOON_HUES = [340, 205, 48, 150, 265, 18] as const;

/** What a hung dish does when it is added: one harder swing (a peg card, a cage), a coin's turn, a balloon's rise. */
const ADDED: Record<SwingMotif, { keyframes: Keyframe[]; duration: number; target: string }> = {
  peg: { target: '[data-swing]', duration: 700, keyframes: [{ rotate: '0deg' }, { rotate: '-8deg' }, { rotate: '5deg' }, { rotate: '-2deg' }, { rotate: '0deg' }] },
  kew: { target: '[data-swing]', duration: 900, keyframes: [{ rotate: '0deg' }, { rotate: '14deg' }, { rotate: '-10deg' }, { rotate: '5deg' }, { rotate: '0deg' }] },
  lira: { target: '[data-photo]', duration: 700, keyframes: [{ transform: 'perspective(500px) rotateY(0deg)' }, { transform: 'perspective(500px) rotateY(360deg)' }] },
  balloon: {
    target: '[data-photo]',
    duration: 650,
    keyframes: [{ translate: '0 0', scale: '1' }, { translate: '0 -1.625rem', scale: '1.06', offset: 0.4 }, { translate: '0 0', scale: '1' }],
  },
};

/**
 * The hanging family (spec 2026-10-28-menu-styles-77-addendum.md, family `swing`): a grid of dishes (two or three across
 * on a phone), each hung from a string of its own length that sways gently from its hook. The motif draws what hangs:
 * a tilted card on a pegboard nail (`peg`), a wicker partridge cage on a branch (`kew`), a gold coin on a drooping chain
 * (`lira`), or a balloon tied to its price card (`balloon`). The sway is CSS (its pivot at the hook), runs only on the
 * sections on screen, stops while a finger is on it and under reduced motion; adding a dish swings it harder once. All
 * sections are on the page, so the template's jump and `#cat-<slug>` scrolling reach them.
 */
export function SwingBody({ motif }: { motif: SwingMotif }) {
  const { locale, tenant } = useApp();
  const { categories, byCategory, reduced, openProduct } = useTemplate();
  const n = (value: number) => formatCount(value, locale, tenant.numeralSystem);
  const placeOf = usePlaceOf();
  const root = useRef<HTMLDivElement>(null);
  useSwayLive(root, reduced);

  const added = (button: HTMLButtonElement) => {
    if (reduced) return;
    const { target, keyframes, duration } = ADDED[motif];
    button.closest('[data-row]')?.querySelector(target)?.animate(keyframes, { duration, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' });
  };

  const dish = (product: MenuProductView, at: number, column: number, count: number, first: boolean) => {
    const sway = swayOf(product.id);
    const style = {
      '--sw-rope': `${stringLength(at)}rem`,
      '--sw-tilt': motif === 'peg' ? `${pegTilt(at)}deg` : '0deg',
      '--sw-drop': chainDrop(column, count),
      '--sw-t': `${sway.period}s`,
      '--sw-d': `${sway.delay}s`,
      '--sw-a': `${sway.angle}deg`,
    } as CSSProperties;
    return (
      <li key={product.id} data-row className="sw-item" style={style}>
        <div data-swing className="sw-hang">
          <i aria-hidden className="sw-cord" />
          <div data-photo className="sw-frame tpl-plate">
            <ProductMedia product={product} suffix="swing" sizes="(min-width: 640px) 200px, 40vw" priority={first && at < 6} rounded={false} className="sw-img" />
          </div>
          <div className="sw-text">
            <button type="button" onClick={() => openProduct(product.id)} className="tpl-open sw-name text-start">
              {product.name}
            </button>
            <span className="sw-meta">
              <Price product={product} className="sw-price" />
              <QuickAction product={product} variant="icon" className="sw-add relative z-[2]" onAdded={added} />
            </span>
            <Badges product={product} className="sw-badges" />
          </div>
        </div>
      </li>
    );
  };

  return (
    <div ref={root} className="tpl-body sw-body" data-body={motif} data-still={reduced ? '' : undefined}>
      <SectionStrip marker="hooks" prefix="sw">
        {(category) => (
          <>
            <i aria-hidden className="sw-chip-mark" />
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
              className="tpl-section tpl-tall-last sw-section"
              style={{ '--sw-hue': hueAt(BALLOON_HUES, place) } as CSSProperties}
            >
              <ShapeHeading
                id={`h-${category.slug}`}
                name={category.name}
                label={n(place + 1)}
                count={n(products.length)}
                className="sw-head"
                title="sw-title"
                lead={<i aria-hidden className="sw-mark" />}
              />
              {motif === 'lira' ? (
                rowsOf(products, COINS_PER_CHAIN).map((row, r) => (
                  <ul key={row[0]!.id} className="sw-grid sw-chain">
                    {row.map((product, column) => dish(product, r * COINS_PER_CHAIN + column, column, row.length, index === 0))}
                  </ul>
                ))
              ) : (
                <ul className="sw-grid">{products.map((product, at) => dish(product, at, 0, 0, index === 0))}</ul>
              )}
            </section>
          );
        })}
      </main>
    </div>
  );
}

/** The Pegboard: a perforated workshop wall, each dish a tilted card on a nail and string, its price on a ticket. */
export function PegBody() {
  return <SwingBody motif="peg" />;
}

/** The Partridge Cages: each section a tree branch, each dish in a woven wicker cage on a rope, its photo behind the bars. */
export function KewBody() {
  return <SwingBody motif="kew" />;
}

/** The Gold Liras: each section gold chains hung in an arc, each dish a milled gold coin with its photo inside. */
export function LiraBody() {
  return <SwingBody motif="lira" />;
}

/** The Balloon Bunch: each dish a coloured balloon with its photo inside, tied by a string to its name and price card. */
export function BalloonBody() {
  return <SwingBody motif="balloon" />;
}
