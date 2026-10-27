'use client';

import type { CSSProperties } from 'react';
import { formatCount } from '@/server/domain/money';
import { useApp } from '@/ui/AppProviders';
import { useTemplate } from '../context';
import { dropOf } from './lanterns-night';
import { RowDish } from './shared/RowDish';
import { usePlaceOf } from './shared/usePlaceOf';
import { SectionStrip, ShapeHeading } from './shared/SectionStrip';
import './shared/shapes.css';
import './lanterns.css';

/**
 * Ramadan Nights (spec 2026-10-26-menu-styles-in-templates-design.md). A night sky. The sticky strip is a row of lanterns
 * hanging from a rope on strings of a few lengths: each lantern is a section, its numeral in its window and its name
 * under it, one tap from its section. The lantern in view glows and sways a little; the others hang still. With many
 * sections the row scrolls sideways, keeping the lit lantern in view. Below, each section is a niche: a pointed-arch
 * banner with a crescent, its number and its dish count, a lattice band, then the dishes as one list of round-arch
 * cards (an arch-framed photo on one side, the name with a crescent bullet and the price on the other), in two columns
 * on a wide screen. All sections are on the page, so the template's own jump and `#cat-<slug>` scrolling reach them.
 */
export function LanternsBody() {
  const { locale, tenant } = useApp();
  const { categories, byCategory } = useTemplate();
  const n = (value: number) => formatCount(value, locale, tenant.numeralSystem);
  // Drops and numerals go by the section's place in the full menu, so a search never renumbers the lanterns.
  const placeOf = usePlaceOf();

  return (
    <div className="tpl-body" data-body="lanterns">
      <SectionStrip
        marker="lanterns"
        prefix="rm"
        className="rm-strip"
        chip="rm-lantern"
        chipStyle={(category) => ({ '--drop': `${dropOf(placeOf(category))}rem` }) as CSSProperties}
      >
        {(category) => (
          <>
            <span aria-hidden className="rm-hang">
              <i className="rm-string" />
              <i className="rm-cap" />
              <span className="rm-pane">{n(placeOf(category) + 1)}</span>
              <i className="rm-base" />
            </span>
            <span className="rm-label">{category.name}</span>
          </>
        )}
      </SectionStrip>
      <main id="menu" className="min-w-0">
        {categories.map((category, index) => {
          const products = byCategory.get(category.id) ?? [];
          return (
            <section key={category.id} id={`cat-${category.slug}`} aria-labelledby={`h-${category.slug}`} className="tpl-section tpl-tall-last rm-niche">
              <ShapeHeading id={`h-${category.slug}`} name={category.name} label={n(placeOf(category) + 1)} count={n(products.length)} className="rm-head" title="rm-title tpl-banner" lead={<i aria-hidden className="rm-moon" />} />
              <ul className="rm-list">
                {products.map((product, at) => (
                  <RowDish key={product.id} product={product} prefix="rm" suffix="lanterns" sizes="72px" priority={index < 2 && at < 6} iconAdd plate />
                ))}
              </ul>
            </section>
          );
        })}
      </main>
    </div>
  );
}
