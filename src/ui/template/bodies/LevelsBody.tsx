'use client';

import type { CSSProperties } from 'react';
import { formatCount } from '@/server/domain/money';
import { useApp } from '@/ui/AppProviders';
import { useTemplate } from '../context';
import { SaleChip } from '../parts';
import { hueAt, SHAPE_HUES } from './shared/hue';
import { IconDish } from './shared/IconDish';
import { SectionStrip, ShapeHeading } from './shared/SectionStrip';
import './shared/shapes.css';
import './levels.css';

/** The hue (in degrees) of the nth world: the shared set, so neighbours differ; a seventh starts again. */
export function worldHue(index: number): number {
  return hueAt(SHAPE_HUES, index);
}

/** Level nodes in a row of the road. */
const PER_ROW = 3;

export interface LevelSpot {
  row: number;
  /** The grid column (from 0, from the start side): every other row runs back, so the road winds. */
  col: number;
  /** Where the road from this node goes: `across` to the next node in the row, `down` to the row below, `none` at the end. */
  link: 'across' | 'down' | 'none';
}

/** Where the nth of `total` nodes of a world sits, and which way its road leaves it. */
export function levelSpot(index: number, total: number): LevelSpot {
  const row = Math.floor(index / PER_ROW);
  const along = index % PER_ROW;
  const col = row % 2 === 0 ? along : PER_ROW - 1 - along;
  const link = index >= total - 1 ? 'none' : along === PER_ROW - 1 ? 'down' : 'across';
  return { row, col, link };
}

/**
 * Game Levels (spec 2026-10-26-menu-styles-in-templates-design.md). The menu is a game map: every section is a world
 * with a ribbon banner (its number in the menu's numerals, its name and its dish count), every dish a round level node
 * (the photo in a ringed circle, the level number on it, the price on a pill under it, the name below) on a dashed road
 * that winds back and forth across the world, three nodes a row, so many dishes are on screen at once. A strip of worlds
 * stays at the top and jumps, lighting the world in view. All worlds are on the page, so the template's own jump and
 * `#cat-<slug>` scrolling reach them.
 */
export function LevelsBody() {
  const { t, locale, tenant } = useApp();
  const { categories, byCategory } = useTemplate();
  const n = (value: number) => formatCount(value, locale, tenant.numeralSystem);

  return (
    <div className="tpl-body" data-body="levels">
      <SectionStrip marker="worlds" prefix="lv" className="lv-worlds" chip="lv-world-chip" chipStyle={(_, index) => ({ '--w-h': worldHue(index) }) as CSSProperties}>
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
              style={{ '--w-h': worldHue(index) } as CSSProperties}
              className="tpl-section tpl-tall-last lv-world"
            >
              <ShapeHeading id={`h-${category.slug}`} name={category.name} label={t('tpl.lvl.world', { n: n(index + 1) })} count={n(products.length)} className="lv-head" title="lv-banner" />
              <ul className="lv-road">
                {products.map((product, at) => {
                  const spot = levelSpot(at, products.length);
                  return (
                    <IconDish
                      key={product.id}
                      product={product}
                      prefix="lv"
                      suffix="levels"
                      cell="lv-node tpl-rise"
                      head="lv-disc"
                      price="lv-pill"
                      pricePlace="below"
                      sizes="96px"
                      priority={index === 0 && at < 6}
                      order={Math.min(index * 3 + at, 8)}
                      cellProps={{ 'data-link': spot.link, 'data-back': spot.row % 2 === 1 ? '' : undefined }}
                      style={{ gridRow: spot.row + 1, gridColumn: spot.col + 1 }}
                      extras={
                        <>
                          <span aria-hidden className="lv-level">
                            {n(at + 1)}
                          </span>
                          <SaleChip product={product} className="lv-off" />
                        </>
                      }
                    />
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
