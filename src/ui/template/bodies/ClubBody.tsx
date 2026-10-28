'use client';

import { useRef, type CSSProperties } from 'react';
import { formatCount } from '@/server/domain/money';
import type { MenuProductView } from '@/server/data/menu-view';
import { useApp } from '@/ui/AppProviders';
import { useTemplate } from '../context';
import { Badges, Price, ProductMedia, QuickAction } from '../parts';
import { boxBuzzes, buzzClock, deckLetter, deckPhase, holoRarity, neonTube, signFlickers } from './club-deck';
import { SectionStrip, ShapeHeading } from './shared/SectionStrip';
import { usePlaceOf } from './shared/usePlaceOf';
import { useHoloTilt } from './useHoloTilt';
import { useSpineHold, useSpineWatch } from './useSpineMotion';
import './shared/photo-card.css';
import './shared/shapes.css';
import './club.css';
import './dj.css';
import './neon.css';
import './holo.css';

/** The styles of the club family (night-out menus: a two-column grid of show pieces); each is its own body kind. */
export const CLUB_MOTIFS = ['dj', 'neon', 'holo'] as const;
export type ClubMotif = (typeof CLUB_MOTIFS)[number];

const RARITY_MARK = { legend: '★', rare: '◆', common: '●' } as const;

/**
 * The club family (spec 2026-10-28-menu-styles-77-addendum.md, the signature page): every section a grid of show
 * pieces, two on a phone and three wider, so the first screen shows four dishes with their photos and prices. The
 * `motif` draws the style:
 *
 * - `dj`, The DJ Decks: every dish a turntable. Its photo is the label of a vinyl record that spins; the tone arm
 *   rests beside it and swings its needle onto the outer grooves as the deck passes the middle of the screen, where its
 *   pilot light comes on. Sections are the record's sides (A, B, C...) with a dancing level meter. Adding scratches the
 *   record. A finger on the menu stops every record; a pointer on a deck stops it and lifts its arm.
 * - `neon`, Neon Alley: a brick wall; every section's name a neon sign in its own tube colour on a mounted board,
 *   every other one flickering like an old tube; every dish a lightbox outlined in that tube, a few of them buzzing.
 *   Adding switches the dish's tube off and on.
 * - `holo`, Holo Cards: every dish a collectable card in a frame by rarity (the house's signature or most ordered:
 *   gold legend; on sale or featured: rare foil; the rest common), with a rainbow foil sweeping its art, a collector's
 *   number and the card leaning towards a pointer with its glare under it. Adding pops the card.
 *
 * Endless motion runs only in the sections on screen, stops while a finger is down, and is off with less motion. All
 * sections are on the page, so the template's own jump and `#cat-<slug>` scrolling reach them.
 */
export function ClubBody({ motif }: { motif: ClubMotif }) {
  const { locale, tenant } = useApp();
  const { categories, byCategory, reduced, openProduct } = useTemplate();
  const n = (value: number) => formatCount(value, locale, tenant.numeralSystem);
  const two = (value: number) => (value < 10 ? n(0) : '') + n(value);
  const placeOf = usePlaceOf();
  const root = useRef<HTMLDivElement>(null);

  useSpineWatch(root, !reduced, '.ck-section', 'data-live', '64px 0px');
  useSpineWatch(root, !reduced && motif === 'dj', '.dj-deck', 'data-cue', '-34% 0px -34% 0px');
  useSpineHold(root, !reduced);
  useHoloTilt(root, !reduced && motif === 'holo');

  const added = (button: HTMLButtonElement) => {
    if (reduced) return;
    const row = button.closest('[data-row]');
    if (!row) return;
    if (motif === 'dj') {
      row.querySelector('[data-scratch]')?.animate(
        [{ rotate: '0deg' }, { rotate: '-80deg', offset: 0.35 }, { rotate: '28deg', offset: 0.7 }, { rotate: '0deg' }],
        { duration: 560, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' },
      );
    } else if (motif === 'neon') {
      row.animate([{ opacity: 1 }, { opacity: 0.15 }, { opacity: 1 }, { opacity: 0.3 }, { opacity: 1 }], { duration: 420, easing: 'steps(1, end)', pseudoElement: '::before' });
    } else {
      row.querySelector('[data-holo]')?.animate([{ scale: '1' }, { scale: '1.06' }, { scale: '1' }], { duration: 380, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' });
      row.querySelector('[data-glare]')?.animate([{ opacity: 0 }, { opacity: 0.9 }, { opacity: 0 }], { duration: 480, easing: 'ease-out' });
    }
  };

  const name = (product: MenuProductView, prefix: string) => (
    <button type="button" onClick={() => openProduct(product.id)} className={`tpl-open ck-name ${prefix}-name`}>
      {product.name}
    </button>
  );
  const add = (product: MenuProductView, prefix: string) => <QuickAction product={product} variant="icon" className={`ck-add ${prefix}-add`} onAdded={added} />;
  const media = (product: MenuProductView, sizes: string, priority: boolean, className: string) => (
    <ProductMedia product={product} suffix={motif} sizes={sizes} priority={priority} rounded={false} className={className} />
  );

  const dish = (product: MenuProductView, place: number, at: number, total: number, priority: boolean) => {
    if (motif === 'dj') {
      return (
        <li key={product.id} data-row className="ck-item dj-deck" style={{ '--dl': `${deckPhase(place * 41 + at)}s` } as CSSProperties}>
          <div className="dj-top">
            <div className="dj-platter">
              <div data-scratch className="dj-scratch">
                <div className="dj-record">
                  <div data-photo className="dj-label tpl-plate">
                    {media(product, '(min-width: 640px) 150px, 34vw', priority, 'dj-img')}
                  </div>
                </div>
              </div>
              <i aria-hidden className="dj-sheen" />
              <i aria-hidden className="dj-spindle" />
            </div>
            <span aria-hidden className="dj-arm">
              <i className="dj-tube" />
            </span>
            <i aria-hidden className="dj-pivot" />
            <i aria-hidden className="dj-led" />
          </div>
          {name(product, 'dj')}
          <Price product={product} className="ck-price dj-price" />
          <Badges product={product} className="ck-badges" />
          {add(product, 'dj')}
        </li>
      );
    }
    if (motif === 'neon') {
      const buzz = boxBuzzes(place, at) ? buzzClock(place, at) : null;
      return (
        <li
          key={product.id}
          data-row
          data-buzz={buzz ? '' : undefined}
          className="ck-item nn-box"
          style={buzz ? ({ '--t': `${buzz.time}s`, '--dl': `${buzz.delay}s` } as CSSProperties) : undefined}
        >
          <div data-photo className="nn-photo tpl-plate">
            {media(product, '(min-width: 640px) 220px, 46vw', priority, 'nn-img')}
          </div>
          {name(product, 'nn')}
          <Price product={product} className="ck-price nn-price" />
          <Badges product={product} className="ck-badges" />
          {add(product, 'nn')}
        </li>
      );
    }
    const rarity = holoRarity(product);
    return (
      <li key={product.id} data-row className="ck-item ho-slot">
        <div data-holo data-rarity={rarity} className="ho-card">
          {name(product, 'ho')}
          <div data-photo className="ho-art tpl-plate">
            {media(product, '(min-width: 640px) 220px, 44vw', priority, 'ho-img')}
            <i aria-hidden className="ho-foil" />
            <i aria-hidden data-glare className="ho-glare" />
          </div>
          <span className="ho-foot">
            <Price product={product} className="ck-price ho-price" />
            <span aria-hidden dir="ltr" className="ho-no">
              {two(at + 1)}/{two(total)}
            </span>
          </span>
          <span aria-hidden className="ho-gem">
            {RARITY_MARK[rarity]}
          </span>
          <Badges product={product} className="ck-badges" />
          {add(product, 'ho')}
        </div>
      </li>
    );
  };

  return (
    <div ref={root} className="tpl-body" data-body={motif} data-still={reduced ? '' : undefined}>
      <SectionStrip
        marker={motif === 'dj' ? 'sides' : motif === 'neon' ? 'signs' : 'sets'}
        prefix="ck"
        chipStyle={motif === 'neon' ? (category) => ({ '--c': neonTube(placeOf(category)) }) as CSSProperties : undefined}
      >
        {(category) => (
          <>
            {motif === 'dj' ? (
              <b aria-hidden className="dj-chip-side">
                {deckLetter(placeOf(category))}
              </b>
            ) : (
              <i aria-hidden className={motif === 'neon' ? 'nn-chip-tube' : 'ho-chip-gem'} />
            )}
            <span>{category.name}</span>
          </>
        )}
      </SectionStrip>
      <main id="menu" className="min-w-0 ck-main">
        {categories.map((category, index) => {
          const products = byCategory.get(category.id) ?? [];
          const place = placeOf(category);
          return (
            <section
              key={category.id}
              id={`cat-${category.slug}`}
              aria-labelledby={`h-${category.slug}`}
              data-flicker={motif === 'neon' && signFlickers(place) ? '' : undefined}
              className="tpl-section tpl-tall-last ck-section"
              style={motif === 'neon' ? ({ '--c': neonTube(place) } as CSSProperties) : undefined}
            >
              <div className="ck-headrow">
                <ShapeHeading
                  id={`h-${category.slug}`}
                  name={category.name}
                  label={motif === 'holo' ? two(place + 1) : undefined}
                  count={n(products.length)}
                  className="ck-head"
                  title={`ck-title ${motif === 'dj' ? 'dj-title' : motif === 'neon' ? 'nn-title' : 'ho-title'}`}
                  lead={
                    motif === 'dj' ? (
                      <i aria-hidden className="dj-disc">
                        <b>{deckLetter(place)}</b>
                      </i>
                    ) : motif === 'holo' ? (
                      <i aria-hidden className="ho-set" />
                    ) : undefined
                  }
                />
                {motif === 'dj' ? (
                  <span aria-hidden className="dj-eq">
                    <i />
                    <i />
                    <i />
                    <i />
                    <i />
                  </span>
                ) : null}
              </div>
              <ul className="ck-grid">{products.map((product, at) => dish(product, place, at, products.length, index === 0 && at < 4))}</ul>
            </section>
          );
        })}
      </main>
    </div>
  );
}

/** The DJ Decks (kind `dj`). */
export function DjBody() {
  return <ClubBody motif="dj" />;
}
/** Neon Alley (kind `neon`). */
export function NeonBody() {
  return <ClubBody motif="neon" />;
}
/** Holo Cards (kind `holo`). */
export function HoloBody() {
  return <ClubBody motif="holo" />;
}
