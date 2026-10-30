'use client';

import { useRef, type CSSProperties } from 'react';
import { formatCount } from '@/server/domain/money';
import { useApp } from '@/ui/AppProviders';
import { useTemplate } from '../context';
import { Badges, Price, ProductMedia, QuickAction } from '../parts';
import { driftDirection } from './drift-motion';
import { SectionStrip, ShapeHeading } from './shared/SectionStrip';
import { SHAPE_HUES, hueAt } from './shared/hue';
import { usePlaceOf } from './shared/usePlaceOf';
import { useDrift } from './useDrift';
import './shared/photo-card.css';
import './shared/shapes.css';
import './drift.css';
import './space-drift.css';
import './sadu.css';
import './halay.css';
import './dabka.css';
import './faqi.css';
import './ahwar.css';

/** The looks of the drift family; each is its own body kind (and `data-body`). */
export const DRIFT_MOTIFS = ['space-drift', 'sadu', 'halay', 'dabka', 'faqi', 'ahwar'] as const;
export type DriftMotif = (typeof DRIFT_MOTIFS)[number];

/** The motifs whose first dish leads the line with a red cloth (the halay's handkerchief, the dabka's chafiya). */
export function leadsWithCloth(motif: DriftMotif): boolean {
  return motif === 'halay' || motif === 'dabka';
}

/**
 * Each dish's own clock for the endless sway of its look (seconds): a period and a start offset that differ from dish to
 * dish but stay the same for the same dish, so neighbours never move in step (except the dabka, whose line stamps as one).
 */
export function swayClock(at: number): { period: number; delay: number } {
  const wobble = ((at * 7919) % 97) / 97;
  return { period: Math.round((5 + wobble * 3) * 100) / 100, delay: -Math.round((((at * 31) % 13) / 13) * 600) / 100 };
}

/** The feedback of a dish added straight away, per look: the dish's photo or card answers (none with less motion). */
function addedFeedback(motif: DriftMotif, button: HTMLButtonElement) {
  const dish = button.closest<HTMLElement>('[data-row]');
  if (!dish) return;
  const photo = dish.querySelector<HTMLElement>('[data-photo]');
  const ease = 'cubic-bezier(0.23, 1, 0.32, 1)';
  switch (motif) {
    case 'ahwar':
      // The boat takes the load: it dips and rocks back.
      dish.animate(
        [{ translate: '0 0', rotate: '0deg' }, { translate: '0 6px', rotate: '-3deg' }, { translate: '0 -3px', rotate: '2deg' }, { translate: '0 0', rotate: '0deg' }],
        { duration: 600, easing: ease },
      );
      return;
    case 'dabka':
      // The dancer stamps: a quick dip and rise.
      photo?.animate([{ translate: '0 0' }, { translate: '0 8px' }, { translate: '0 -8px' }, { translate: '0 0' }], { duration: 420, easing: ease });
      return;
    case 'space-drift':
      dish.animate([{ scale: '1' }, { scale: '1.08' }, { scale: '1' }], { duration: 360, easing: ease });
      return;
    default:
      photo?.animate([{ scale: '1' }, { scale: motif === 'halay' ? '1.15' : '1.1' }, { scale: '1' }], { duration: 360, easing: ease });
  }
}

/**
 * The drift family (spec 2026-10-28-menu-styles-77-addendum.md, batch 13): every section is one sideways row of dishes
 * that drifts slowly by itself, the rows of neighbouring sections in opposite directions (useDrift.ts moves each row's
 * own `scrollLeft`, so it can be dragged by hand and mirrors in Arabic). A row stops while a finger or the mouse is on
 * it or keyboard focus is in it, pauses off screen, and never moves with less motion. Several dishes show in each row,
 * each with its photo, name (the tap target), price, labels and add. A sticky strip jumps to a section. The motif draws
 * the look:
 *
 * - `space-drift`: glass cards floating in deep space, each swaying on its own clock.
 * - `sadu`: Bedouin sadu weaving; each section a red woven band with toothed edges, the dishes in woven diamonds.
 * - `halay`: a Kurdish halay line hand in hand on a meadow, the dish photo as each dancer's face, the first dancer
 *   waving the red handkerchief; the line glides on.
 * - `dabka`: a dabka row in coloured robes on a stage, the photo at the head, name and price on the robe, the first
 *   holding the red chafiya; the whole row stamps and steps on one beat.
 * - `faqi`: the faqiyana, the long sheer sleeve stretched sideways; the dishes are pieces of it and a wave runs along it.
 * - `ahwar`: the southern marshes at sunset; each section a channel between reeds, each dish a wooden mashhuf boat
 *   carrying its photo with its name and price on its side, bobbing on the water.
 */
export function DriftBody({ motif }: { motif: DriftMotif }) {
  const { locale, tenant } = useApp();
  const { categories, byCategory, reduced, openProduct } = useTemplate();
  const n = (value: number) => formatCount(value, locale, tenant.numeralSystem);
  const placeOf = usePlaceOf();
  const root = useRef<HTMLDivElement>(null);
  useDrift(root, reduced, motif === 'dabka');
  const cloth = leadsWithCloth(motif);

  return (
    <div ref={root} className="tpl-body" data-body={motif}>
      <SectionStrip marker="drifts" prefix="dr" chipStyle={(category) => ({ '--dr-hue': hueAt(SHAPE_HUES, placeOf(category)) }) as CSSProperties}>
        {(category) => (
          <>
            <i aria-hidden className="dr-chip-mark" />
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
              className="tpl-section tpl-tall-last dr-section"
              style={{ '--dr-hue': hueAt(SHAPE_HUES, place) } as CSSProperties}
            >
              <i aria-hidden className="dr-edge" />
              <ShapeHeading
                id={`h-${category.slug}`}
                name={category.name}
                label={n(place + 1)}
                count={n(products.length)}
                className="dr-head"
                title="dr-title"
              />
              <ul data-drift={driftDirection(place)} className="scroll-hidden dr-row">
                {products.map((product, at) => {
                  const clock = swayClock(at + place * 5);
                  return (
                    <li
                      key={product.id}
                      data-row
                      className="dr-dish"
                      style={
                        {
                          '--i': at,
                          '--dr-t': `${clock.period}s`,
                          '--dr-dl': `${clock.delay}s`,
                          '--dr-dancer': hueAt(SHAPE_HUES, at + place),
                        } as CSSProperties
                      }
                    >
                      {cloth && at === 0 ? <i aria-hidden className="dr-cloth" /> : null}
                      <div data-photo className="dr-photo tpl-plate">
                        <ProductMedia product={product} suffix={motif} sizes="160px" priority={index === 0 && at < 4} className="dr-img" rounded={false} />
                      </div>
                      <div className="dr-words">
                        <button type="button" onClick={() => openProduct(product.id)} className="tpl-open dr-name">
                          {product.name}
                        </button>
                        <Price product={product} className="dr-price" />
                      </div>
                      <Badges product={product} className="dr-badges" />
                      <QuickAction product={product} variant="icon" className="dr-add relative z-[2]" onAdded={reduced ? undefined : (button) => addedFeedback(motif, button)} />
                    </li>
                  );
                })}
              </ul>
              <i aria-hidden className="dr-edge dr-edge-end" />
            </section>
          );
        })}
      </main>
    </div>
  );
}

export function SpaceDriftBody() {
  return <DriftBody motif="space-drift" />;
}
export function SaduBody() {
  return <DriftBody motif="sadu" />;
}
export function HalayBody() {
  return <DriftBody motif="halay" />;
}
export function DabkaBody() {
  return <DriftBody motif="dabka" />;
}
export function FaqiBody() {
  return <DriftBody motif="faqi" />;
}
export function AhwarBody() {
  return <DriftBody motif="ahwar" />;
}
