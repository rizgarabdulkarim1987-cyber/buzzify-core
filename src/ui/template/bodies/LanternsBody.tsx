'use client';

import type { CSSProperties } from 'react';
import { formatCount } from '@/server/domain/money';
import { useApp } from '@/ui/AppProviders';
import { useTemplate } from '../context';
import { QuickAction } from '../parts';
import { FLAGS, FLICKER_MS, FLICKER_TIMES, GLASS, LANTERNS, SWAY_MS, SWAY_TIMES, flagColour } from './lanterns-night';
import { PhotoCard } from './shared/PhotoCard';
import { usePlaceOf } from './shared/usePlaceOf';
import { SectionStrip, ShapeHeading } from './shared/SectionStrip';
import './shared/shapes.css';
import './lanterns.css';

/**
 * Ramadan Nights (poster kurd-arab-ram of the 35 mockups; spec 2026-10-26-menu-styles-in-templates-design.md). A night
 * sky. The page opens on the scene: bunting of coloured flags along the top, a crescent moon and four lanterns hanging
 * on cords, which sway and flicker a few times and then hang still (off with less motion). Under it a sticky strip of
 * round-edged pills (one per section, the section's name, the one in view filled with gold) jumps. Each section is a
 * centred gold heading over a two-column grid of arched cards: a navy card edged in gold whose top is an arch, the dish's
 * photo in an arch inside it, the name centred under it, and the price and the add on a row. The whole card opens the
 * dish. All sections are on the page, so the template's own jump and `#cat-<slug>` scrolling reach them.
 */
export function LanternsBody() {
  const { locale, tenant } = useApp();
  const { categories, byCategory } = useTemplate();
  const n = (value: number) => formatCount(value, locale, tenant.numeralSystem);
  // Numbers go by the section's place in the full menu, so a search never renumbers them.
  const placeOf = usePlaceOf();

  return (
    <div className="tpl-body" data-body="lanterns">
      <Scene />
      <SectionStrip marker="pills" prefix="rm" className="rm-strip" chip="rm-pill">
        {(category) => <span className="rm-pill-name">{category.name}</span>}
      </SectionStrip>
      <main id="menu" className="min-w-0">
        {categories.map((category, index) => {
          const products = byCategory.get(category.id) ?? [];
          return (
            <section key={category.id} id={`cat-${category.slug}`} aria-labelledby={`h-${category.slug}`} className="tpl-section tpl-tall-last rm-niche">
              <ShapeHeading id={`h-${category.slug}`} name={category.name} label={n(placeOf(category) + 1)} count={n(products.length)} className="rm-head" title="rm-title" />
              <ul className="rm-grid">
                {products.map((product, at) => (
                  <PhotoCard
                    key={product.id}
                    product={product}
                    prefix="rm"
                    suffix="lanterns"
                    className="rm-card"
                    sizes="(min-width: 1024px) 220px, (min-width: 640px) 25vw, 45vw"
                    priority={index < 1 && at < 4}
                    addOnBar
                    add={<QuickAction product={product} variant="icon" className="tpl-rim-add rm-add" />}
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

/** The scene: bunting, a crescent moon and four hanging lanterns. Decoration only; its colours that are not the palette's are set here. */
function Scene() {
  const scene = {
    '--rm-glass-core': GLASS.core,
    '--rm-glass-mid': GLASS.mid,
    '--rm-glass-edge': GLASS.edge,
    '--rm-glass-halo': GLASS.halo,
    '--rm-glass-cap': GLASS.cap,
    '--rm-sway': `${SWAY_MS}ms`,
    '--rm-sway-times': SWAY_TIMES,
    '--rm-flicker': `${FLICKER_MS}ms`,
    '--rm-flicker-times': FLICKER_TIMES,
  } as CSSProperties;
  return (
    <div aria-hidden className="rm-hero" style={scene}>
      <div className="rm-garland">
        {Array.from({ length: FLAGS }, (_, at) => (
          <i key={at} style={{ color: flagColour(at) }} />
        ))}
      </div>
      <i className="rm-moon" />
      {LANTERNS.map((lantern) => (
        <div key={lantern.at} className="rm-lan" style={{ insetInlineStart: `${lantern.at}%`, ['--rm-cord' as string]: `${lantern.cord}px`, animationDelay: `-${lantern.swing}ms` }}>
          <b />
        </div>
      ))}
    </div>
  );
}

