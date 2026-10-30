'use client';

import type { CSSProperties } from 'react';
import { formatCount } from '@/server/domain/money';
import { useApp } from '@/ui/AppProviders';
import { useTemplate } from '../context';
import { hueAt } from './shared/hue';
import { RowDish } from './shared/RowDish';
import { SectionStrip, ShapeHeading } from './shared/SectionStrip';
import './shared/shapes.css';
import './metro.css';

/** The hues of the stations (line colours), spread around the wheel so neighbours differ; a ninth station starts again. */
const HUES = [25, 82, 150, 245, 335, 195, 290, 55] as const;

/** The hue (in degrees) of the nth station. */
export function stationHue(index: number): number {
  return hueAt(HUES, index);
}

/**
 * A metro line (spec 2026-10-26-menu-styles-in-templates-design.md). One line runs down the inline-start edge of the page;
 * every section is a station on it, in its own colour, with its name, its number and its dish count (in the menu's
 * numerals), and the dishes hang off the line as stops: photo, name, price and an add button. A route strip of the
 * stations stays at the top and jumps. All stations are on the page, so the template's own jump and `#cat-<slug>`
 * scrolling reach them, and the route lights the station in view.
 */
export function MetroBody() {
  const { t, locale, tenant } = useApp();
  const { categories, byCategory } = useTemplate();
  const n = (value: number) => formatCount(value, locale, tenant.numeralSystem);

  return (
    <div className="tpl-body" data-body="metro">
      <SectionStrip marker="route" prefix="mt" className="mt-route" chip="mt-stop-chip" chipStyle={(_, index) => ({ '--g': stationHue(index) }) as CSSProperties}>
        {(category) => (
          <>
            <i aria-hidden />
            <span>{category.name}</span>
            <b aria-hidden>{n((byCategory.get(category.id) ?? []).length)}</b>
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
              data-station={n(index + 1)}
              className="tpl-section tpl-tall-last mt-station"
              style={{ '--g': stationHue(index) } as CSSProperties}
            >
              <div className="mt-run">
                <ShapeHeading id={`h-${category.slug}`} name={category.name} label={t('tpl.met.station', { n: n(index + 1) })} count={n(products.length)} title="mt-title" />
                <ul className="mt-stops">
                  {products.map((product, row) => (
                    <RowDish key={product.id} product={product} prefix="mt" suffix="metro" sizes="70px" priority={index === 0 && row < 5} order={Math.min(index * 3 + row, 8)} />
                  ))}
                </ul>
              </div>
            </section>
          );
        })}
      </main>
    </div>
  );
}
