'use client';

import type { CSSProperties } from 'react';
import { formatCount } from '@/server/domain/money';
import { useApp } from '@/ui/AppProviders';
import { useTemplate } from '../context';
import { SaleChip } from '../parts';
import { hueAt } from './shared/hue';
import { IconDish } from './shared/IconDish';
import { SectionStrip, ShapeHeading } from './shared/SectionStrip';
import './shared/shapes.css';
import './fridge.css';

/** The hues (degrees) of the lid stripes, spread around the wheel so neighbouring shelves differ; a seventh starts again. */
const HUES = [352, 28, 150, 205, 265, 48] as const;

/** The hue (in degrees) of the nth shelf's lid stripe. */
export function shelfHue(index: number): number {
  return hueAt(HUES, index);
}

/**
 * The Fridge (spec 2026-10-26-menu-styles-in-templates-design.md, the mockup layout-2-frg). The menu is the inside of a
 * fridge: every section is a glass shelf (a glass rail under its rows) with a label above it (the shelf's number, its
 * name and its dish count in the menu's numerals); every dish is a container, two a row: a coloured lid on top, a big
 * square photo with the price on a yellow sticker, the name below and the add button beside it. A strip of coloured
 * magnets stays at the top and jumps, lighting the shelf in view. All shelves are on the page, so the template's own
 * jump and `#cat-<slug>` scrolling reach them.
 */
export function FridgeBody() {
  const { t, locale, tenant } = useApp();
  const { categories, byCategory } = useTemplate();
  const n = (value: number) => formatCount(value, locale, tenant.numeralSystem);

  return (
    <div className="tpl-body" data-body="fridge">
      <SectionStrip marker="doors" prefix="fr" className="fr-doors" chip="fr-door" chipStyle={(_, index) => ({ '--s-h': shelfHue(index) }) as CSSProperties}>
        {(category) => <span className="fr-door-label">{category.name}</span>}
      </SectionStrip>
      <main id="menu" className="min-w-0">
        {categories.map((category, index) => {
          const products = byCategory.get(category.id) ?? [];
          return (
            <section
              key={category.id}
              id={`cat-${category.slug}`}
              aria-labelledby={`h-${category.slug}`}
              data-shelf={n(index + 1)}
              style={{ '--s-h': shelfHue(index) } as CSSProperties}
              className="tpl-section tpl-tall-last fr-shelf"
            >
              <ShapeHeading id={`h-${category.slug}`} name={category.name} label={t('tpl.frg.shelf', { n: n(index + 1) })} count={n(products.length)} className="fr-head" title="fr-frost" />
              <ul className="fr-row">
                {products.map((product, at) => (
                  <IconDish
                    key={product.id}
                    product={product}
                    prefix="fr"
                    suffix="fridge"
                    cell="fr-jar tpl-rise"
                    head="fr-glass"
                    price="fr-lid"
                    pricePlace="head"
                    media="cover"
                    inPhoto={<SaleChip product={product} className="fr-off" />}
                    sizes="(min-width: 640px) 260px, 50vw"
                    priority={index === 0 && at < 6}
                    order={Math.min(index * 2 + at, 8)}
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
