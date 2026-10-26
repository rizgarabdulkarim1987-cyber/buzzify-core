'use client';

import type { CSSProperties, ReactNode } from 'react';
import { unitPriceFromMenu } from '@/lib/menu-price';
import { mix, readableOn } from '@/lib/templates/palette';
import type { CardKind } from '@/lib/templates/types';
import type { MenuProductView } from '@/server/data/menu-view';
import { useApp } from '@/ui/AppProviders';
import { useTemplate } from './context';
import { Badges, CardNote, Description, FavoriteButton, Price, ProductMedia, QuickAction, useAvailability } from './parts';

/**
 * How one product is shown in its category (spec 5, card kinds). Every card opens the product from its name, a real
 * button, stretched over the card for pointer users; the card's own small buttons sit above that stretch.
 */

function OpenName({ product, className = '', children }: { product: MenuProductView; className?: string; children?: ReactNode }) {
  const { openProduct } = useTemplate();
  return (
    <button type="button" onClick={() => openProduct(product.id)} className={`tpl-open text-start ${className}`}>
      {children ?? product.name}
    </button>
  );
}

/** A product's sizes as chips that open it with that size chosen (the café's quick customization). */
function VariantChips({ product, max = 4, prices = false }: { product: MenuProductView; max?: number; prices?: boolean }) {
  const { price, t } = useApp();
  const { openProduct } = useTemplate();
  if (product.variants.length < 2) return null;
  // Each size at what it costs now, a live discount included.
  const sizePrice = (variantId: string) => price(unitPriceFromMenu(product, variantId, []));
  return (
    <span className="relative z-[2] mt-2 flex flex-wrap gap-1.5" role="group" aria-label={t('product.size')}>
      {product.variants.slice(0, max).map((variant) => (
        <button
          key={variant.id}
          type="button"
          onClick={() => openProduct(product.id, variant.id)}
          className="tpl-chip tpl-chip-small"
          aria-label={`${product.name}: ${variant.name}${prices ? `, ${sizePrice(variant.id)}` : ''}`}
        >
          {variant.name}
          {prices && <span className="tabular-nums text-(--muted)">{sizePrice(variant.id)}</span>}
        </button>
      ))}
    </span>
  );
}

function RowCard({ product }: { product: MenuProductView }) {
  return (
    <li className="tpl-card-row relative grid grid-cols-[minmax(0,1fr)_auto] gap-x-4">
      <div className="min-w-0">
        <div className="flex items-baseline gap-3">
          <OpenName product={product} className="tpl-display tpl-name min-w-0" />
          <span aria-hidden className="tpl-leader" />
          <Price product={product} className="shrink-0" />
        </div>
        <Badges product={product} className="mt-1.5" />
        <Description product={product} className="mt-1.5 max-w-[46ch] text-sm leading-relaxed" />
        <CardNote product={product} className="mt-1.5 block" />
      </div>
      <div className="flex flex-col items-center gap-2.5">
        <ProductMedia product={product} className="size-[72px]" sizes="72px" />
        <QuickAction product={product} className="relative z-[2]" />
      </div>
    </li>
  );
}

function PlateCard({ product }: { product: MenuProductView }) {
  return (
    <li className="tpl-card-row relative grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-5">
      <div className="min-w-0">
        <OpenName product={product} className="tpl-display tpl-name block" />
        <Badges product={product} className="mt-1" />
        <Description product={product} className="mt-1.5 max-w-[36ch] text-sm leading-relaxed" />
        <div className="mt-2 flex min-h-11 items-center gap-4">
          <Price product={product} />
          <CardNote product={product} />
          <QuickAction product={product} className="relative z-[2]" />
        </div>
      </div>
      <ProductMedia product={product} rounded={false} className="tpl-plate size-[88px] rounded-full" sizes="88px" />
    </li>
  );
}

function PhotoCard({ product }: { product: MenuProductView }) {
  return (
    <li className="tpl-card relative flex flex-col">
      <div className="relative">
        <ProductMedia product={product} className="tpl-photo aspect-(--ratio) w-full" />
        <FavoriteButton product={product} className="tpl-float absolute end-2 top-2 z-[2]" />
      </div>
      <div className="tpl-card-body flex flex-1 flex-col">
        <div className="flex items-baseline justify-between gap-4">
          <OpenName product={product} className="tpl-display tpl-name min-w-0" />
          <Price product={product} className="shrink-0" />
        </div>
        <Badges product={product} className="mt-1.5" />
        <Description product={product} className="mt-1.5 text-sm leading-relaxed" />
        <div className="mt-auto flex min-h-11 items-center justify-between gap-3 pt-2">
          <CardNote product={product} />
          <QuickAction product={product} className="relative z-[2] ms-auto" />
        </div>
      </div>
    </li>
  );
}

function IngredientCard({ product }: { product: MenuProductView }) {
  const { t } = useApp();
  return (
    <li className="tpl-card tpl-card-filled relative flex flex-col overflow-hidden">
      <ProductMedia product={product} rounded={false} className="aspect-(--ratio) w-full" />
      <div className="tpl-card-body flex flex-1 flex-col">
        <div className="flex items-baseline justify-between gap-4">
          <OpenName product={product} className="tpl-display tpl-name min-w-0" />
          <Price product={product} className="shrink-0" />
        </div>
        <Badges product={product} salesOnly className="mt-1.5" />
        <Description product={product} className="mt-1.5 text-sm leading-relaxed" />
        {product.ingredients.length > 0 && (
          <ul className="mt-3 flex flex-wrap gap-1.5" aria-label={t('product.ingredients')}>
            {product.ingredients.slice(0, 6).map((ingredient) => (
              <li key={ingredient} className="tpl-chip tpl-chip-quiet">
                {ingredient}
              </li>
            ))}
          </ul>
        )}
        {product.dietary && (
          <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-sm text-(--accent-ink)" aria-label={t('menu.dietary.label')}>
            {product.dietary.map((tag) => (
              <li key={tag}>{t(`menu.dietary.${tag}`)}</li>
            ))}
          </ul>
        )}
        <div className="mt-auto flex min-h-11 items-center justify-between gap-3 pt-2">
          <CardNote product={product} />
          <QuickAction product={product} className="relative z-[2] ms-auto" />
        </div>
      </div>
    </li>
  );
}

function CompactCard({ product }: { product: MenuProductView }) {
  return (
    <li className="tpl-card-row relative grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-4">
      <ProductMedia product={product} className="size-16" sizes="64px" />
      <div className="min-w-0">
        <OpenName product={product} className="tpl-display tpl-name-sm block" />
        <Badges product={product} salesOnly className="mt-1" />
        <Description product={product} lines={1} className="mt-0.5 text-sm" />
        <VariantChips product={product} max={3} />
        <CardNote product={product} className="mt-1 block" />
      </div>
      <div className="flex flex-col items-end gap-2">
        <Price product={product} className="text-sm" />
        <QuickAction product={product} className="relative z-[2]" />
      </div>
    </li>
  );
}

function GalleryCard({ product }: { product: MenuProductView }) {
  return (
    <li className="relative flex flex-col">
      <div className="relative">
        <ProductMedia product={product} className="aspect-(--ratio) w-full" sizes="(min-width: 768px) 240px, 46vw" />
        <FavoriteButton product={product} className="tpl-float absolute end-1.5 top-1.5 z-[2]" />
        <QuickAction product={product} className="absolute bottom-2 end-2 z-[2]" />
      </div>
      <OpenName product={product} className="tpl-display tpl-name-sm mt-2.5 line-clamp-2" />
      <Price product={product} className="mt-1 text-sm" />
      <Badges product={product} salesOnly className="mt-1.5" />
      <CardNote product={product} className="mt-0.5" />
    </li>
  );
}

function IsolatedCard({ product }: { product: MenuProductView }) {
  return (
    <li className="relative flex flex-col items-center text-center">
      <div className="tpl-isolated relative w-full">
        <ProductMedia product={product} rounded={false} className="mx-auto aspect-square w-[78%] bg-transparent!" />
      </div>
      <OpenName product={product} className="tpl-display tpl-name mt-4 text-center" />
      <Badges product={product} salesOnly className="mt-1.5 justify-center" />
      <Description product={product} className="mt-1.5 max-w-[30ch] text-sm" />
      <Price product={product} className="mt-2" />
      <CardNote product={product} className="mt-1" />
      <QuickAction product={product} variant="label" className="relative z-[2] mt-3" />
    </li>
  );
}

function ListCard({ product }: { product: MenuProductView }) {
  const { t } = useApp();
  const { design } = useTemplate();
  const { orderable } = useAvailability(product);
  const daily = design.layout.hero === 'daily';
  return (
    <li className="tpl-card-row relative flex items-center gap-4">
      {product.media[0]?.kind === 'image' && <ProductMedia product={product} className="size-12 shrink-0" sizes="48px" />}
      <div className="min-w-0 flex-1">
        <OpenName product={product} className="tpl-display tpl-name-sm block" />
        <Badges product={product} salesOnly className="my-1" />
        <Description product={product} lines={1} className="text-sm" />
        {daily && (
          <span className="mt-1 flex items-center gap-1.5 text-sm text-(--muted)">
            <span aria-hidden className={`size-2 rounded-full ${orderable ? 'bg-(--accent)' : 'border border-(--muted)'}`} />
            {orderable ? t('tpl.available') : null}
            <CardNote product={product} />
          </span>
        )}
        {!daily && <CardNote product={product} />}
      </div>
      <Price product={product} className="shrink-0 text-sm" />
      <QuickAction product={product} className="relative z-[2] shrink-0" />
    </li>
  );
}

/** A flavour's own colour: the tone of its drawing, else one of the template's swatches in turn. */
function flavorStyle(product: MenuProductView, index: number, palette: { bg: string; text: string; accent: string; raised: string; button: string }): CSSProperties {
  const art = product.media.find((item) => item.kind === 'art');
  const swatches = [palette.accent, palette.raised, palette.button, mix(palette.accent, palette.raised, 0.5)];
  const tone = art && art.kind === 'art' ? art.tone : swatches[index % swatches.length]!;
  const tile = mix(tone, palette.bg, 0.62);
  return { '--tile': tile, '--tile-text': readableOn(palette.text, [tile], 7) } as CSSProperties;
}

function FlavorCard({ product, index }: { product: MenuProductView; index: number }) {
  const { design } = useTemplate();
  return (
    <li className="tpl-flavor relative flex flex-col items-center text-center" style={flavorStyle(product, index, design.palette)}>
      <ProductMedia product={product} rounded={false} className="tpl-scoop size-[58%] rounded-full bg-transparent!" sizes="140px" />
      <OpenName product={product} className="tpl-display tpl-name-sm mt-3 text-center text-(--tile-text)" />
      <Price product={product} className="mt-1 text-sm text-(--tile-text)!" />
      <Badges product={product} salesOnly className="mt-1.5 justify-center" />
      <CardNote product={product} className="mt-0.5 text-(--tile-text)!" />
      <QuickAction product={product} className="absolute bottom-2.5 end-2.5 z-[2]" />
      <FavoriteButton product={product} className="absolute end-1 top-1 z-[2] text-(--tile-text)!" />
    </li>
  );
}

function OversizedCard({ product }: { product: MenuProductView }) {
  return (
    <li className="tpl-card tpl-card-filled relative flex flex-col overflow-hidden">
      <div className="relative">
        <ProductMedia product={product} rounded={false} className="aspect-[16/10] w-full" sizes="(min-width: 768px) 480px, 100vw" />
        <FavoriteButton product={product} className="tpl-float absolute end-2 top-2 z-[2]" />
      </div>
      <div className="tpl-card-body">
        <OpenName product={product} className="tpl-display tpl-name-lg block" />
        <Badges product={product} className="mt-1.5" />
        <Description product={product} className="mt-2 text-sm leading-relaxed" />
        <VariantChips product={product} prices />
        <div className="mt-3 flex min-h-12 items-center justify-between gap-3">
          <Price product={product} className="text-lg" />
          <CardNote product={product} />
          <QuickAction product={product} variant="label" className="relative z-[2]" />
        </div>
      </div>
    </li>
  );
}

function CakeCard({ product }: { product: MenuProductView }) {
  const sizes = product.variants.length > 1 ? product.variants.map((variant) => variant.name).join(' · ') : null;
  return (
    <li className="relative flex flex-col">
      <div className="relative">
        <ProductMedia product={product} className="aspect-[4/5] w-full" sizes="(min-width: 768px) 260px, 46vw" />
        <FavoriteButton product={product} className="tpl-float absolute end-1.5 top-1.5 z-[2]" />
      </div>
      <OpenName product={product} className="tpl-display tpl-name-sm mt-3 line-clamp-2" />
      {sizes && <span className="mt-0.5 line-clamp-1 text-xs text-(--muted)">{sizes}</span>}
      <Badges product={product} salesOnly className="mt-1.5" />
      <div className="mt-1.5 flex items-center justify-between gap-2">
        <Price product={product} className="text-sm" />
        <QuickAction product={product} className="relative z-[2]" />
      </div>
      <CardNote product={product} />
    </li>
  );
}

function DrinkCard({ product }: { product: MenuProductView }) {
  return (
    <li className="tpl-card tpl-card-filled relative grid grid-cols-[auto_minmax(0,1fr)] gap-4 p-3">
      <ProductMedia product={product} className="size-[88px]" sizes="88px" />
      <div className="min-w-0 py-0.5">
        <div className="flex items-baseline justify-between gap-3">
          <OpenName product={product} className="tpl-display tpl-name-sm min-w-0" />
          <Price product={product} className="shrink-0 text-sm" />
        </div>
        <Badges product={product} salesOnly className="mt-1" />
        <Description product={product} lines={1} className="mt-0.5 text-sm" />
        <VariantChips product={product} prices />
        <div className="flex items-center justify-between gap-2">
          <CardNote product={product} />
          {product.variants.length < 2 && <QuickAction product={product} className="relative z-[2] ms-auto mt-2" />}
        </div>
      </div>
    </li>
  );
}

const CARDS: Record<Exclude<CardKind, 'flavor'>, (props: { product: MenuProductView }) => ReactNode> = {
  row: RowCard,
  plate: PlateCard,
  photo: PhotoCard,
  ingredient: IngredientCard,
  compact: CompactCard,
  gallery: GalleryCard,
  isolated: IsolatedCard,
  list: ListCard,
  oversized: OversizedCard,
  cake: CakeCard,
  drink: DrinkCard,
};

/** The container each card kind sits in: a list with dividers, a stack, or a grid. */
const CONTAINER: Record<CardKind, string> = {
  row: 'tpl-list',
  plate: 'tpl-list',
  list: 'tpl-list',
  compact: 'tpl-list',
  drink: 'grid gap-3 md:grid-cols-2',
  ingredient: 'grid gap-5 md:grid-cols-2',
  photo: 'grid gap-x-5 gap-y-8 md:grid-cols-2',
  oversized: 'grid gap-6 md:grid-cols-2',
  gallery: 'grid grid-cols-2 gap-x-4 gap-y-7 md:grid-cols-3',
  cake: 'grid grid-cols-2 gap-x-4 gap-y-8 md:grid-cols-3',
  flavor: 'grid grid-cols-2 gap-3 md:grid-cols-3',
  isolated: 'grid gap-x-6 gap-y-14 sm:grid-cols-2 lg:grid-cols-3',
};

export function ProductList({ products, kind }: { products: MenuProductView[]; kind: CardKind }) {
  return (
    <ul className={CONTAINER[kind]} data-card={kind}>
      {products.map((product, index) => {
        if (kind === 'flavor') return <FlavorCard key={product.id} product={product} index={index} />;
        const Card = CARDS[kind];
        return <Card key={product.id} product={product} />;
      })}
    </ul>
  );
}
