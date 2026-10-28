'use client';

import { useRef, type CSSProperties, type ReactNode } from 'react';
import { formatCount } from '@/server/domain/money';
import type { MenuProductView } from '@/server/data/menu-view';
import { useApp } from '@/ui/AppProviders';
import { useTemplate } from '../context';
import { Badges, Price, ProductMedia, QuickAction } from '../parts';
import { hueAt, SHAPE_HUES } from './shared/hue';
import { SectionStrip, ShapeHeading } from './shared/SectionStrip';
import { usePlaceOf } from './shared/usePlaceOf';
import { useSpineHold, useSpineWatch } from './useSpineMotion';
import './shared/photo-card.css';
import './shared/shapes.css';
import './vitrine.css';
import './vitrine-wash.css';
import './vitrine-jewel.css';
import './vitrine-apoth.css';
import './vitrine-qays.css';
import './vitrine-clay.css';

/** The styles of the vitrine family (rows of drawn objects, each holding the dish's photo in a window); each is its own body kind. */
export const VITRINE_MOTIFS = ['wash', 'jewel', 'apoth', 'qays', 'clay'] as const;
export type VitrineMotif = (typeof VITRINE_MOTIFS)[number];

/** A steady pseudo-random number in [0, 1) for a seed: the same dish always glints and tilts the same way. */
export function vitrineNoise(seed: number): number {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

/** When the light's glint crosses a jar (s, negative: already on its way), so the jars of a shelf never flash together. */
export function glintDelay(seed: number): number {
  return -Number((vitrineNoise(seed) * 6).toFixed(2));
}

/** The tilt of a jeweller's hanging price tag (deg): always leaning back, never two alike, between -15 and -6. */
export function tagTilt(seed: number): number {
  return -Math.round(6 + vitrineNoise(seed + 3) * 9);
}

/** The awning's stripe hue of a souq: each section of the bazaar its own colour, kept when a search hides others. */
export function souqHue(place: number): number {
  return hueAt(SHAPE_HUES, place);
}

interface Look {
  /** The class prefix of the motif's own drawing. */
  prefix: string;
  /** The strip's data attribute (`souqs` gives `data-souqs`). */
  marker: string;
  add: 'icon' | 'label';
  /** The photo's `sizes` at the phone's column width. */
  sizes: string;
  /** Endless motion that runs only while a section is on screen and not held (the apothecary's glint). */
  live: boolean;
}

const LOOKS: Record<VitrineMotif, Look> = {
  wash: { prefix: 'wa', marker: 'rows', add: 'label', sizes: '(min-width: 640px) 180px, 34vw', live: false },
  jewel: { prefix: 'jw', marker: 'trays', add: 'label', sizes: '(min-width: 640px) 180px, 36vw', live: false },
  apoth: { prefix: 'ap', marker: 'shelves', add: 'label', sizes: '(min-width: 640px) 160px, 30vw', live: true },
  qays: { prefix: 'qy', marker: 'souqs', add: 'label', sizes: '(min-width: 640px) 200px, 44vw', live: false },
  clay: { prefix: 'cy', marker: 'seal', add: 'label', sizes: '(min-width: 640px) 200px, 44vw', live: false },
};

const ease = 'cubic-bezier(0.23, 1, 0.32, 1)';

/**
 * The vitrine family (spec 2026-10-28-menu-styles-77-addendum.md): every section a row (a shelf, a tray, a lane) of drawn
 * objects two or three across, each object holding the dish's photo in its window; a sticky strip of sections. Each
 * motif is its own body kind with its own drawing and motion (the CSS under `[data-body='<motif>']`):
 *
 * - `wash`, The Laundromat: washing machines, the photo behind the round door, the price on the green display; the
 *   photo spins in the drum when the dish is added.
 * - `jewel`, The Jeweller: velvet trays, each dish a gem in a round gold bezel, its price on a tilted hanging tag; it
 *   flashes and sparkles when added.
 * - `apoth`, The Apothecary: wooden shelves, three glass jars a shelf with cork lids and old paper labels; a glint of
 *   light crosses the glass, and the jar shakes when added.
 * - `qays`, Erbil Qaysari: each section a souq under its sign, each dish a shop under a stone arch with a striped
 *   awning, its price on a small board; the awning flaps when added.
 * - `clay`, Sumerian Tablets: clay tablets with cuneiform edges, the photo pressed into the clay, the sections on a
 *   cylinder-seal band; adding stamps a seal mark into the tablet.
 *
 * All sections are on the page, so the template's own jump and `#cat-<slug>` scrolling reach them.
 */
export function VitrineFamily({ motif }: { motif: VitrineMotif }) {
  const { locale, tenant } = useApp();
  const { categories, byCategory, reduced, openProduct } = useTemplate();
  const n = (value: number) => formatCount(value, locale, tenant.numeralSystem);
  const placeOf = usePlaceOf();
  const root = useRef<HTMLDivElement>(null);
  const look = LOOKS[motif];
  const p = look.prefix;

  useSpineWatch(root, !reduced && look.live, '.vt-section', 'data-live');
  useSpineHold(root, !reduced && look.live);

  const added = (button: HTMLButtonElement) => {
    const tile = button.closest<HTMLElement>('[data-tile]');
    if (!tile) return;
    // The seal mark is the tablet's state, not motion: it is pressed in with less motion too, only without the press.
    if (motif === 'clay') tile.setAttribute('data-cut', '');
    if (reduced) return;
    switch (motif) {
      case 'wash':
        tile
          .querySelector('[data-photo] > :first-child')
          ?.animate([{ rotate: '0deg' }, { rotate: '720deg' }], { duration: 800, easing: 'cubic-bezier(0.77, 0, 0.175, 1)' });
        return;
      case 'jewel':
        tile.querySelector('.jw-set')?.animate(
          [
            { scale: '1', filter: 'brightness(1)' },
            { scale: '1.08', filter: 'brightness(1.5)' },
            { scale: '1', filter: 'brightness(1)' },
          ],
          { duration: 450, easing: ease },
        );
        tile.querySelector('.jw-star')?.animate(
          [
            { scale: '1', rotate: '0deg', opacity: 1 },
            { scale: '1.9', rotate: '90deg', opacity: 1 },
            { scale: '1', rotate: '180deg', opacity: 1 },
          ],
          { duration: 520, easing: ease },
        );
        return;
      case 'apoth':
        tile.querySelector('.ap-jar')?.animate([{ rotate: '0deg' }, { rotate: '-7deg' }, { rotate: '5deg' }, { rotate: '-2deg' }, { rotate: '0deg' }], { duration: 520, easing: ease });
        return;
      case 'qays':
        tile.querySelector('.qy-awn')?.animate([{ scale: '1 1' }, { scale: '1 1.8' }, { scale: '1 0.85' }, { scale: '1 1' }], { duration: 460, easing: ease });
        return;
      case 'clay':
        tile.querySelector('.cy-seal')?.animate(
          [
            { scale: '1.6', opacity: 0 },
            { scale: '0.92', opacity: 1 },
            { scale: '1', opacity: 1 },
          ],
          { duration: 360, easing: ease },
        );
        return;
    }
  };

  const chipInside = (name: string): ReactNode => {
    switch (motif) {
      case 'wash':
        return (
          <>
            <i aria-hidden className="wa-coin" />
            <span>{name}</span>
          </>
        );
      case 'jewel':
        return (
          <>
            <i aria-hidden className="jw-chip-gem" />
            <span>{name}</span>
          </>
        );
      default:
        return <span>{name}</span>;
    }
  };

  const tile = (product: MenuProductView, at: number, first: boolean): ReactNode => {
    const photo = (
      <div data-photo className={`vt-window ${p}-window tpl-plate`}>
        <ProductMedia product={product} suffix={motif} sizes={look.sizes} priority={first && at < 4} rounded={false} className="vt-img" />
        {motif === 'apoth' ? <i aria-hidden className="ap-glint" /> : null}
        {motif === 'apoth' ? (
          <span className="ap-lbl">
            <button type="button" onClick={() => openProduct(product.id)} className="tpl-open vt-name ap-name">
              {product.name}
            </button>
            <Price product={product} className="vt-price tpl-price-tight" />
          </span>
        ) : null}
      </div>
    );
    const name =
      motif === 'apoth' ? null : (
        <button type="button" onClick={() => openProduct(product.id)} className={`tpl-open vt-name ${p}-name`}>
          {product.name}
        </button>
      );
    const add = <QuickAction product={product} variant={look.add} className={`vt-add ${p}-add relative z-[2]`} onAdded={added} />;
    const badges = <Badges product={product} className={`vt-badges ${p}-badges`} />;

    switch (motif) {
      case 'wash':
        return (
          <>
            <span className="wa-panel">
              <i aria-hidden className="wa-knob" />
              <Price product={product} className="vt-price wa-lcd tpl-price-tight" />
              <i aria-hidden className="wa-knob" />
            </span>
            {photo}
            {name}
            {badges}
            {add}
          </>
        );
      case 'jewel':
        return (
          <>
            <Price product={product} className="vt-price jw-tag tpl-price-tight" />
            <div className="jw-set">
              {photo}
              <i aria-hidden className="jw-star">
                ✦
              </i>
            </div>
            {name}
            {badges}
            {add}
          </>
        );
      case 'apoth':
        return (
          <>
            <div className="ap-jar">
              <i aria-hidden className="ap-cork" />
              {photo}
            </div>
            {badges}
            {add}
          </>
        );
      case 'qays':
        return (
          <>
            {photo}
            <i aria-hidden className="qy-awn" />
            {name}
            <span className="qy-line">
              <Price product={product} className="vt-price qy-board tpl-price-tight" />
              {add}
            </span>
            {badges}
          </>
        );
      case 'clay':
        return (
          <>
            {photo}
            {name}
            <span className="cy-line">
              <Price product={product} className="vt-price cy-price" />
              {add}
            </span>
            {badges}
            <i aria-hidden className="cy-seal">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12.5 10 17.5 19 7" />
              </svg>
            </i>
          </>
        );
    }
  };

  return (
    <div ref={root} className="tpl-body" data-body={motif}>
      <SectionStrip marker={look.marker} prefix="vt" chip={`vt-chip ${p}-chip`} className={`vt-strip ${p}-strip`}>
        {(category) => chipInside(category.name)}
      </SectionStrip>
      <main id="menu" className={`min-w-0 vt-main ${p}-main`}>
        {categories.map((category, index) => {
          const products = byCategory.get(category.id) ?? [];
          const place = placeOf(category);
          return (
            <section
              key={category.id}
              id={`cat-${category.slug}`}
              aria-labelledby={`h-${category.slug}`}
              className={`tpl-section tpl-tall-last vt-section ${p}-section`}
              style={motif === 'qays' ? ({ '--h': souqHue(place) } as CSSProperties) : undefined}
            >
              <ShapeHeading
                id={`h-${category.slug}`}
                name={category.name}
                label={motif === 'clay' || motif === 'apoth' ? n(place + 1) : undefined}
                count={n(products.length)}
                className={`vt-head ${p}-head`}
                title={`vt-title ${p}-title`}
                lead={motif === 'clay' ? <i aria-hidden className="cy-roll" /> : undefined}
              />
              <ul className={`vt-grid ${p}-grid`}>
                {products.map((product, at) => {
                  const seed = place * 97 + at + 1;
                  const style =
                    motif === 'apoth'
                      ? ({ '--dl': `${glintDelay(seed)}s` } as CSSProperties)
                      : motif === 'jewel'
                        ? ({ '--tilt': `${tagTilt(seed)}deg` } as CSSProperties)
                        : undefined;
                  return (
                    <li key={product.id} data-tile className={`vt-tile ${p}-tile`} style={style}>
                      {tile(product, at, index === 0)}
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

/** The Laundromat (kind `wash`). */
export function WashBody() {
  return <VitrineFamily motif="wash" />;
}
/** The Jeweller (kind `jewel`). */
export function JewelBody() {
  return <VitrineFamily motif="jewel" />;
}
/** The Apothecary (kind `apoth`). */
export function ApothBody() {
  return <VitrineFamily motif="apoth" />;
}
/** Erbil Qaysari (kind `qays`). */
export function QaysBody() {
  return <VitrineFamily motif="qays" />;
}
/** Sumerian Tablets (kind `clay`). */
export function ClayBody() {
  return <VitrineFamily motif="clay" />;
}
