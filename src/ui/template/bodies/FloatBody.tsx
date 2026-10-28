'use client';

import { useRef, type CSSProperties } from 'react';
import { formatCount } from '@/server/domain/money';
import { useApp } from '@/ui/AppProviders';
import { useTemplate } from '../context';
import { Badges, Price, ProductMedia, QuickAction } from '../parts';
import { floatClock, floatDepth, floatSeed, floatTilt, useFloatParallax, useLiveInView } from './float-motion';
import { SectionStrip, ShapeHeading } from './shared/SectionStrip';
import { usePlaceOf } from './shared/usePlaceOf';
import './shared/photo-card.css';
import './shared/shapes.css';
import './float.css';
import './space-zero.css';
import './kilim.css';
import './henar.css';
import './jamana.css';
import './clips.css';

export const FLOAT_MOTIFS = ['space-zero', 'kilim', 'henar', 'jamana', 'clips'] as const;
export type FloatMotif = (typeof FLOAT_MOTIFS)[number];

/** A clipping's cut: its photo's shape (wide, square, tall, landscape) by its place, its type (0 to 3) by the dish. */
export function clipCut(key: string, at: number): { ratio: number; face: number } {
  return { ratio: [1.4, 1, 0.85, 1.2][at % 4]!, face: Math.floor(floatSeed(key, 11) * 4) };
}

/**
 * The `float` family (spec 2026-10-28-menu-styles-77-addendum.md): the dishes of a section float in a scattered grid
 * (two across on a phone, three for the pomegranate's seeds), each at its own depth. A near dish is larger and brighter,
 * a far one smaller and dimmer; each rests at a slight tilt and sways slowly on its own clock; as the page scrolls the
 * near ones run ahead and the far ones lag (one rAF reading the scroll, only for dishes on screen). The parallax, the
 * sway and the tilt are bounded (`floatReach`) inside the grid's row gap, so a dish never covers another's name, price
 * or add button. The sway runs only while its section is on screen and no finger is on it; with less motion nothing
 * moves and the scattered grid stays. Each motif draws the section and the dish in its own material:
 *
 * - `space-zero`: glass cards in zero gravity over a starfield.
 * - `kilim`: each section a hand-woven kilim with a patterned border and fringes; dishes as hexagonal medallions.
 * - `henar`: each section a split Halabja pomegranate with its crown; each dish a ruby seed that glints when added.
 * - `jamana`: black-and-white head-scarf squares turned on their corner, with tassels; a quarter turn when added.
 * - `clips`: a scrapbook page per section; dishes are torn newspaper clippings taped on, in sizes and types of their own.
 */
export function FloatBody({ motif }: { motif: FloatMotif }) {
  const { locale, tenant } = useApp();
  const { categories, byCategory, reduced, openProduct } = useTemplate();
  const n = (value: number) => formatCount(value, locale, tenant.numeralSystem);
  const placeOf = usePlaceOf();
  const root = useRef<HTMLDivElement>(null);
  useFloatParallax(root, reduced);
  useLiveInView(root, '[data-fl-field]', reduced);

  const pulse = (node: Element | null | undefined, to: number) =>
    node?.animate([{ scale: '1' }, { scale: String(to) }, { scale: '1' }], { duration: 360, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' });

  const added = (button: HTMLButtonElement) => {
    const item = button.closest<HTMLElement>('[data-fl]');
    if (!item) return;
    const art = item.querySelector<HTMLElement>('[data-art]');
    if (motif === 'henar') item.setAttribute('data-picked', '');
    if (reduced) return;
    if (motif === 'jamana' && art) {
      // The diamond turns a quarter, and keeps turning a quarter more on every add.
      const turns = Number(art.dataset.turns ?? 0) + 1;
      art.dataset.turns = String(turns);
      art.style.rotate = `${45 + turns * 90}deg`;
      return;
    }
    if (motif === 'henar') {
      pulse(art, 1.12);
      item.querySelector('[data-glint]')?.animate(
        [
          { opacity: 0, translate: '-120% -120%' },
          { opacity: 1, offset: 0.3 },
          { opacity: 0, translate: '120% 120%' },
        ],
        { duration: 620, easing: 'ease-out' },
      );
      return;
    }
    if (motif === 'clips') pulse(item.querySelector('[data-card]'), 1.04);
    else pulse(art, motif === 'kilim' ? 1.08 : 1.06);
  };

  return (
    <div ref={root} className="tpl-body" data-body={motif} data-calm={reduced ? '' : undefined}>
      <SectionStrip marker="float" prefix="fl">
        {(category) => (
          <>
            <i aria-hidden className="fl-chip-mark" />
            <span>{category.name}</span>
          </>
        )}
      </SectionStrip>
      <main id="menu" className="min-w-0">
        {categories.map((category, index) => {
          const products = byCategory.get(category.id) ?? [];
          return (
            <section key={category.id} id={`cat-${category.slug}`} aria-labelledby={`h-${category.slug}`} className="tpl-section tpl-tall-last fl-section">
              <i aria-hidden className="fl-over" />
              <div className="fl-frame">
                <ShapeHeading id={`h-${category.slug}`} name={category.name} label={n(placeOf(category) + 1)} count={n(products.length)} className="fl-head" title="fl-title" />
                <ul data-fl-field className="fl-field">
                  {products.map((product, at) => {
                    const { period, delay } = floatClock(product.id);
                    const cut = clipCut(product.id, at);
                    const style = {
                      '--r': `${floatTilt(product.id)}deg`,
                      '--t': `${period}s`,
                      '--dl': `${delay}s`,
                      '--cut': cut.ratio,
                    } as CSSProperties;
                    return (
                      <li key={product.id} data-fl data-z={floatDepth(product.id)} data-face={cut.face} className="fl-item" style={style}>
                        <div className="fl-float">
                          <div data-card className="fl-sway">
                            <i aria-hidden className="fl-tape" />
                            <div data-art className="fl-art">
                              <div className="fl-photo tpl-plate tpl-fill-media">
                                <ProductMedia product={product} suffix={motif} sizes="(min-width: 640px) 200px, 45vw" rounded={false} priority={index === 0 && at < 4} />
                              </div>
                              <i aria-hidden data-glint className="fl-glint" />
                            </div>
                            <i aria-hidden className="fl-tassel" />
                            <div className="fl-text">
                              <button type="button" onClick={() => openProduct(product.id)} className="tpl-open fl-name text-start">
                                {product.name}
                              </button>
                              <Badges product={product} className="fl-badges" />
                              <span className="fl-meta">
                                <Price product={product} className="fl-price" />
                                <QuickAction product={product} variant="icon" className="fl-add relative z-[2]" onAdded={added} />
                              </span>
                            </div>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
              <i aria-hidden className="fl-under" />
            </section>
          );
        })}
      </main>
    </div>
  );
}

export function SpaceZeroBody() {
  return <FloatBody motif="space-zero" />;
}
export function KilimBody() {
  return <FloatBody motif="kilim" />;
}
export function HenarBody() {
  return <FloatBody motif="henar" />;
}
export function JamanaBody() {
  return <FloatBody motif="jamana" />;
}
export function ClipsBody() {
  return <FloatBody motif="clips" />;
}
