'use client';

import { formatCount } from '@/server/domain/money';
import { useApp } from '@/ui/AppProviders';
import { useTemplate } from '../context';
import { QuickAction } from '../parts';
import { roofOf, windowState } from './citadel-skyline';
import { PhotoCard } from './shared/PhotoCard';
import { usePlaceOf } from './shared/usePlaceOf';
import { SectionStrip, ShapeHeading } from './shared/SectionStrip';
import './shared/shapes.css';
import './citadel.css';

/**
 * Erbil Citadel (spec 2026-10-26-menu-styles-in-templates-design.md). A sunset over the citadel mound. The sticky strip
 * is a skyline: a row of houses under a dusk sky, each with a roof of its own (a parapet, a dome, a minaret) and one
 * window that is a section, numbered, one tap from its section. The windows light as the guest scrolls: those of the
 * sections passed are lit, the section in view brightest, the rest dark, and a caption in the sky names that section.
 * With many sections the row scrolls sideways, keeping the lit window in view. Below, each section is a terrace: an
 * arched banner, a step, then a wider panel with the dishes as arched-window cards, three across: an arch-topped photo
 * with the name and the price under it, and the add on the photo's corner. All sections are on the page, so the
 * template's own jump and `#cat-<slug>` scrolling reach them. No motion beyond the windows' light easing in.
 */
export function CitadelBody() {
  const { locale, tenant } = useApp();
  const { categories, byCategory, activeId } = useTemplate();
  const n = (value: number) => formatCount(value, locale, tenant.numeralSystem);
  // Numbers, roofs and the lit window go by the section's place in the full menu, so a search never renumbers them.
  const placeOf = usePlaceOf();
  const lit = categories.find((category) => category.id === activeId);
  const shown = lit ?? categories[0];
  const activeAt = lit ? placeOf(lit) : -1;

  return (
    <div className="tpl-body" data-body="citadel">
      <SectionStrip
        marker="skyline"
        prefix="ct"
        className="ct-strip"
        chip="ct-window"
        lead={
          <p aria-hidden data-caption className="ct-caption">
            {shown?.name}
          </p>
        }
      >
        {(category) => (
          <>
            <span aria-hidden data-roof={roofOf(placeOf(category))} className="ct-roof" />
            <span aria-hidden data-pane={windowState(placeOf(category), activeAt)} className="ct-pane">
              {n(placeOf(category) + 1)}
            </span>
            <span className="sr-only">{category.name}</span>
          </>
        )}
      </SectionStrip>
      <main id="menu" className="min-w-0">
        {categories.map((category, index) => {
          const products = byCategory.get(category.id) ?? [];
          return (
            <section key={category.id} id={`cat-${category.slug}`} aria-labelledby={`h-${category.slug}`} className="tpl-section tpl-tall-last ct-terrace">
              <ShapeHeading id={`h-${category.slug}`} name={category.name} label={n(placeOf(category) + 1)} count={n(products.length)} className="ct-head" title="ct-title tpl-banner" />
              <ul className="ct-grid">
                {products.map((product, at) => (
                  <PhotoCard
                    key={product.id}
                    product={product}
                    prefix="ct"
                    suffix="citadel"
                    className="ct-card"
                    sizes="(min-width: 1024px) 200px, (min-width: 640px) 25vw, 33vw"
                    priority={index < 2 && at < 6}
                    add={<QuickAction product={product} variant="icon" className="tpl-rim-add ct-add" />}
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
