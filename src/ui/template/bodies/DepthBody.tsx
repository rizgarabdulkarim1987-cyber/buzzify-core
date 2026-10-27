'use client';

import { useRef } from 'react';
import { formatCount } from '@/server/domain/money';
import { useApp } from '@/ui/AppProviders';
import { useTemplate } from '../context';
import { SaleChip } from '../parts';
import { IconDish } from './shared/IconDish';
import { SectionStrip, ShapeHeading } from './shared/SectionStrip';
import { useDepthShift } from './useDepthShift';
import './shared/shapes.css';
import './depth.css';

/**
 * Scroll Depth (spec 2026-10-26-menu-styles-in-templates-design.md). A deep gallery of framed windows: every dish is a big
 * frame (three across on a phone; one wide card on a desktop) whose photo is larger than the frame and
 * shifts inside it as the page scrolls, with a caption bar (the name, the price) under it. Every section is titled by an
 * oversized outlined numeral (in the menu's numerals), its name and its dish count; a sticky strip of chips jumps. The
 * shift is a CSS scroll-driven animation where the browser has them, else a small scroll fallback (`useDepthShift`) that
 * touches only the frames in view; none of it when the guest prefers less motion. All sections are on the page, so the
 * template's own jump and `#cat-<slug>` scrolling reach them.
 */
export function DepthBody() {
  const { locale, tenant } = useApp();
  const { categories, byCategory, reduced } = useTemplate();
  const root = useRef<HTMLDivElement>(null);
  useDepthShift(root, reduced);
  const n = (value: number) => formatCount(value, locale, tenant.numeralSystem);

  return (
    <div ref={root} className="tpl-body" data-body="depth" data-reduced={reduced ? '' : undefined}>
      <SectionStrip marker="chips" prefix="dp">
        {(category) => <span>{category.name}</span>}
      </SectionStrip>
      <main id="menu" className="min-w-0">
        {categories.map((category, index) => {
          const products = byCategory.get(category.id) ?? [];
          return (
            <section key={category.id} id={`cat-${category.slug}`} aria-labelledby={`h-${category.slug}`} data-depth={n(index + 1)} className="tpl-section tpl-tall-last dp-section">
              <ShapeHeading id={`h-${category.slug}`} name={category.name} label={n(index + 1)} count={n(products.length)} className="dp-head" title="dp-title" />
              <ul className="dp-grid">
                {products.map((product, at) => (
                  <IconDish
                    key={product.id}
                    product={product}
                    prefix="dp"
                    suffix="depth"
                    cell="dp-card tpl-rise"
                    head="dp-frame"
                    price="dp-price"
                    pricePlace="below"
                    media="cover"
                    inPhoto={<SaleChip product={product} className="dp-off" />}
                    addInPhoto
                    sizes="(min-width: 640px) 640px, 33vw"
                    priority={index === 0 && at < 4}
                    order={Math.min(index * 3 + at, 8)}
                  />
                ))}
              </ul>
            </section>
          );
        })}
      </main>
    </div>
  );
}
