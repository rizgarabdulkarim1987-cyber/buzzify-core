'use client';

import { useRef } from 'react';
import type { CSSProperties } from 'react';
import type { MenuProductView } from '@/server/data/menu-view';
import { formatCount } from '@/server/domain/money';
import { useApp } from '@/ui/AppProviders';
import { useTemplate } from '../context';
import { Price, ProductMedia, QuickAction, SaleChip } from '../parts';
import { SectionStrip, ShapeHeading } from './shared/SectionStrip';
import { LANES, temperatureOf, type Temperature } from './temperature';
import { useSteamLive } from './useSteamLive';
import './shared/photo-card.css';
import './shared/shapes.css';
import './steam.css';

/**
 * Living Steam (poster motion-stm of the 35 mockups; spec 2026-10-26-menu-styles-in-templates-design.md). A menu with a
 * temperature. A sticky strip of round chips jumps to a section. The menu's featured dish (the first featured one, else
 * the first dish) opens the page as a big photo with its name large under it and its price and add on a row (it is the
 * dish's own cell, so no dish is shown twice; with no other dish in its section it stays in the grid and there is no
 * hero). Each section is a heading over a two-column grid of rounded photos: the name under each, the price and the add
 * on a row, the discount on the photo's foot. Each dish's photo shows how it is served: a hot dish has three wisps of
 * steam over the photo, a cold one frost, beads of dew and a slow drip, any other nothing (`temperatureOf`, read from its
 * name and its section's, with no data of its own), and a "Hot" or "Cold" badge on the photo's corner says it in words, so
 * the lane is never only a colour. The wisps and drips are CSS transform and opacity only, run once, are paused for dishes
 * off screen (`useSteamLive`) and are still for less motion. All sections are on the page, so the template's own jump and
 * `#cat-<slug>` scrolling reach them.
 */
export function SteamBody() {
  const { t, locale, tenant } = useApp();
  const { categories, byCategory, featured, reduced } = useTemplate();
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

  // The hero: the featured dish while it is still among the results (and not alone in its section), else the first dish.
  const first = featured[0] ?? categories.flatMap((category) => byCategory.get(category.id) ?? [])[0];
  const home = first ? categories.find((category) => (byCategory.get(category.id) ?? []).some((product) => product.id === first.id)) : undefined;
  const hero = first && home && (byCategory.get(home.id) ?? []).length > 1 ? first : undefined;
  const heroTemp = hero && home ? temperatureOf(hero, home) : 'neutral';
  const word = (temperature: Temperature) => (temperature === 'hot' ? t('tpl.stm.hot') : t('tpl.stm.cold'));

  return (
    <div className="tpl-body" data-body="steam" ref={root} style={lanes}>
      <SectionStrip marker="chips" prefix="stm">
        {(category) => <span>{category.name}</span>}
      </SectionStrip>
      {hero ? <Hero product={hero} temperature={heroTemp} label={t('tpl.featured')} badge={heroTemp === 'neutral' ? null : word(heroTemp)} /> : null}
      <main id="menu" className="min-w-0">
        {categories.map((category, index) => {
          const products = (byCategory.get(category.id) ?? []).filter((product) => product.id !== hero?.id);
          return (
            <section key={category.id} id={`cat-${category.slug}`} aria-labelledby={`h-${category.slug}`} className="tpl-section tpl-tall-last stm-rack">
              <ShapeHeading id={`h-${category.slug}`} name={category.name} count={n(products.length)} className="stm-head" title="stm-title" />
              <ul className="stm-grid">
                {products.map((product, at) => {
                  const temperature = temperatureOf(product, category);
                  return <Tile key={product.id} product={product} temperature={temperature} badge={temperature === 'neutral' ? null : word(temperature)} priority={index === 0 && at < 4} />;
                })}
              </ul>
            </section>
          );
        })}
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

/** The photo with its effect, its temperature badge and its discount. */
function Photo({ product, temperature, badge, sizes, priority }: { product: MenuProductView; temperature: Temperature; badge: string | null; sizes: string; priority: boolean }) {
  return (
    <div data-photo className="stm-photo tpl-cover-media tpl-plate">
      <ProductMedia product={product} suffix="steam" sizes={sizes} priority={priority} className="stm-img" rounded={false} />
      <Effect temperature={temperature} />
      {badge ? <span className="stm-temp">{badge}</span> : null}
      <SaleChip product={product} className="tpl-photo-off stm-off" />
    </div>
  );
}

const fx = (temperature: Temperature) => ({ 'data-temp': temperature, 'data-fx': temperature === 'neutral' ? undefined : '' });

/** The hero: the featured dish as a big photo, its name large under it, its price and its add on a row. The whole cell opens the dish. */
function Hero({ product, temperature, label, badge }: { product: MenuProductView; temperature: Temperature; label: string; badge: string | null }) {
  const { openProduct } = useTemplate();
  return (
    <div className="stm-hero-wrap">
      <div data-row data-hero {...fx(temperature)} className="stm-hero">
        <Photo product={product} temperature={temperature} badge={badge} sizes="(min-width: 640px) 640px, 100vw" priority />
        <button type="button" onClick={() => openProduct(product.id)} className="tpl-open tpl-dish-name stm-name">
          <span className="sr-only">{label}: </span>
          {product.name}
        </button>
        <div className="stm-meta">
          <Price product={product} className="stm-price" />
          <QuickAction product={product} variant="icon" className="tpl-rim-add stm-add" />
        </div>
      </div>
    </div>
  );
}

/** A dish in the grid: its photo, its name, then its price and its add on a row. The whole cell opens the dish. */
function Tile({ product, temperature, badge, priority }: { product: MenuProductView; temperature: Temperature; badge: string | null; priority: boolean }) {
  const { openProduct } = useTemplate();
  return (
    <li data-row {...fx(temperature)} className="stm-tile">
      <Photo product={product} temperature={temperature} badge={badge} sizes="(min-width: 1024px) 220px, (min-width: 640px) 25vw, 45vw" priority={priority} />
      <button type="button" onClick={() => openProduct(product.id)} className="tpl-open tpl-dish-name stm-name">
        {product.name}
      </button>
      <div className="stm-meta">
        <Price product={product} className="stm-price" />
        <QuickAction product={product} variant="icon" className="tpl-rim-add stm-add" />
      </div>
    </li>
  );
}
