'use client';

import type { CSSProperties } from 'react';
import { formatCount } from '@/server/domain/money';
import { useApp } from '@/ui/AppProviders';
import { useTemplate } from '../context';
import { hueAt, SHAPE_HUES } from './shared/hue';
import { IconDish } from './shared/IconDish';
import { SectionStrip, ShapeHeading } from './shared/SectionStrip';
import './shared/shapes.css';
import './homescreen.css';

/** The hue (in degrees) of the nth dock tile: the shared set, so neighbours differ; a seventh starts again. */
export function appHue(index: number): number {
  return hueAt(SHAPE_HUES, index);
}

/**
 * Phone Home Screen (spec 2026-10-26-menu-styles-in-templates-design.md). The menu is a phone's home screen: every
 * dish is an app icon (a rounded square photo, its name below in two lines at most, its price as a red notification
 * badge on the corner), four across on a phone. Every section is a folder band whose first cell is its label tile (name
 * and dish count in the menu's numerals), so a short section takes one row and the first screen holds several folders.
 * A slim dock of app tiles stays at the top and jumps, lighting the folder in view. All folders are on the page, so the
 * template's own jump and `#cat-<slug>` scrolling reach them.
 */
export function HomescreenBody() {
  const { locale, tenant } = useApp();
  const { categories, byCategory } = useTemplate();
  const n = (value: number) => formatCount(value, locale, tenant.numeralSystem);

  return (
    <div className="tpl-body" data-body="homescreen">
      <SectionStrip marker="dock" prefix="hs" className="hs-dock" chip="hs-tile" chipStyle={(_, index) => ({ '--app-h': appHue(index) }) as CSSProperties}>
        {(category, index) => (
          <>
            <span aria-hidden className="hs-glyph">
              {n(index + 1)}
            </span>
            <span className="hs-label">{category.name}</span>
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
              data-folder={n(index + 1)}
              className="tpl-section tpl-tall-last hs-folder"
            >
              <ul className="hs-apps">
                {/* The folder's label sits in the grid as its first tile; it is not one of the list's dishes. */}
                <li role="none" className="hs-label-tile">
                  <ShapeHeading id={`h-${category.slug}`} name={category.name} count={n(products.length)} className="hs-head" title="hs-title" />
                </li>
                {products.map((product, row) => (
                  <IconDish key={product.id} product={product} prefix="hs" suffix="homescreen" cell="hs-app" head="hs-icon" price="hs-badge" pricePlace="head" sizes="96px" priority={index < 3 && row < 4} order={Math.min(index * 4 + row, 8)} />
                ))}
              </ul>
            </section>
          );
        })}
      </main>
    </div>
  );
}
