'use client';

import { formatCount } from '@/server/domain/money';
import { useApp } from '@/ui/AppProviders';
import { useTemplate } from '../context';
import { QuickAction } from '../parts';
import { BIRDS, SCENE, sceneWindows } from './citadel-skyline';
import { PhotoCard } from './shared/PhotoCard';
import { usePlaceOf } from './shared/usePlaceOf';
import { SectionStrip, ShapeHeading } from './shared/SectionStrip';
import './shared/shapes.css';
import './citadel.css';

/**
 * Erbil Citadel (poster kurd-arab-cit of the 35 mockups; spec 2026-10-26-menu-styles-in-templates-design.md). A sunset
 * over the citadel. The page opens on the scene: a dusk sky, the citadel mound with its wall and the houses on it, and
 * their windows lighting one after another, with a flight of birds crossing once (it plays once, in under five seconds,
 * and is still after; off with less motion, the windows simply lit). Under it a sticky strip of flat tabs (one per
 * section, the section's name, the one in view dark) jumps. Each section is a centred heading over a two-column grid of
 * arched cards: a card of citadel brick whose top is an arch, the dish's photo in a lighter arch inside it, the name
 * centred under it, and the price and the add on a row. The whole card opens the dish. All sections are on the page, so
 * the template's own jump and `#cat-<slug>` scrolling reach them.
 */
export function CitadelBody() {
  const { locale, tenant } = useApp();
  const { categories, byCategory } = useTemplate();
  const n = (value: number) => formatCount(value, locale, tenant.numeralSystem);
  // Numbers go by the section's place in the full menu, so a search never renumbers them.
  const placeOf = usePlaceOf();

  return (
    <div className="tpl-body" data-body="citadel">
      <Scene />
      <SectionStrip marker="tabs" prefix="ct" className="ct-strip" chip="ct-tab">
        {(category) => <span className="ct-tab-name">{category.name}</span>}
      </SectionStrip>
      <main id="menu" className="min-w-0">
        {categories.map((category, index) => {
          const products = byCategory.get(category.id) ?? [];
          return (
            <section key={category.id} id={`cat-${category.slug}`} aria-labelledby={`h-${category.slug}`} className="tpl-section tpl-tall-last ct-terrace">
              <ShapeHeading id={`h-${category.slug}`} name={category.name} label={n(placeOf(category) + 1)} count={n(products.length)} className="ct-head" title="ct-title" />
              <ul className="ct-grid">
                {products.map((product, at) => (
                  <PhotoCard
                    key={product.id}
                    product={product}
                    prefix="ct"
                    suffix="citadel"
                    className="ct-card"
                    sizes="(min-width: 1024px) 220px, (min-width: 640px) 25vw, 45vw"
                    priority={index < 1 && at < 4}
                    addOnBar
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

/** The scene: the mound and the wall with its houses, the windows that light one after another, and the birds. Decoration only. */
function Scene() {
  return (
    <div aria-hidden className="ct-hero">
      {BIRDS.map((bird, at) => (
        <i key={at} className="ct-bird" style={{ insetBlockStart: bird.top, animationDelay: `${bird.delay}ms`, ['--ct-fly' as string]: `${bird.ms}ms` }} />
      ))}
      <svg className="ct-castle" viewBox={`0 0 ${SCENE.width} ${SCENE.height}`} preserveAspectRatio="none" focusable="false">
        <path className="ct-mound" d="M0 150 L0 120 Q 60 100 50 96 L 50 52 L 380 48 L 380 96 Q 380 104 430 118 L430 150 Z" />
        <path className="ct-wall" d="M50 52 L 66 44 L 92 50 L 118 40 L 146 48 L 172 38 L 200 46 L 228 36 L 256 44 L 286 38 L 314 46 L 342 40 L 380 48 Z" />
        <rect className="ct-wall" x="198" y="18" width="18" height="30" />
        <path className="ct-wall" d="M196 18 L207 6 L218 18 Z" />
        {sceneWindows().map((window) => (
          <rect key={`${window.x}-${window.y}`} data-window={window.row} className="ct-win" x={window.x} y={window.y} width={window.w} height={window.h} rx="1" style={{ animationDelay: `${window.delay}ms` }} />
        ))}
        <path className="ct-front" d="M0 150 L0 134 Q 215 112 430 134 L430 150 Z" />
      </svg>
    </div>
  );
}
