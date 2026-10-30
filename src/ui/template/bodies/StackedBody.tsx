'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { formatCount } from '@/server/domain/money';
import { useApp } from '@/ui/AppProviders';
import { useTemplate } from '../context';
import { SaleChip } from '../parts';
import { IconDish } from './shared/IconDish';
import { useKeepInView } from './shared/useKeepInView';
import { usePlaceOf } from './shared/usePlaceOf';
import { stackHue } from './stacked-sheets';
import { useSheetStack } from './useSheetStack';
import './shared/shapes.css';
import './stacked.css';

/**
 * Stacked Sheets (the motion-stk mockup, spec 2026-10-26-menu-styles-in-templates-design.md). A dark page with a sticky strip
 * of pills (the lit one white), and every section a sheet of coloured paper (a pastel of a hue of its own, rounded top
 * corners) holding its name, its dish count and its dishes as cards two across: a square photo, the name, the price
 * and a round add. The sheets are `position: sticky`: scrolling, the next sheet slides over the one in view, which
 * shrinks a little and darkens as it is covered (`useSheetStack`: transform and opacity only, nothing when the guest
 * prefers less motion). A sheet taller than the screen scrolls until its end shows before the next covers it. All sheets are on
 * the page; the strip (and the template's own jump) takes the page to a sheet's place in the flow, so a sheet that is
 * stuck above can be reached again.
 */
export function StackedBody() {
  const { t, locale, tenant } = useApp();
  const { categories, byCategory, reduced, setCategoryOpener, jumpTo } = useTemplate();
  const n = (value: number) => formatCount(value, locale, tenant.numeralSystem);
  const root = useRef<HTMLDivElement>(null);
  const strip = useRef<HTMLUListElement>(null);
  const placeOf = usePlaceOf();
  const [read, setRead] = useState<string | null>(null);
  // The sheet being read; the first before the page is scrolled and while a search hides the one that was lit.
  const lit = categories.some((category) => category.id === read) ? read : categories[0]?.id;
  const jump = useSheetStack(root, reduced, setRead);
  useKeepInView(strip, lit ?? null, 'x', reduced);
  useEffect(() => {
    setCategoryOpener(jump);
    return () => setCategoryOpener(null);
  }, [setCategoryOpener, jump]);
  // A sheet's hue follows its place in the whole menu, so a search does not recolour the sheets.
  const hueOf = (category: { id: string }) => ({ '--h': stackHue(placeOf(category)) }) as CSSProperties;

  return (
    <div ref={root} className="tpl-body" data-body="stacked">
      <nav aria-label={t('menu.categories')} data-chips className="tpl-strip-sticky sk-bar">
        <ul ref={strip} className="scroll-hidden tpl-strip-list sk-strip-list">
          {categories.map((category) => (
            <li key={category.id}>
              <button type="button" data-category={category.id} aria-current={category.id === lit ? 'true' : undefined} onClick={() => jumpTo(category.id)} className="sk-chip">
                <span>{category.name}</span>
              </button>
            </li>
          ))}
        </ul>
      </nav>
      <main id="menu" className="min-w-0">
        {categories.map((category, index) => {
          const products = byCategory.get(category.id) ?? [];
          return (
            <section key={category.id} id={`cat-${category.slug}`} aria-labelledby={`h-${category.slug}`} data-sheet={category.id} style={{ ...hueOf(category), '--i': index } as CSSProperties} className="tpl-section tpl-tall-last sk-sheet">
              <div tabIndex={-1} data-heading className="sk-head outline-none">
                <h2 id={`h-${category.slug}`} className="tpl-display sk-title">
                  <span>{category.name}</span>
                  <small data-count aria-hidden className="sk-count">
                    {t('tpl.book.dishes', { count: products.length, n: n(products.length) })}
                  </small>
                </h2>
              </div>
              <ul className="sk-grid">
                {products.map((product, at) => (
                  <IconDish
                    key={product.id}
                    product={product}
                    prefix="sk"
                    suffix="stacked"
                    cell="sk-card"
                    head="sk-frame"
                    price="sk-price"
                    pricePlace="after"
                    media="cover"
                    plate
                    inPhoto={<SaleChip product={product} className="sk-off" />}
                    sizes="(min-width: 640px) 300px, 50vw"
                    priority={index === 0 && at < 4}
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
