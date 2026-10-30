'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { localDigits } from '@/lib/digits';
import type { MenuProductView } from '@/server/data/menu-view';
import { formatCount } from '@/server/domain/money';
import { useApp } from '@/ui/AppProviders';
import { BackIcon, ForwardIcon } from '@/ui/Icons';
import { useTemplate } from '../context';
import { Badges, Price, ProductMedia, QuickAction } from '../parts';
import { NEON_HUES, useLiveZones } from './coverflow-shared';
import { hueAt } from './shared/hue';
import { SectionStrip, ShapeHeading } from './shared/SectionStrip';
import { usePlaceOf } from './shared/usePlaceOf';
import './shared/photo-card.css';
import './shared/shapes.css';
import './coverflow.css';
import './space-deck.css';
import './zel.css';
import './saj.css';
import './crate.css';

export const COVERFLOW_MOTIFS = ['space-deck', 'zel', 'saj', 'crate'] as const;
export type CoverflowMotif = (typeof COVERFLOW_MOTIFS)[number];

/**
 * How far forward a card is (1 at the row's middle, 0 a card and a tenth away or more), from its centre's distance to
 * the row's middle and its width. Its size, dimming and tilt follow this.
 */
export function focusOf(offset: number, width: number): number {
  if (width <= 0) return 0;
  return Math.max(0, 1 - Math.abs(offset) / (width * 1.1));
}

/** The index of the card most forward (the first of equals), or 0 for an empty row. */
export function nearestOf(focus: readonly number[]): number {
  let best = 0;
  for (let at = 1; at < focus.length; at += 1) if (focus[at]! > focus[best]!) best = at;
  return best;
}

/** The card an arrow moves to: one step from `at`, kept inside the row. */
export function stepTo(at: number, dir: -1 | 1, total: number): number {
  return Math.min(Math.max(at + dir, 0), Math.max(total - 1, 0));
}

/** A count as two digits at least (`3` → `03`), as the counter «٠٣ / ٠٦» shows it before the menu's numerals. */
export function padCount(value: number): string {
  return String(Math.max(0, Math.trunc(value))).padStart(2, '0');
}

/**
 * The zellige star: a `polygon()` of `points` tips at radius `outer` (percent of the box) and as many notches at
 * `inner` between them, the first tip at the top.
 */
export function starPolygon(points = 8, outer = 50, inner = 38): string {
  const corners = Array.from({ length: points * 2 }, (_, at) => {
    const angle = ((at * 180) / points - 90) * (Math.PI / 180);
    const radius = at % 2 ? inner : outer;
    return `${(50 + radius * Math.cos(angle)).toFixed(1)}% ${(50 + radius * Math.sin(angle)).toFixed(1)}%`;
  });
  return `polygon(${corners.join(', ')})`;
}

const STAR = starPolygon();

/**
 * The Coverflow family (spec 2026-10-28-menu-styles-77-addendum.md): every section is one sideways row that snaps a card
 * to its middle. The middle card is large and forward; its neighbours are smaller and dimmer (measured from the row's
 * scroll in a small rAF), and still visible and tappable, so a phone's first screen shows three dishes and the next
 * section's row peeking. Under each row, back and next arrows and a counter «٠٣ / ٠٦». The `motif` draws the style:
 *
 * - `space-deck` (Glass Deck): dark glass cards with a neon edge in the section's hue, a mono number over each.
 * - `zel` (Zellige Stars): each section a zellige panel under an arch, each dish an eight-point mosaic star.
 * - `saj` (Saj Bread): each section an iron saj over fire, each dish a thin round bread with char spots.
 * - `crate` (Record Crate): a wooden crate of records; the middle sleeve slides its vinyl out and it spins.
 */
export function CoverflowBody({ motif }: { motif: CoverflowMotif }) {
  const { locale, tenant } = useApp();
  const { categories, byCategory, reduced } = useTemplate();
  const n = (value: number) => formatCount(value, locale, tenant.numeralSystem);
  const placeOf = usePlaceOf();
  const root = useRef<HTMLDivElement>(null);
  useLiveZones(root, reduced, categories);

  return (
    <div ref={root} className="tpl-body" data-body={motif} data-still={reduced ? '' : undefined} style={{ '--cf-star': STAR } as CSSProperties}>
      <SectionStrip marker="flows" prefix="cf" chipStyle={(category) => ({ '--g': hueAt(NEON_HUES, placeOf(category)) }) as CSSProperties}>
        {(category) => (
          <>
            <i aria-hidden className="cf-chip-mark" />
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
              className="tpl-section tpl-tall-last cf-section"
              style={{ '--g': hueAt(NEON_HUES, place) } as CSSProperties}
            >
              <ShapeHeading
                id={`h-${category.slug}`}
                name={category.name}
                label={localDigits(padCount(place + 1), tenant.numeralSystem)}
                count={n(products.length)}
                className="cf-head"
                title="cf-title"
                lead={<i aria-hidden className="cf-ornament" />}
              />
              <CoverRow products={products} motif={motif} first={index === 0} />
            </section>
          );
        })}
      </main>
    </div>
  );
}

/** One section's row of cards, its arrows and its counter. */
function CoverRow({ products, motif, first }: { products: MenuProductView[]; motif: CoverflowMotif; first: boolean }) {
  const { t, tenant } = useApp();
  const { openProduct, reduced } = useTemplate();
  const row = useRef<HTMLUListElement>(null);
  const [at, setAt] = useState(0);
  const digits = (value: number) => localDigits(padCount(value), tenant.numeralSystem);

  // The forwardness of every card, measured once a frame while the row scrolls (and when it or the window resizes).
  useEffect(() => {
    const list = row.current;
    if (!list) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const box = list.getBoundingClientRect();
      const middle = box.left + box.width / 2;
      const cards = [...list.children] as HTMLElement[];
      const focus = cards.map((card) => {
        const rect = card.getBoundingClientRect();
        return focusOf(rect.left + rect.width / 2 - middle, card.offsetWidth);
      });
      const best = nearestOf(focus);
      cards.forEach((card, place) => {
        card.style.setProperty('--k', focus[place]!.toFixed(3));
        card.toggleAttribute('data-centre', place === best);
      });
      setAt(best);
    };
    const queue = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    queue();
    list.addEventListener('scroll', queue, { passive: true });
    window.addEventListener('resize', queue, { passive: true });
    return () => {
      list.removeEventListener('scroll', queue);
      window.removeEventListener('resize', queue);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [products]);

  const go = (dir: -1 | 1) => {
    const list = row.current;
    const target = list?.children[stepTo(at, dir, products.length)] as HTMLElement | undefined;
    if (!list || !target) return;
    const box = list.getBoundingClientRect();
    const rect = target.getBoundingClientRect();
    list.scrollBy({ left: rect.left + rect.width / 2 - (box.left + box.width / 2), behavior: reduced ? 'auto' : 'smooth' });
  };

  const added = (button: HTMLButtonElement) => {
    if (reduced) return;
    button
      .closest('[data-row]')
      ?.querySelector('[data-photo]')
      ?.animate([{ scale: '1' }, { scale: '1.08' }, { scale: '1' }], { duration: 380, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' });
  };

  return (
    <>
      <ul ref={row} className="scroll-hidden cf-row">
        {products.map((product, place) => (
          <li key={product.id} data-row className="cf-card">
            <Badges product={product} className="cf-badges" />
            {motif === 'space-deck' && (
              <span aria-hidden className="cf-num">
                {digits(place + 1)}
              </span>
            )}
            <div data-photo className="cf-photo">
              {motif === 'crate' && <i aria-hidden className="cf-vinyl" />}
              <div className="cf-frame tpl-plate">
                <ProductMedia product={product} suffix={motif} sizes="(min-width: 640px) 200px, 160px" priority={first && place < 3} rounded={false} className="cf-img" />
              </div>
            </div>
            <button type="button" onClick={() => openProduct(product.id)} className="tpl-open cf-name">
              {product.name}
            </button>
            <span className="cf-meta">
              <Price product={product} className="cf-price" />
              <QuickAction product={product} variant="icon" className="cf-add relative z-[2]" onAdded={added} />
            </span>
          </li>
        ))}
      </ul>
      {products.length > 1 && (
        <div className="cf-ctl">
          <button type="button" aria-label={t('tpl.previous')} disabled={at === 0} onClick={() => go(-1)} className="cf-arrow">
            <BackIcon />
          </button>
          <span className="cf-count tabular-nums" dir="ltr">
            {digits(at + 1)} / {digits(products.length)}
          </span>
          <button type="button" aria-label={t('tpl.next')} disabled={at >= products.length - 1} onClick={() => go(1)} className="cf-arrow">
            <ForwardIcon />
          </button>
        </div>
      )}
    </>
  );
}

export function SpaceDeckBody() {
  return <CoverflowBody motif="space-deck" />;
}

export function ZelBody() {
  return <CoverflowBody motif="zel" />;
}

export function SajBody() {
  return <CoverflowBody motif="saj" />;
}

export function CrateBody() {
  return <CoverflowBody motif="crate" />;
}
