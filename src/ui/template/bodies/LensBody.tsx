'use client';

import { useRef, type CSSProperties, type ReactNode } from 'react';
import type { MenuProductView } from '@/server/data/menu-view';
import { formatCount } from '@/server/domain/money';
import { useApp } from '@/ui/AppProviders';
import { useTemplate } from '../context';
import { Badges, Price, ProductMedia, QuickAction } from '../parts';
import { hueAt, SHAPE_HUES } from './shared/hue';
import { SectionStrip, ShapeHeading } from './shared/SectionStrip';
import { usePlaceOf } from './shared/usePlaceOf';
import { inRows, useLensDepth, useLiveMarks } from './lens-depth';
import './shared/photo-card.css';
import './shared/shapes.css';
import './lens.css';
import './space-warp.css';
import './space-worm.css';
import './space-hole.css';
import './bazaar.css';
import './stamps.css';

/** The styles of the lens family (a dish's size and tilt follow its distance from the screen's middle); each is its own body kind. */
export const LENS_MOTIFS = ['space-warp', 'space-worm', 'space-hole', 'bazaar', 'stamps'] as const;
export type LensMotif = (typeof LENS_MOTIFS)[number];

/** The side of a dish: in the two-column grids the column it stands in, in the bazaar the wall of the lane it hangs on. */
export function lensSide(at: number): 'start' | 'end' {
  return at % 2 === 0 ? 'start' : 'end';
}

interface Look {
  /** The class prefix of the motif's own CSS. */
  prefix: string;
  /** The strip's data attribute. */
  marker: string;
  add: 'icon' | 'label';
  /** The space styles: a neon hue per section (`--h`) and a mono section number. */
  space: boolean;
  /** Endless motion in a drawing (streaks, rings, the disc), run only on screen and not under a finger. */
  live: boolean;
  /** What the add feedback swells, and how much. */
  added: string;
  swell: number;
  sizes: string;
}

const LOOKS: Record<LensMotif, Look> = {
  'space-warp': { prefix: 'wp', marker: 'warp', add: 'icon', space: true, live: true, added: '[data-card]', swell: 1.06, sizes: '(min-width: 640px) 320px, 46vw' },
  'space-worm': { prefix: 'wm', marker: 'tunnel', add: 'icon', space: true, live: true, added: '[data-card]', swell: 1.05, sizes: '(min-width: 640px) 320px, 46vw' },
  'space-hole': { prefix: 'hl', marker: 'horizon', add: 'icon', space: true, live: true, added: '[data-card]', swell: 1.06, sizes: '(min-width: 640px) 320px, 46vw' },
  bazaar: { prefix: 'bz', marker: 'lane', add: 'label', space: false, live: false, added: '[data-card]', swell: 1.05, sizes: '96px' },
  stamps: { prefix: 'st', marker: 'album', add: 'icon', space: false, live: false, added: '[data-photo]', swell: 1.08, sizes: '(min-width: 640px) 200px, 32vw' },
};

/**
 * The lens family (spec 2026-10-28-menu-styles-77-addendum.md): every section's dishes are drawn flat and in full, and as
 * the page scrolls each one's size and tilt follow its distance from the middle of the screen (`useLensDepth`), each
 * clamped so a dish on screen is always readable and tappable. Each motif is its own body kind with its own drawing:
 *
 * - `space-warp`, Light Speed: star streaks from the centre; dishes in the middle full size, those above and below smaller.
 * - `space-worm`, The Wormhole: purple rings; the dishes two walls that fold inward above and below the middle.
 * - `space-hole`, The Black Hole: a disc at the top of the screen; dishes reaching it stretch and twist toward it.
 * - `bazaar`, Sulaymaniyah Bazaar: hand-painted shop signs on both walls of a lane, swinging larger at the middle.
 * - `stamps`, The Stamp Album: beige pages with black strips, three perforated stamps a strip, the row at the middle
 *   under a magnifier, each price the stamp's value.
 *
 * With less motion nothing bends (the CSS bends only under `[data-lens]`): the structure stays.
 */
export function LensFamily({ motif }: { motif: LensMotif }) {
  const { locale, tenant } = useApp();
  const { categories, byCategory, reduced, openProduct } = useTemplate();
  const n = (value: number) => formatCount(value, locale, tenant.numeralSystem);
  const two = (value: number) => (value < 10 ? n(0) : '') + n(value);
  const placeOf = usePlaceOf();
  const root = useRef<HTMLDivElement>(null);
  const look = LOOKS[motif];
  const p = look.prefix;

  useLensDepth(root, !reduced, '[data-lens-item]');
  useLiveMarks(root, !reduced && look.live, '[data-live-zone]');

  const added = (button: HTMLButtonElement) => {
    if (reduced) return;
    button
      .closest('[data-dish]')
      ?.querySelector(look.added)
      ?.animate([{ scale: '1' }, { scale: String(look.swell) }, { scale: '1' }], { duration: 380, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' });
  };
  const hue = (place: number) => (look.space ? ({ '--h': hueAt(SHAPE_HUES, place) } as CSSProperties) : undefined);

  const dish = (product: MenuProductView, first: boolean): ReactNode => {
    if (motif === 'stamps') {
      return (
        <div data-dish className="st-stamp">
          <div data-photo data-card className="st-perf">
            <div className="st-photo tpl-fill-media">
              <ProductMedia product={product} suffix={motif} sizes={look.sizes} priority={first} rounded={false} />
            </div>
            <span className="st-val">
              <Price product={product} className="tpl-price-tight st-price" />
            </span>
            <button type="button" onClick={() => openProduct(product.id)} className="tpl-open st-name">
              {product.name}
            </button>
            <Badges product={product} className="st-badges" />
          </div>
          <QuickAction product={product} variant="icon" className="st-add relative z-[2]" onAdded={added} />
        </div>
      );
    }
    if (motif === 'bazaar') {
      return (
        <div data-dish className="bz-sign">
          <i aria-hidden className="bz-rope" />
          <div data-card className="bz-board">
            <div className="bz-photo tpl-fill-media">
              <ProductMedia product={product} suffix={motif} sizes={look.sizes} priority={first} rounded={false} />
            </div>
            <div className="bz-text">
              <button type="button" onClick={() => openProduct(product.id)} className="tpl-open bz-name text-start">
                {product.name}
              </button>
              <span className="bz-meta">
                <Price product={product} className="bz-price" />
                <Badges product={product} className="bz-badges" />
                <QuickAction product={product} variant="label" className="bz-add relative z-[2]" onAdded={added} />
              </span>
            </div>
          </div>
        </div>
      );
    }
    return (
      <div data-dish data-card className={`ln-card ${p}-card`}>
        <div className={`ln-photo ${p}-photo tpl-fill-media`}>
          <ProductMedia product={product} suffix={motif} sizes={look.sizes} priority={first} />
        </div>
        <button type="button" onClick={() => openProduct(product.id)} className={`tpl-open ln-name ${p}-name text-start`}>
          {product.name}
        </button>
        <span className="ln-meta">
          <Price product={product} className="ln-price" />
          <QuickAction product={product} variant={look.add} className={`ln-add ${p}-add relative z-[2]`} onAdded={added} />
        </span>
        <Badges product={product} className="ln-badges" />
      </div>
    );
  };

  return (
    <div ref={root} className="tpl-body" data-body={motif}>
      <SectionStrip
        marker={look.marker}
        prefix={p}
        chip="ln-chip"
        chipStyle={look.space ? (category) => hue(placeOf(category)) : undefined}
        lead={
          motif === 'space-hole' ? (
            <span aria-hidden data-live-zone className="hl-hole">
              <i className="hl-disk" />
              <i className="hl-core" />
            </span>
          ) : undefined
        }
      >
        {(category) => (
          <>
            {look.space ? <i aria-hidden className="ln-chip-mark" /> : null}
            <span>{category.name}</span>
          </>
        )}
      </SectionStrip>
      <main id="menu" className={`min-w-0 ln-main ${p}-main`}>
        {motif === 'space-warp' ? <div aria-hidden data-live-zone className="ln-sky wp-streaks" /> : null}
        {motif === 'space-worm' ? <div aria-hidden data-live-zone className="ln-sky wm-rings" /> : null}
        {categories.map((category, index) => {
          const products = byCategory.get(category.id) ?? [];
          const place = placeOf(category);
          return (
            <section
              key={category.id}
              id={`cat-${category.slug}`}
              aria-labelledby={`h-${category.slug}`}
              className={`tpl-section tpl-tall-last ln-section ${p}-section`}
              style={hue(place)}
            >
              <ShapeHeading
                id={`h-${category.slug}`}
                name={category.name}
                label={look.space ? two(place + 1) : undefined}
                count={n(products.length)}
                className={`ln-head ${p}-head`}
                title={`ln-title ${p}-title`}
              />
              {motif === 'stamps' ? (
                <div className="st-page">
                  <ul className="st-strips">
                    {inRows(products, 3).map((row, r) => (
                      <li key={row[0]!.id} data-lens-item className="st-strip">
                        <ul className="st-row">
                          {row.map((product, at) => (
                            <li key={product.id} className="st-cell">
                              {dish(product, index === 0 && r < 2 && at < 3)}
                            </li>
                          ))}
                        </ul>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <ul className={motif === 'bazaar' ? 'bz-lane' : `ln-grid ${p}-grid`}>
                  {products.map((product, at) => (
                    <li key={product.id} data-lens-item data-side={lensSide(at)} className={`ln-item ${p}-item`}>
                      {dish(product, index === 0 && at < 4)}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </main>
    </div>
  );
}

/** Light Speed (kind `space-warp`). */
export function SpaceWarpBody() {
  return <LensFamily motif="space-warp" />;
}
/** The Wormhole (kind `space-worm`). */
export function SpaceWormBody() {
  return <LensFamily motif="space-worm" />;
}
/** The Black Hole (kind `space-hole`). */
export function SpaceHoleBody() {
  return <LensFamily motif="space-hole" />;
}
/** Sulaymaniyah Bazaar (kind `bazaar`). */
export function BazaarBody() {
  return <LensFamily motif="bazaar" />;
}
/** The Stamp Album (kind `stamps`). */
export function StampsBody() {
  return <LensFamily motif="stamps" />;
}
