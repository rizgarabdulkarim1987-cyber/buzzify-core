'use client';

import { useRef, type CSSProperties } from 'react';
import { formatCount } from '@/server/domain/money';
import { useApp } from '@/ui/AppProviders';
import { useTemplate } from '../context';
import { RowDish } from './shared/RowDish';
import { SectionStrip, ShapeHeading } from './shared/SectionStrip';
import { LANES, temperatureOf, type Temperature } from './temperature';
import { useSteamLive } from './useSteamLive';
import './shared/shapes.css';
import './steam.css';

/**
 * Living Steam (spec 2026-10-26-menu-styles-in-templates-design.md). A menu with a temperature: every section is a rack of
 * wide row cards, each dish's photo in a frame that shows how it is served. A hot dish's frame is warm, with three wisps
 * of steam curling up over the photo; a cold dish's frame is frosted, with beads of dew on it and a slow drip. A dish with
 * no temperature (`temperatureOf`, read from its name and its section's, with no data of its own) gets a plain frame. Each
 * row also says "Hot" or "Cold" in a chip, so the lane is never only a colour. Wide screens lay the rows in two lanes.
 * A sticky strip of chips jumps to a section; all sections are on the page, so the template's own jump scrolling works.
 * The wisps and drips are CSS transform and opacity only, paused for rows off screen (`useSteamLive`) and still for
 * less motion.
 */
export function SteamBody() {
  const { t, locale, tenant } = useApp();
  const { categories, byCategory, reduced } = useTemplate();
  const n = (value: number) => formatCount(value, locale, tenant.numeralSystem);
  const root = useRef<HTMLDivElement>(null);
  useSteamLive(root, reduced);

  const lanes = {
    '--hot-fill': LANES.hot.fill,
    '--hot-ink': LANES.hot.ink,
    '--hot-stripe': LANES.hot.stripe,
    '--cold-fill': LANES.cold.fill,
    '--cold-ink': LANES.cold.ink,
    '--cold-stripe': LANES.cold.stripe,
  } as CSSProperties;

  return (
    <div className="tpl-body" data-body="steam" ref={root} style={lanes}>
      <SectionStrip marker="chips" prefix="stm">
        {(category) => <span>{category.name}</span>}
      </SectionStrip>
      <main id="menu" className="min-w-0">
        {categories.map((category, index) => (
          <section key={category.id} id={`cat-${category.slug}`} aria-labelledby={`h-${category.slug}`} className="tpl-section tpl-tall-last stm-rack">
            <ShapeHeading id={`h-${category.slug}`} name={category.name} count={n((byCategory.get(category.id) ?? []).length)} className="stm-head" title="stm-title" />
            <ul className="stm-rows">
              {(byCategory.get(category.id) ?? []).map((product, at) => {
                const temperature = temperatureOf(product, category);
                return (
                  <RowDish
                    key={product.id}
                    product={product}
                    prefix="stm"
                    suffix="steam"
                    sizes="72px"
                    priority={index === 0 && at < 5}
                    rowProps={{ 'data-temp': temperature, 'data-fx': temperature === 'neutral' ? undefined : '' }}
                    photoExtras={<Effect temperature={temperature} />}
                    metaExtras={temperature === 'neutral' ? null : <span className="stm-temp">{t(temperature === 'hot' ? 'tpl.stm.hot' : 'tpl.stm.cold')}</span>}
                  />
                );
              })}
            </ul>
          </section>
        ))}
      </main>
    </div>
  );
}

/** What lies over a photo: three wisps of steam for a hot dish, a frosted rim with beads and two drips for a cold one. */
function Effect({ temperature }: { temperature: Temperature }) {
  if (temperature === 'hot')
    return (
      <span aria-hidden className="stm-fx stm-steam">
        <i />
        <i />
        <i />
      </span>
    );
  if (temperature === 'cold')
    return (
      <span aria-hidden className="stm-fx stm-frost">
        <i />
        <i />
      </span>
    );
  return null;
}
