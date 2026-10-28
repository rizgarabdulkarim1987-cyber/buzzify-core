'use client';

import { useRef, type CSSProperties } from 'react';
import { formatCount } from '@/server/domain/money';
import { useApp } from '@/ui/AppProviders';
import { useTemplate } from '../context';
import { SaleChip } from '../parts';
import { bandColour, inkOf, inkOn } from './ink-bands';
import { IconDish } from './shared/IconDish';
import { ShapeHeading } from './shared/SectionStrip';
import { useKeepInView } from './shared/useKeepInView';
import { useOnceInView } from './shared/useOnceInView';
import { usePlaceOf } from './shared/usePlaceOf';
import { useInkSplash } from './useInkSplash';
import './shared/shapes.css';
import './ink.css';

/**
 * Section Ink (the motion-ink mockup, spec 2026-10-26-menu-styles-in-templates-design.md). A dark menu where every section
 * has an ink colour of its own: a strip of pills outlined in their colour (the lit one filled), each section's name set
 * large in its colour (it rises into place the first time the section is seen), and the dishes as cards on the menu's own
 * card colour with a coloured top edge, two across on a phone: a square photo, the name, and the price in the ink with a
 * round add in it. The signature motion: tapping a pill pours the section's colour over the screen from the finger, the
 * page jumps to the section while it is covered, and the colour fades (`useInkSplash`). The ink is pushed to read on the
 * palette (`inkOf`). All sections are on the page, so the template's own jump and `#cat-<slug>` scrolling reach them.
 */
export function InkBody() {
  const { t, locale, tenant } = useApp();
  const { categories, byCategory, reduced, design, activeId } = useTemplate();
  const n = (value: number) => formatCount(value, locale, tenant.numeralSystem);
  const root = useRef<HTMLDivElement>(null);
  const strip = useRef<HTMLUListElement>(null);
  useOnceInView(root, reduced, { item: 'data-band', id: 'data-id', mark: 'data-in', line: 0.88 });
  useKeepInView(strip, activeId, 'x', reduced);
  const splash = useInkSplash(reduced);
  const placeOf = usePlaceOf();
  // By the section's place in the full menu, so a search never recolours the sections it leaves.
  const inkFor = (category: { id: string }) => inkOf(bandColour(placeOf(category)), design.palette);
  const colours = (category: { id: string }) => ({ '--band': inkFor(category), '--band-ink': inkOn(inkFor(category)) }) as CSSProperties;
  // The jump the splash covers: instant (the screen is hidden), then the heading takes focus, as the template's own jump does.
  const land = (slug: string) => {
    const target = document.getElementById(`cat-${slug}`);
    if (!target) return;
    target.scrollIntoView({ behavior: 'instant', block: 'start' });
    target.querySelector<HTMLElement>('[data-heading]')?.focus({ preventScroll: true });
  };

  return (
    <div className="tpl-body" data-body="ink" ref={root}>
      <nav aria-label={t('menu.categories')} data-chips className="tpl-strip-sticky">
        <ul ref={strip} className="scroll-hidden tpl-strip-list ik-strip-list">
          {categories.map((category) => (
            <li key={category.id}>
              <button
                type="button"
                data-category={category.id}
                aria-current={category.id === activeId ? 'true' : undefined}
                onClick={(event) => {
                  splash(event.currentTarget, inkFor(category), () => land(category.slug));
                }}
                className="ik-chip"
                style={colours(category)}
              >
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
            <section key={category.id} id={`cat-${category.slug}`} aria-labelledby={`h-${category.slug}`} data-band data-id={category.id} className="tpl-section tpl-tall-last ik-band" style={colours(category)}>
              <ShapeHeading id={`h-${category.slug}`} name={category.name} count={n(products.length)} className="ik-head" title="ik-title" />
              <ul className="ik-grid">
                {products.map((product, at) => (
                  <IconDish
                    key={product.id}
                    product={product}
                    prefix="ik"
                    suffix="ink"
                    cell="ik-card"
                    head="ik-head-photo"
                    price="ik-price"
                    pricePlace="after"
                    media="cover"
                    plate
                    inPhoto={<SaleChip product={product} className="ik-off" />}
                    sizes="(min-width: 1024px) 260px, (min-width: 640px) 30vw, 50vw"
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
