'use client';

import type { CSSProperties } from 'react';
import { contrastRatio, hexOfHsl } from '@/lib/palette';
import { formatCount } from '@/server/domain/money';
import { useApp } from '@/ui/AppProviders';
import { useTemplate } from '../context';
import type { MenuProductView } from '@/server/data/menu-view';
import { Price, ProductMedia, QuickAction, SaleChip } from '../parts';
import { hueAt, SHAPE_HUES } from './shared/hue';
import { SectionStrip, ShapeHeading } from './shared/SectionStrip';
import './shared/shapes.css';
import './levels.css';

/** The hue (in degrees) of the nth world: the shared set, so neighbours differ; a seventh starts again. */
export function worldHue(index: number): number {
  return hueAt(SHAPE_HUES, index);
}

/** The solid fill of the nth world's number, its "World N" label and its level badges: the world's hue, deep. */
export function worldFill(index: number): string {
  return hexOfHsl({ h: worldHue(index), s: 80, l: 36 });
}

/** The ink on that fill: white or near black, whichever reads better on the hue (green and yellow take the dark). */
export function worldInk(index: number): string {
  const fill = worldFill(index);
  return contrastRatio('#FFFFFF', fill) >= contrastRatio('#111111', fill) ? '#FFFFFF' : '#111111';
}

/** A world's colours as custom properties: its hue for the washes and rings, the fill and ink pair for text. */
function worldStyle(index: number): CSSProperties {
  return { '--w-h': worldHue(index), '--w-fill': worldFill(index), '--w-ink': worldInk(index) } as CSSProperties;
}

export interface LevelSpot {
  /** Where on the road the node sits: 0 start edge, 1 middle, 2 end edge, 3 middle, then the road winds back. */
  step: 0 | 1 | 2 | 3;
  /** Which way the name card opens from the medallion: toward the end side or toward the start side. */
  card: 'end' | 'start';
}

/**
 * Where the nth level sits: one dish a row on a road that winds from the start edge through the middle to the end edge
 * and back (the mockup's S-curve). A node on the road's first half opens its card toward the end side, on the second
 * half toward the start side, so the card always has room.
 */
export function levelSpot(index: number): LevelSpot {
  const step = (index % 4) as LevelSpot['step'];
  return { step, card: step < 2 ? 'end' : 'start' };
}

/**
 * Game Levels (spec 2026-10-26-menu-styles-in-templates-design.md, the mockup layout-2-lvl). The menu is a game map:
 * every section is a world, a saturated band in its own hue with a ribbon banner (its number in the menu's numerals, its
 * name and its dish count); every dish is a level on a winding dotted road: a big round medallion (the photo in a ringed
 * circle under three stars, the level number on its rim) with a name-and-price card beside it holding the add button.
 * A strip of worlds stays at the top and jumps, lighting the world in view. All worlds are on the page, so the
 * template's own jump and `#cat-<slug>` scrolling reach them.
 */
export function LevelsBody() {
  const { t, locale, tenant } = useApp();
  const { categories, byCategory } = useTemplate();
  const n = (value: number) => formatCount(value, locale, tenant.numeralSystem);

  return (
    <div className="tpl-body" data-body="levels">
      <SectionStrip marker="worlds" prefix="lv" className="lv-worlds" chip="lv-world-chip" chipStyle={(_, index) => worldStyle(index)}>
        {(category, index) => (
          <>
            <span aria-hidden className="lv-number">
              {n(index + 1)}
            </span>
            <span className="lv-label">{category.name}</span>
          </>
        )}
      </SectionStrip>
      <main id="menu" className="min-w-0">
        {categories.map((category, index) => {
          const products = byCategory.get(category.id) ?? [];
          return (
            <section
              key={category.id}
              id={`cat-${category.slug}`}
              aria-labelledby={`h-${category.slug}`}
              data-world={n(index + 1)}
              style={worldStyle(index)}
              className="tpl-section tpl-tall-last lv-world"
            >
              <ShapeHeading id={`h-${category.slug}`} name={category.name} label={t('tpl.lvl.world', { n: n(index + 1) })} count={n(products.length)} className="lv-head" title="lv-banner" />
              <ul className="lv-road">
                {products.map((product, at) => (
                  <Level key={product.id} product={product} level={n(at + 1)} spot={levelSpot(at)} priority={index === 0 && at < 6} order={Math.min(index * 3 + at, 8)} />
                ))}
              </ul>
            </section>
          );
        })}
      </main>
    </div>
  );
}

function Level({ product, level, spot, priority, order }: { product: MenuProductView; level: string; spot: LevelSpot; priority: boolean; order: number }) {
  const { openProduct } = useTemplate();
  return (
    <li data-row data-step={spot.step} data-card={spot.card} className="lv-node tpl-rise" style={{ '--i': order } as CSSProperties}>
      <div className="lv-disc">
        <div data-photo className="lv-photo tpl-fill-media">
          <ProductMedia product={product} suffix="levels" sizes="88px" priority={priority} className="lv-img" rounded={false} />
        </div>
        <span aria-hidden className="lv-level">
          {level}
        </span>
      </div>
      <div className="lv-card">
        <button type="button" onClick={() => openProduct(product.id)} className="tpl-open tpl-dish-name lv-name">
          {product.name}
        </button>
        <div className="lv-line">
          <Price product={product} className="tpl-price-tight lv-pill" />
          <SaleChip product={product} className="lv-off" />
        </div>
        <QuickAction product={product} variant="icon" className="tpl-rim-add lv-add relative z-[2]" />
      </div>
    </li>
  );
}
