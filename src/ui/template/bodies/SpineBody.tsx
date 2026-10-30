'use client';

import { useRef, type CSSProperties, type ReactNode } from 'react';
import { formatCount } from '@/server/domain/money';
import { useApp } from '@/ui/AppProviders';
import { useTemplate } from '../context';
import { Badges, Description, Price, ProductMedia, QuickAction } from '../parts';
import { hueAt, SHAPE_HUES } from './shared/hue';
import { SectionStrip, ShapeHeading } from './shared/SectionStrip';
import { useOnceInView } from './shared/useOnceInView';
import { usePlaceOf } from './shared/usePlaceOf';
import { useSpineHold, useSpineWatch } from './useSpineMotion';
import './shared/photo-card.css';
import './shared/shapes.css';
import './spine.css';
import './space-count.css';
import './space-comet.css';
import './newroz.css';
import './klash.css';
import './dengbej.css';
import './manus.css';

/** The styles of the spine family (dishes down a central line, on alternate sides); each is its own body kind. */
export const SPINE_MOTIFS = ['spine', 'space-count', 'newroz', 'klash', 'dengbej', 'space-comet', 'manus'] as const;
export type SpineMotif = (typeof SPINE_MOTIFS)[number];

/** The side of the thread a dish's words sit on: the first dish of a section at the start, then turn about. */
export function spineSide(at: number): 'start' | 'end' {
  return at % 2 === 0 ? 'start' : 'end';
}

/**
 * The countdown's step of every dish shown (The Countdown): the menu counts down across all its sections, so the last
 * dish is T-01 and the one before it T-02, whatever a search leaves. `sizes` are the dish counts of the sections shown.
 */
export function countdownSteps(sizes: readonly number[]): number[][] {
  let left = sizes.reduce((sum, size) => sum + size, 0);
  return sizes.map((size) => Array.from({ length: size }, () => left--));
}

/** How far in from the start a meteor of the shower sits (percent of the column), so the cards fall in a ragged diagonal. */
const COMET_OFFSETS = [8, 22, 12, 24, 10, 20] as const;
export function cometOffset(at: number): number {
  return COMET_OFFSETS[((at % COMET_OFFSETS.length) + COMET_OFFSETS.length) % COMET_OFFSETS.length]!;
}

/** A steady pseudo-random number in [0, 1) for a seed: the same dish always sways and sparks the same way. */
export function spineNoise(seed: number): number {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

/** The sparks a Newroz fire throws: how long each flies (s), how late it starts (s, negative: already flying), its drift (px). */
export function newrozSparks(count: number, seed: number): { time: number; delay: number; drift: number }[] {
  return Array.from({ length: count }, (_, at) => ({
    time: Number((1.6 + spineNoise(seed * 31 + at) * 1.4).toFixed(2)),
    delay: -Number((spineNoise(seed * 17 + at * 3 + 1) * 2.5).toFixed(2)),
    drift: Math.round((spineNoise(seed * 7 + at * 7 + 2) - 0.5) * 70),
  }));
}

/** A torch's sway: its period (s) and its phase (s, negative), so neighbours never swing together. */
export function torchSway(seed: number): { time: number; delay: number } {
  return { time: Number((4 + spineNoise(seed) * 2.5).toFixed(2)), delay: -Number((spineNoise(seed + 7) * 6).toFixed(2)) };
}

interface Look {
  /** The class prefix of the motif's own CSS. */
  prefix: string;
  /** The strip's data attribute (`beads` gives `data-beads`). */
  marker: string;
  add: 'icon' | 'label';
  /** Description lines under the name (0: none). */
  describe: 0 | 1 | 2 | 3;
  /** The dish plays an entrance the first time it is seen (`data-in`). */
  entrance: boolean;
  /** The sections carry endless motion, run only while on screen (`data-live`) and not held. */
  live: boolean;
  /** What the add feedback moves: the photo or the whole row, and how far it swells. */
  added: 'photo' | 'row';
  swell: number;
  /** The section's own hue (`--h`) on the strip and the section: the space styles' neon. */
  hued: boolean;
  sizes: string;
}

const LOOKS: Record<SpineMotif, Look> = {
  spine: { prefix: 'sn', marker: 'beads', add: 'icon', describe: 0, entrance: false, live: false, added: 'photo', swell: 1, hued: false, sizes: '96px' },
  'space-count': { prefix: 'sc', marker: 'stages', add: 'icon', describe: 0, entrance: true, live: true, added: 'row', swell: 1.05, hued: true, sizes: '72px' },
  newroz: { prefix: 'nr', marker: 'peaks', add: 'label', describe: 0, entrance: false, live: true, added: 'photo', swell: 1.15, hued: false, sizes: '96px' },
  klash: { prefix: 'kl', marker: 'trails', add: 'label', describe: 1, entrance: true, live: false, added: 'photo', swell: 1.1, hued: false, sizes: '96px' },
  dengbej: { prefix: 'db', marker: 'poems', add: 'label', describe: 2, entrance: true, live: false, added: 'photo', swell: 1.1, hued: false, sizes: '96px' },
  'space-comet': { prefix: 'cm', marker: 'showers', add: 'icon', describe: 0, entrance: true, live: true, added: 'row', swell: 1.05, hued: true, sizes: '96px' },
  manus: { prefix: 'ms', marker: 'chapters', add: 'label', describe: 3, entrance: true, live: true, added: 'photo', swell: 1.08, hued: false, sizes: '112px' },
};

/**
 * The spine family (spec 2026-10-28-menu-styles-77-addendum.md): every dish on alternate sides of one line down the
 * page, a section heading on the line, a sticky strip of sections. Each motif is its own body kind with its own drawing
 * and motion (the CSS under `[data-body='<motif>']`):
 *
 * - `spine`, The Prayer Beads: an amber misbaha, every dish a bead, each section's shahid and tassel.
 * - `space-count`, The Countdown: a neon line, the dishes steps T-NN overlapping down to T-01, stages, lift-off.
 * - `newroz`, Newroz Fire: each section a mountain with a fire on its peak throwing sparks, the dishes torches.
 * - `klash`, Hawraman Klash: each section a trail, every dish a knitted white klash sole printed as you walk.
 * - `dengbej`, The Dengbêj: each section a poem, the dishes verses answering across, a singing medallion.
 * - `space-comet`, Meteor Shower: glass cards with a glowing round photo and a neon tail, staggered diagonally.
 * - `manus`, The Manuscript: a gilded folio, dishes written in naskh, rosettes between, miniatures in the margin.
 *
 * All sections are on the page, so the template's own jump and `#cat-<slug>` scrolling reach them.
 */
export function SpineFamily({ motif }: { motif: SpineMotif }) {
  const { locale, tenant } = useApp();
  const { categories, byCategory, reduced, openProduct } = useTemplate();
  const n = (value: number) => formatCount(value, locale, tenant.numeralSystem);
  const two = (value: number) => (value < 10 ? n(0) : '') + n(value);
  const placeOf = usePlaceOf();
  const root = useRef<HTMLDivElement>(null);
  const look = LOOKS[motif];
  const p = look.prefix;

  useOnceInView(root, reduced || !look.entrance, { item: 'data-step', id: 'data-step', mark: 'data-in' });
  useSpineWatch(root, !reduced && look.live, `.${p}-section`, 'data-live');
  useSpineWatch(root, !reduced && motif === 'dengbej', '.db-ball', 'data-sing', '-42% 0px -42% 0px');
  useSpineHold(root, !reduced && look.live);

  const click = (button: HTMLButtonElement) => {
    if (reduced) return;
    const row = button.closest('[data-row]');
    if (motif === 'spine') {
      row
        ?.querySelector('[data-photo]')
        ?.animate([{ transform: 'translateY(0)' }, { transform: 'translateY(0.6rem)' }, { transform: 'translateY(0)' }], { duration: 260, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' });
      return;
    }
    const target = look.added === 'row' ? row : row?.querySelector('[data-photo]');
    target?.animate([{ scale: '1' }, { scale: String(look.swell) }, { scale: '1' }], { duration: 380, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' });
  };

  const steps = motif === 'space-count' ? countdownSteps(categories.map((category) => byCategory.get(category.id)?.length ?? 0)) : null;
  const hue = (place: number) => (look.hued ? ({ '--h': hueAt(SHAPE_HUES, place) } as CSSProperties) : undefined);

  const headLead = (place: number): ReactNode => {
    switch (motif) {
      case 'spine':
        return <i aria-hidden className="sn-shahid" />;
      case 'newroz':
        return (
          <span aria-hidden className="nr-peak">
            <i className="nr-fire" />
            <span className="nr-sparks">
              {newrozSparks(10, place + 1).map((spark, at) => (
                <i key={at} style={{ '--t': `${spark.time}s`, '--dl': `${spark.delay}s`, '--dx': `${spark.drift}px` } as CSSProperties} />
              ))}
            </span>
          </span>
        );
      case 'klash':
        return <i aria-hidden className="kl-sign" />;
      case 'manus':
        return (
          <i aria-hidden className="ms-rose">
            ۞
          </i>
        );
      default:
        return null;
    }
  };
  const headLabel = (place: number) => (motif === 'spine' || motif === 'dengbej' ? n(place + 1) : look.hued ? two(place + 1) : undefined);

  return (
    <div ref={root} className="tpl-body" data-body={motif}>
      <SectionStrip
        marker={look.marker}
        prefix={p}
        chipStyle={look.hued ? (category) => hue(placeOf(category)) : undefined}
      >
        {(category) => (
          <>
            {motif === 'dengbej' ? null : <i aria-hidden className={motif === 'spine' ? 'sn-chip-bead' : `${p}-chip-mark`} />}
            <span>{category.name}</span>
          </>
        )}
      </SectionStrip>
      <main id="menu" className={motif === 'spine' ? 'min-w-0' : `min-w-0 ${p}-main`}>
        {categories.map((category, index) => {
          const products = byCategory.get(category.id) ?? [];
          const place = placeOf(category);
          return (
            <section
              key={category.id}
              id={`cat-${category.slug}`}
              aria-labelledby={`h-${category.slug}`}
              className={`tpl-section tpl-tall-last ${p}-section`}
              style={hue(place)}
            >
              <ShapeHeading
                id={`h-${category.slug}`}
                name={category.name}
                label={headLabel(place)}
                count={n(products.length)}
                className={`${p}-head`}
                title={`${p}-title`}
                lead={headLead(place)}
              />
              <ul className={`${p}-thread`}>
                {products.map((product, at) => {
                  const sway = motif === 'newroz' ? torchSway(index * 50 + at + 1) : null;
                  const style =
                    motif === 'space-comet'
                      ? ({ '--o': `${cometOffset(at)}%` } as CSSProperties)
                      : sway
                        ? ({ '--t': `${sway.time}s`, '--dl': `${sway.delay}s` } as CSSProperties)
                        : undefined;
                  return (
                    <li key={product.id} data-row data-step={motif === 'spine' ? undefined : product.id} data-side={spineSide(at)} className={`${p}-bead`} style={style}>
                      <div data-photo className={`${p}-ball tpl-plate`}>
                        <ProductMedia product={product} suffix={motif} sizes={look.sizes} priority={index === 0 && at < 6} className={`${p}-img`} />
                      </div>
                      <div className={`${p}-text`}>
                        {steps ? (
                          <span aria-hidden dir="ltr" className="sc-step">
                            T-{two(steps[index]![at]!)}
                          </span>
                        ) : motif === 'space-comet' ? (
                          <span aria-hidden className="cm-num">
                            {two(at + 1)}
                          </span>
                        ) : null}
                        <button type="button" onClick={() => openProduct(product.id)} className={`tpl-open ${p}-name text-start`}>
                          {product.name}
                        </button>
                        {look.describe ? <Description product={product} lines={look.describe} className={`${p}-desc`} /> : null}
                        <span className={`${p}-meta`}>
                          <Price product={product} className={`${p}-price`} />
                          <Badges product={product} className={`${p}-badges`} />
                          <QuickAction product={product} variant={look.add} className={`${p}-add relative z-[2]`} onAdded={click} />
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
        {motif === 'space-count' && categories.length > 0 ? (
          <div aria-hidden className="sc-lift">
            <i className="sc-plume" />
            <b dir="ltr">T-{two(0)}</b>
          </div>
        ) : null}
      </main>
    </div>
  );
}

/** The Prayer Beads (kind `spine`, the family's trial). */
export function SpineBody() {
  return <SpineFamily motif="spine" />;
}
/** The Countdown (kind `space-count`). */
export function SpaceCountBody() {
  return <SpineFamily motif="space-count" />;
}
/** Newroz Fire (kind `newroz`). */
export function NewrozBody() {
  return <SpineFamily motif="newroz" />;
}
/** Hawraman Klash (kind `klash`). */
export function KlashBody() {
  return <SpineFamily motif="klash" />;
}
/** The Dengbêj (kind `dengbej`). */
export function DengbejBody() {
  return <SpineFamily motif="dengbej" />;
}
/** Meteor Shower (kind `space-comet`). */
export function SpaceCometBody() {
  return <SpineFamily motif="space-comet" />;
}
/** The Manuscript (kind `manus`). */
export function ManusBody() {
  return <SpineFamily motif="manus" />;
}
