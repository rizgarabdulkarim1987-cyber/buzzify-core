'use client';

import { useId, useMemo, useState, type CSSProperties } from 'react';
import { mix } from '@/lib/templates/palette';
import type { HeroKind } from '@/lib/templates/types';
import type { MenuProductView } from '@/server/data/menu-view';
import { formatCount } from '@/server/domain/money';
import { useApp } from '@/ui/AppProviders';
import { ForwardIcon } from '@/ui/Icons';
import { useTemplate, type MenuCategory } from './context';
import { Description, Price, ProductMedia, SoldOut, useAvailability } from './parts';

/**
 * The top of a template menu (spec 5, hero kinds). Each kind keeps the categories and the first products within the
 * first screen on a phone: no hero is taller than about half of it, and none plays before the menu can be used.
 */

/** Day names by `Date.getDay()` (Sunday first), as the message catalog names them. */
const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

function ViewButton({ product, className = '' }: { product: MenuProductView; className?: string }) {
  const { t } = useApp();
  const { openProduct } = useTemplate();
  return (
    <button type="button" onClick={() => openProduct(product.id)} className={`tpl-button ${className}`} aria-label={t('tpl.viewNamed', { name: product.name })}>
      {t('tpl.view')}
      <ForwardIcon className="size-4" />
    </button>
  );
}

/** The time-of-day line under a signature, which says why this dish is shown now. */
function PickCaption({ className = '' }: { className?: string }) {
  const { t } = useApp();
  const { view } = useTemplate();
  return <p className={`text-sm text-(--muted) ${className}`}>{t(`signature.${view.daypart ?? 'NONE'}`)}</p>;
}

function useLead(): MenuProductView | undefined {
  const { signature, featured } = useTemplate();
  return signature ?? featured[0];
}

function EditorialHero() {
  const product = useLead();
  const { openProduct } = useTemplate();
  if (!product) return null;
  return (
    <section aria-labelledby="hero-title" className="tpl-hero tpl-hero-editorial">
      <button type="button" tabIndex={-1} aria-hidden onClick={() => openProduct(product.id)} className="tpl-hero-media block w-full">
        <ProductMedia product={product} rounded={false} priority suffix="hero" sizes="(min-width: 768px) 720px, 100vw" className="aspect-[5/4] max-h-[40svh] w-full md:aspect-[16/9] md:max-h-[52svh]" />
      </button>
      <div className="tpl-hero-text relative -mt-16 px-(--gutter)">
        <h2 id="hero-title" className="tpl-hero-title tpl-display">
          {product.name}
        </h2>
        <Description product={product} className="mt-3 max-w-[34ch] leading-relaxed" />
        <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-3">
          <Price product={product} className="text-lg" />
          <SoldOut product={product} />
          <ViewButton product={product} className="tpl-button-ghost" />
        </div>
        <PickCaption className="mt-3" />
      </div>
    </section>
  );
}

function FeatureTile({ product, className, sizes }: { product: MenuProductView; className: string; sizes: string }) {
  const { openProduct } = useTemplate();
  return (
    <li className="relative">
      <button type="button" tabIndex={-1} aria-hidden onClick={() => openProduct(product.id)} className="block w-full">
        <ProductMedia product={product} priority suffix="hero" sizes={sizes} className={className} />
      </button>
      <button type="button" onClick={() => openProduct(product.id)} className="tpl-open tpl-display tpl-name-sm mt-2 block text-start">
        {product.name}
      </button>
      <Price product={product} className="mt-0.5 block text-sm" />
    </li>
  );
}

function AsymmetricHero() {
  const { featured } = useTemplate();
  const { t } = useApp();
  const [first, second, third] = featured;
  if (!first) return null;
  const Tile = FeatureTile;
  return (
    <section aria-label={t('tpl.featured')} className="tpl-hero px-(--gutter)">
      <ul className="grid grid-cols-[1.2fr_1fr] gap-x-4">
        <Tile product={first} className="aspect-[4/5] w-full" sizes="(min-width: 768px) 360px, 54vw" />
        {second && (
          <li className="flex flex-col gap-5 pt-10">
            <ul className="flex flex-col gap-5">
              <Tile product={second} className="aspect-square w-full" sizes="(min-width: 768px) 280px, 42vw" />
              {third && <Tile product={third} className="aspect-square w-full" sizes="(min-width: 768px) 280px, 42vw" />}
            </ul>
          </li>
        )}
      </ul>
    </section>
  );
}

function ArchHero() {
  const product = useLead();
  const { openProduct } = useTemplate();
  if (!product) return null;
  return (
    <section aria-labelledby="hero-title" className="tpl-hero flex flex-col items-center px-(--gutter) text-center">
      <button type="button" tabIndex={-1} aria-hidden onClick={() => openProduct(product.id)} className="tpl-arch-frame block w-[min(68%,20rem)]">
        <ProductMedia product={product} rounded={false} priority suffix="hero" sizes="320px" className="aspect-[3/4] w-full rounded-t-full" />
      </button>
      <h2 id="hero-title" className="tpl-hero-title tpl-display mt-6 text-center">
        {product.name}
      </h2>
      <Description product={product} className="mt-3 max-w-[32ch] leading-relaxed" />
      <div className="mt-4 flex flex-wrap items-center justify-center gap-x-5 gap-y-3">
        <Price product={product} className="text-lg" />
        <SoldOut product={product} />
        <ViewButton product={product} className="tpl-button-ghost" />
      </div>
    </section>
  );
}

function ChaptersHero() {
  const { t, locale, tenant } = useApp();
  const { categories, byCategory, jumpTo, design } = useTemplate();
  const numbered = design.layout.heading === 'numbered';
  return (
    <nav aria-label={t('explore.chapters')} className="tpl-hero px-(--gutter)">
      <ol className="tpl-chapters">
        {categories.map((category, index) => {
          const products = byCategory.get(category.id) ?? [];
          return (
            <li key={category.id}>
              <button type="button" onClick={() => jumpTo(category.id)} className="tpl-chapter group" aria-label={t('tpl.categoryJump', { name: category.name })}>
                {numbered && (
                  <span aria-hidden className="tpl-numeral">
                    {formatCount(index + 1, locale, tenant.numeralSystem)}
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="tpl-display tpl-name block">{category.name}</span>
                  <span className="mt-0.5 line-clamp-1 block text-sm text-(--muted)">{products.slice(0, 3).map((product) => product.name).join(' · ')}</span>
                </span>
                <ForwardIcon className="size-4 shrink-0 text-(--muted) transition-transform duration-200 group-hover:translate-x-0.5 rtl:group-hover:-translate-x-0.5" />
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function SpotlightHero() {
  const product = useLead();
  const { openProduct } = useTemplate();
  const { money, t } = useApp();
  if (!product) return null;
  const base = product.displayPrice - (product.variants.find((variant) => variant.isDefault)?.priceDelta ?? 0);
  return (
    <section aria-labelledby="hero-title" className="tpl-hero tpl-spotlight relative overflow-hidden px-(--gutter)">
      <div className="grid items-center gap-6 md:grid-cols-[1fr_1.1fr]">
        <button type="button" tabIndex={-1} aria-hidden onClick={() => openProduct(product.id)} className="tpl-spotlight-media order-1 block md:order-2">
          <ProductMedia product={product} priority suffix="hero" sizes="(min-width: 768px) 420px, 88vw" className="mx-auto aspect-square w-[min(56%,22rem)] rounded-full md:w-[min(82%,22rem)]" rounded={false} />
        </button>
        <div className="tpl-spotlight-text order-2 md:order-1">
          <h2 id="hero-title" className="tpl-hero-title tpl-display">
            {product.name}
          </h2>
          <Description product={product} lines={3} className="mt-3 max-w-[34ch] leading-relaxed" />
          {product.variants.length > 1 && (
            <ul className="mt-4 flex flex-wrap gap-2" aria-label={t('product.size')}>
              {product.variants.map((variant) => (
                <li key={variant.id}>
                  <button type="button" onClick={() => openProduct(product.id, variant.id)} className="tpl-chip">
                    {variant.name}
                    <span className="tabular-nums text-(--muted)">{money(base + variant.priceDelta)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-3">
            <Price product={product} className="text-xl" />
            <SoldOut product={product} />
            <ViewButton product={product} />
          </div>
          <PickCaption className="mt-3" />
        </div>
      </div>
    </section>
  );
}

function CarouselHero() {
  const { featured, openProduct } = useTemplate();
  const { t } = useApp();
  const items = featured.slice(0, 6);
  if (items.length === 0) return null;
  return (
    <section aria-label={t('tpl.featured')} className="tpl-hero">
      <ul className="tpl-carousel scroll-hidden">
        {items.map((product, index) => (
          <li key={product.id} className="tpl-carousel-item relative">
            <button type="button" tabIndex={-1} aria-hidden onClick={() => openProduct(product.id)} className="block w-full">
              <ProductMedia product={product} priority={index === 0} suffix="hero" sizes="(min-width: 768px) 320px, 78vw" className="aspect-[4/5] w-full" />
            </button>
            <div className="mt-3 flex items-baseline justify-between gap-3">
              <button type="button" onClick={() => openProduct(product.id)} className="tpl-open tpl-display tpl-name min-w-0 text-start">
                {product.name}
              </button>
              <Price product={product} className="shrink-0 text-sm" />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function PedestalHero() {
  const product = useLead();
  const { openProduct } = useTemplate();
  if (!product) return null;
  return (
    <section aria-labelledby="hero-title" className="tpl-hero flex flex-col items-center px-(--gutter) text-center">
      <button type="button" tabIndex={-1} aria-hidden onClick={() => openProduct(product.id)} className="tpl-pedestal-stage relative block w-[min(78%,22rem)]">
        <ProductMedia product={product} rounded={false} priority suffix="hero" sizes="360px" className="relative z-[1] mx-auto aspect-square w-[82%] bg-transparent!" />
        <span aria-hidden className="tpl-pedestal" />
      </button>
      <h2 id="hero-title" className="tpl-hero-title tpl-display mt-8 text-center">
        {product.name}
      </h2>
      <Description product={product} className="mt-3 max-w-[30ch]" />
      <div className="mt-4 flex items-center gap-5">
        <Price product={product} className="text-lg" />
        <ViewButton product={product} className="tpl-button-ghost" />
      </div>
    </section>
  );
}

function CollectionHero() {
  const { t } = useApp();
  const { categories, byCategory, jumpTo, openProduct } = useTemplate();
  const tabs = categories.slice(0, 4);
  const [selected, setSelected] = useState(tabs[0]?.id ?? null);
  const id = useId();
  const current = tabs.find((category) => category.id === selected) ?? tabs[0];
  if (!current) return null;
  const products = (byCategory.get(current.id) ?? []).slice(0, 3);
  return (
    <section aria-label={t('tpl.collections')} className="tpl-hero px-(--gutter)">
      <div role="tablist" aria-label={t('tpl.collections')} className="scroll-hidden -mx-(--gutter) flex gap-6 overflow-x-auto px-(--gutter)">
        {tabs.map((category) => (
          <button
            key={category.id}
            role="tab"
            type="button"
            id={`${id}-tab-${category.id}`}
            aria-selected={category.id === current.id}
            aria-controls={`${id}-panel`}
            onClick={() => setSelected(category.id)}
            className="tpl-tab tpl-display shrink-0"
          >
            {category.name}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-tab-${current.id}`} className="mt-5">
        <ul className="grid grid-cols-3 gap-3">
          {products.map((product) => (
            <li key={product.id}>
              <button type="button" onClick={() => openProduct(product.id)} className="block w-full text-start" aria-label={t('tpl.viewNamed', { name: product.name })}>
                <ProductMedia product={product} suffix="hero" sizes="(min-width: 768px) 220px, 30vw" className="aspect-[4/5] w-full" />
                <span className="mt-2 line-clamp-2 block text-sm">{product.name}</span>
              </button>
            </li>
          ))}
        </ul>
        <button type="button" onClick={() => jumpTo(current.id)} className="tpl-button tpl-button-ghost mt-5">
          {t('tpl.seeCollection')}
          <ForwardIcon className="size-4" />
        </button>
      </div>
    </section>
  );
}

function DailyHero() {
  const { t } = useApp();
  const { view, openProduct } = useTemplate();
  // The weekday from the catalog's own words: browsers name the days of some languages (Sorani) inconsistently.
  const today = useMemo(() => t(`tpl.day.${WEEKDAYS[new Date().getDay()]}`), [t]);
  const fresh = view.products.slice(0, 5);
  return (
    <section aria-labelledby="hero-title" className="tpl-hero px-(--gutter)">
      <div className="tpl-daily">
        <h2 id="hero-title" className="tpl-h2 tpl-display">
          {t('tpl.todaysBake')}
        </h2>
        <p className="mt-1 text-sm text-(--muted)" suppressHydrationWarning>
          {today}
        </p>
        <ul className="mt-4 divide-y divide-(--line)">
          {fresh.map((product) => (
            <DailyLine key={product.id} product={product} onOpen={() => openProduct(product.id)} />
          ))}
        </ul>
      </div>
    </section>
  );
}

function DailyLine({ product, onOpen }: { product: MenuProductView; onOpen: () => void }) {
  const { t } = useApp();
  const { orderable, label } = useAvailability(product);
  return (
    <li className="flex min-h-12 items-center gap-3 py-2">
      <span aria-hidden className={`size-2 shrink-0 rounded-full ${orderable ? 'bg-(--accent)' : 'border border-(--muted)'}`} />
      <button type="button" onClick={onOpen} className="tpl-open min-w-0 flex-1 truncate text-start">
        {product.name}
      </button>
      <span className="text-sm text-(--muted)">{label ?? t('tpl.available')}</span>
      <Price product={product} className="text-sm" />
    </li>
  );
}

function OccasionHero() {
  const { t } = useApp();
  const { categories, byCategory, jumpTo } = useTemplate();
  const tiles = categories.slice(0, 6);
  if (tiles.length === 0) return null;
  return (
    <nav aria-label={t('tpl.browse')} className="tpl-hero px-(--gutter)">
      <ul className="tpl-occasions grid grid-cols-2 gap-3 md:grid-cols-3">
        {tiles.map((category) => (
          <OccasionTile key={category.id} category={category} cover={(byCategory.get(category.id) ?? [])[0]} onJump={() => jumpTo(category.id)} />
        ))}
      </ul>
    </nav>
  );
}

function OccasionTile({ category, cover, onJump }: { category: MenuCategory; cover: MenuProductView | undefined; onJump: () => void }) {
  const { t } = useApp();
  return (
    <li>
      <button
        type="button"
        onClick={onJump}
        data-cover={cover ? '' : undefined}
        className="tpl-occasion group relative block w-full overflow-hidden text-start"
        aria-label={t('tpl.categoryJump', { name: category.name })}
      >
        {cover && (
          <span className="tpl-occasion-media block overflow-hidden">
            <ProductMedia product={cover} rounded={false} dim={false} suffix="tile" sizes="(min-width: 768px) 240px, 46vw" className="aspect-[4/3] w-full transition-transform duration-500 group-hover:scale-[1.03]" />
          </span>
        )}
        <span className="tpl-display tpl-name-sm block px-3.5 py-3">{category.name}</span>
      </button>
    </li>
  );
}

function FlavorWallHero() {
  const { t } = useApp();
  const { view, openProduct, design } = useTemplate();
  const flavors = view.products.slice(0, 10);
  if (flavors.length === 0) return null;
  return (
    <section aria-labelledby="hero-title" className="tpl-hero px-(--gutter)">
      <h2 id="hero-title" className="tpl-h2 tpl-display">
        {t('tpl.flavors')}
      </h2>
      <ul className="scroll-hidden -mx-(--gutter) mt-4 flex gap-4 overflow-x-auto px-(--gutter) pb-2">
        {flavors.map((product, index) => {
          const art = product.media.find((item) => item.kind === 'art');
          const swatches = [design.palette.accent, design.palette.raised, design.palette.button];
          const tone = art && art.kind === 'art' ? art.tone : swatches[index % swatches.length]!;
          return (
            <li key={product.id} className="w-[5.5rem] shrink-0 text-center">
              <button type="button" onClick={() => openProduct(product.id)} className="group block w-full" aria-label={t('tpl.viewNamed', { name: product.name })}>
                <span className="tpl-swatch mx-auto block" style={{ '--swatch': mix(tone, design.palette.bg, 0.35) } as CSSProperties}>
                  <ProductMedia product={product} rounded={false} suffix="swatch" sizes="88px" className="size-full rounded-full bg-transparent!" />
                </span>
                <span className="mt-2 line-clamp-2 block text-sm leading-snug">{product.name}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function CatchHero() {
  const product = useLead();
  const { openProduct } = useTemplate();
  const { t } = useApp();
  if (!product) return null;
  return (
    <section aria-labelledby="hero-title" className="tpl-hero px-(--gutter)">
      <div className="tpl-catch">
        <h2 id="hero-title" className="tpl-catch-label tpl-display">
          {t('tpl.todaysCatch')}
        </h2>
        <button type="button" tabIndex={-1} aria-hidden onClick={() => openProduct(product.id)} className="mt-3 block w-full">
          <ProductMedia product={product} priority suffix="hero" sizes="(min-width: 768px) 720px, 92vw" className="aspect-[16/9] w-full" />
        </button>
        <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <h3 className="tpl-h2 tpl-display">{product.name}</h3>
            <Description product={product} className="mt-1.5 max-w-[40ch]" />
          </div>
          <div className="flex items-center gap-4">
            <Price product={product} className="text-lg" />
            <ViewButton product={product} className="tpl-button-ghost" />
          </div>
        </div>
      </div>
    </section>
  );
}

/** A short line about the place (its search description) and nothing more, so the menu starts right away. */
function CompactHero({ tagline }: { tagline?: string }) {
  if (!tagline) return null;
  return (
    <section className="tpl-hero px-(--gutter)">
      <p className="tpl-tagline tpl-display max-w-[28ch]">{tagline}</p>
    </section>
  );
}

export function Hero({ kind, tagline }: { kind: HeroKind; tagline?: string }) {
  switch (kind) {
    case 'editorial':
      return <EditorialHero />;
    case 'asymmetric':
      return <AsymmetricHero />;
    case 'arch':
      return <ArchHero />;
    case 'chapters':
      return <ChaptersHero />;
    case 'spotlight':
      return <SpotlightHero />;
    case 'carousel':
      return <CarouselHero />;
    case 'pedestal':
      return <PedestalHero />;
    case 'collection':
      return <CollectionHero />;
    case 'daily':
      return <DailyHero />;
    case 'occasion':
      return <OccasionHero />;
    case 'flavorWall':
      return <FlavorWallHero />;
    case 'catch':
      return <CatchHero />;
    default:
      return <CompactHero tagline={tagline} />;
  }
}
