'use client';

import { useSyncExternalStore, type CSSProperties } from 'react';
import { mix } from '@/lib/templates/palette';
import type { DesignPalette } from '@/lib/templates/types';
import { formatCount } from '@/server/domain/money';
import { useApp } from '@/ui/AppProviders';
import { useTemplate } from '../context';
import { SaleChip } from '../parts';
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
 * The home screen's surfaces that carry the palette's text, each the template's accent mixed (`share` of it) into the
 * palette's background (`bg`) or raised surface (`raised`): the wallpaper's three stops, the folder band the dish names
 * sit on, the label tile, the dock's backing and its strip. Mixing only a share of the accent into the palette's own
 * ground keeps the text readable whatever accent is picked in Customize, and the dock does not depend on the page's
 * own background.
 */
export const HOMESCREEN_FILLS = {
  wallTop: { share: 0.34, base: 'bg' },
  wallMid: { share: 0.26, base: 'bg' },
  wallEnd: { share: 0.32, base: 'bg' },
  band: { share: 0.26, base: 'raised' },
  tile: { share: 0.22, base: 'bg' },
  dock: { share: 0.22, base: 'bg' },
  strip: { share: 0.26, base: 'raised' },
} as const;

/** The colour of one of those surfaces for a palette, as the page's `color-mix` draws it. */
export function homescreenFill(fill: keyof typeof HOMESCREEN_FILLS, palette: Pick<DesignPalette, 'bg' | 'raised' | 'accent'>): string {
  const { share, base } = HOMESCREEN_FILLS[fill];
  return mix(palette[base], palette.accent, share);
}

/** The surfaces as custom properties on the body (`--hs-band`, `--hs-wall-top`, ...), for homescreen.css. */
const FILL_STYLE = Object.fromEntries(
  Object.entries(HOMESCREEN_FILLS).map(([fill, { share, base }]) => [
    `--hs-${fill.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`,
    `color-mix(in srgb, var(--accent) ${Math.round(share * 100)}%, var(--${base}))`,
  ]),
) as CSSProperties;

/** The minute of the day on this device, as a store snapshot (-1 on the server and in the first client render). */
function subscribeToMinutes(notify: () => void) {
  const timer = window.setInterval(notify, 15_000);
  return () => window.clearInterval(timer);
}
const minuteOfDay = () => {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
};

/**
 * The home screen's clock widget (the mockup's big time on the wallpaper): the device's time in the menu's numerals,
 * drawn after the page has hydrated so the server and the client agree. Decoration only, so it is hidden from readers.
 */
function ClockWidget({ n }: { n: (value: number) => string }) {
  const minutes = useSyncExternalStore(subscribeToMinutes, minuteOfDay, () => -1);
  const pair = (value: number) => `${n(Math.floor(value / 10))}${n(value % 10)}`;
  return (
    <div aria-hidden className="hs-widget">
      <span className="hs-time">
        {minutes < 0 ? null : (
          <>
            <span>{pair(Math.floor(minutes / 60))}</span>
            <span>:</span>
            <span>{pair(minutes % 60)}</span>
          </>
        )}
      </span>
    </div>
  );
}

/**
 * Phone Home Screen (spec 2026-10-26-menu-styles-in-templates-design.md, the mockup layout-2-hom). The menu is a phone's
 * home screen: a clock widget on the wallpaper, then every section as a page of big app icons under its centred name
 * (a rounded square photo, its name below in two lines at most, its price as a red notification badge on the corner),
 * three across on a phone, the pages stacked so all the dishes scroll in one go. A dock of app tiles stays at the top
 * and jumps, lighting the folder in view. All folders are on the page, so the template's own jump and `#cat-<slug>`
 * scrolling reach them.
 */
export function HomescreenBody() {
  const { locale, tenant } = useApp();
  const { categories, byCategory } = useTemplate();
  const n = (value: number) => formatCount(value, locale, tenant.numeralSystem);

  return (
    <div className="tpl-body" data-body="homescreen" style={FILL_STYLE}>
      <ClockWidget n={n} />
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
              <ShapeHeading id={`h-${category.slug}`} name={category.name} count={n(products.length)} className="hs-head" title="hs-title" />
              <ul role="list" className="hs-apps">
                {products.map((product, row) => (
                  <IconDish key={product.id} product={product} prefix="hs" suffix="homescreen" cell="hs-app" head="hs-icon" price="hs-badge" pricePlace="head" extras={<SaleChip product={product} className="hs-off" />} sizes="(min-width: 640px) 104px, 30vw" priority={index === 0 && row < 6} order={Math.min(index * 4 + row, 8)} />
                ))}
              </ul>
            </section>
          );
        })}
      </main>
    </div>
  );
}
