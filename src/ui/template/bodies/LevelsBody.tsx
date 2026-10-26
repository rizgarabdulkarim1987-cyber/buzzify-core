'use client';

import type { CSSProperties } from 'react';
import { localDigits } from '@/lib/digits';
import type { MenuProductView } from '@/server/data/menu-view';
import { formatCount } from '@/server/domain/money';
import { useApp } from '@/ui/AppProviders';
import { useTemplate } from '../context';
import { Price, ProductMedia, QuickAction } from '../parts';
import { hueAt } from './shared/hue';
import { SectionStrip, ShapeHeading } from './shared/SectionStrip';
import './shared/shapes.css';
import './levels.css';

/** The hues (degrees) the worlds take in turn, spread around the wheel so neighbours differ; a seventh starts again. */
const HUES = [340, 28, 150, 205, 265, 48] as const;

/** The hue (in degrees) of the nth world. */
export function worldHue(index: number): number {
  return hueAt(HUES, index);
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
                {products.map((product, at) => (
                  <Node key={product.id} product={product} spot={levelSpot(at, products.length)} level={n(at + 1)} priority={index === 0 && at < 6} order={Math.min(index * 3 + at, 8)} />
                ))}
              </ul>
            </section>
          );
        })}
      </main>
    </div>
  );
}

function Node({ product, spot, level, priority, order }: { product: MenuProductView; spot: LevelSpot; level: string; priority: boolean; order: number }) {
  const { t, tenant } = useApp();
  const { openProduct } = useTemplate();
  const off = product.regularPrice !== undefined && product.percentOff ? product.percentOff : 0;
  return (
    <li
      data-row
      data-link={spot.link}
      data-back={spot.row % 2 === 1 ? '' : undefined}
      className="lv-node"
      style={{ gridRow: spot.row + 1, gridColumn: spot.col + 1, '--i': order } as CSSProperties}
    >
      <div className="lv-disc">
        <div data-photo className="lv-photo">
          <ProductMedia product={product} suffix="levels" sizes="96px" priority={priority} className="lv-img" rounded={false} />
        </div>
        <span aria-hidden className="lv-level">
          {level}
        </span>
        {off ? <span className="lv-off tabular-nums">{t('menu.percentOff', { percent: localDigits(String(off), tenant.numeralSystem) })}</span> : null}
        <QuickAction product={product} variant="icon" className="lv-add relative z-[2]" />
      </div>
      <Price product={product} className="tpl-price-tight lv-pill" />
      <button type="button" onClick={() => openProduct(product.id)} className="tpl-open lv-name text-center">
        {product.name}
      </button>
    </li>
  );
}
