'use client';

import type { MouseEvent } from 'react';
import { localDigits } from '@/lib/digits';
import { lowestPriceFromMenu } from '@/lib/menu-price';
import type { MenuProductView } from '@/server/data/menu-view';
import { formatCount } from '@/server/domain/money';
import { useApp } from '@/ui/AppProviders';
import { ProductVisual } from '@/ui/art/ProductVisual';
import { HeartIcon, PlusIcon } from '@/ui/Icons';
import { hasSalesPills } from '@/ui/menu/SalesLabels';
import { useTemplate } from './context';

/**
 * The product's price in the menu's price style, and during a discount the regular price crossed out beside it. With
 * `lowest` (the cards) it says "From 4.50" when the sizes start below the default; the product's own surface passes
 * false and shows the default size.
 */
export function Price({ product, lowest = true, className = '' }: { product: MenuProductView; lowest?: boolean; className?: string }) {
  const { t, price } = useApp();
  const cheapest = lowestPriceFromMenu(product);
  const from = lowest && cheapest.price < product.displayPrice;
  const now = from ? cheapest.price : product.displayPrice;
  const was = product.regularPrice === undefined ? null : from ? cheapest.regular : product.regularPrice;
  return (
    <span className={`tabular-nums text-(--accent-ink) ${className}`}>
      {from ? t('tpl.from', { price: price(now) }) : price(now)}
      {was !== null && was > now && (
        <s className="tpl-was">
          <span className="sr-only">{t('menu.regularPrice', { price: price(was) })}</span>
          <span aria-hidden>{price(was)}</span>
        </s>
      )}
    </span>
  );
}

/** Whether a product can be ordered right now, and the words for when it cannot. */
export function useAvailability(product: MenuProductView): { orderable: boolean; label: string | null } {
  const { t } = useApp();
  if (product.orderState === 'OK') return { orderable: true, label: null };
  return { orderable: false, label: t(product.orderState === 'OUT_OF_STOCK' ? 'product.soldOut' : 'product.unavailable') };
}

/**
 * What a guest should know before choosing: why the product cannot be ordered now; or, when it can, how many it serves
 * and that only a few are left (both from the Sales tab, and only when real).
 */
export function CardNote({ product, className = '' }: { product: MenuProductView; className?: string }) {
  const { t, price, locale, tenant } = useApp();
  const { label } = useAvailability(product);
  if (label) return <span className={`tpl-note text-sm text-(--muted) ${className}`}>{label}</span>;
  if (!product.serves && !product.fewLeft) return null;
  // `count` picks the language's plural form; `n` is the number in the menu's digits.
  const n = (value: number) => formatCount(value, locale, tenant.numeralSystem);
  return (
    <span className={`tpl-note text-sm text-(--muted) ${className}`}>
      {product.serves && t('menu.serves', { count: product.serves, n: n(product.serves), price: price(Math.round(product.displayPrice / product.serves)) })}
      {product.serves && product.fewLeft && ' · '}
      {product.fewLeft && <span className="tpl-few">{t('menu.fewLeft', { count: product.fewLeft, n: n(product.fewLeft) })}</span>}
    </span>
  );
}

/** The product's live discount in percent, or 0 when it is not on sale. */
export function saleOff(product: MenuProductView): number {
  return product.regularPrice !== undefined && product.percentOff ? product.percentOff : 0;
}

/** "−NN%" in the menu's numerals, or null when the product is not on sale. */
function useSaleLabel(product: MenuProductView): string | null {
  const { t, tenant } = useApp();
  const off = saleOff(product);
  return off ? t('menu.percentOff', { percent: localDigits(String(off), tenant.numeralSystem) }) : null;
}

/**
 * A discount as a compact "−NN%" chip, for a price in a tight spot (`tpl-price-tight`) that has no room for the crossed-out
 * regular price: sighted guests still see the sale, and the price keeps the regular price for screen readers. Nothing
 * when the product is not on sale. The shape places it (`shared/shapes.css` draws it).
 */
export function SaleChip({ product, className = '' }: { product: MenuProductView; className?: string }) {
  const label = useSaleLabel(product);
  return label ? <span className={`tpl-off tabular-nums ${className}`}>{label}</span> : null;
}

/** The Sales tab's labels on a product: its special, its live discount and "Most ordered". */
function SalesTags({ product }: { product: MenuProductView }) {
  const { t } = useApp();
  const sale = useSaleLabel(product);
  return (
    <>
      {product.special && <span className="tpl-badge tpl-badge-special">{product.special}</span>}
      {sale && <span className="tpl-badge tpl-badge-sale tabular-nums">{sale}</span>}
      {product.mostOrdered && <span className="tpl-badge tpl-badge-hot">{t('menu.mostOrdered')}</span>}
    </>
  );
}

/**
 * The product's labels: the Sales tab's, then the restaurant's own (new, popular, recommended), only when there are
 * any. `salesOnly` is for the cards that leave the restaurant's labels out.
 */
export function Badges({ product, salesOnly = false, className = '' }: { product: MenuProductView; salesOnly?: boolean; className?: string }) {
  const { t } = useApp();
  const own = salesOnly ? undefined : product.badges;
  if (!own && !hasSalesPills(product)) return null;
  return (
    <span className={`flex flex-wrap gap-1.5 ${className}`}>
      <SalesTags product={product} />
      {own?.map((badge) => (
        <span key={badge} className={badge === 'POPULAR' ? 'tpl-badge tpl-badge-hot' : 'tpl-badge'}>
          {t(`menu.badge.${badge}`)}
        </span>
      ))}
    </span>
  );
}

/** The product's picture (a library photo, or its drawing), at the template's ratio and corner. */
export function ProductMedia({
  product,
  className = '',
  sizes = '(min-width: 768px) 360px, 92vw',
  priority = false,
  dim = true,
  rounded = true,
  suffix = 'card',
}: {
  product: MenuProductView;
  className?: string;
  sizes?: string;
  priority?: boolean;
  /** Fade a product that cannot be ordered now. */
  dim?: boolean;
  rounded?: boolean;
  /** Keeps SVG ids unique when one product is drawn twice on a page. */
  suffix?: string;
}) {
  const { orderable } = useAvailability(product);
  return (
    <ProductVisual
      media={product.media}
      name={product.name}
      slug={`${product.slug}-${suffix}`}
      sizes={sizes}
      priority={priority}
      className={`${rounded ? 'rounded-(--radius-image)' : ''} ${dim && !orderable ? 'opacity-55 grayscale-[0.35]' : ''} ${className}`}
    />
  );
}

export function FavoriteButton({ product, className = '' }: { product: MenuProductView; className?: string }) {
  const { t } = useApp();
  const { isFavorite, toggleFavorite } = useTemplate();
  const saved = isFavorite(product.id);
  return (
    <button
      type="button"
      aria-pressed={saved}
      aria-label={t(saved ? 'tpl.removeFavorite' : 'tpl.addFavorite', { name: product.name })}
      onClick={(event) => {
        event.stopPropagation();
        toggleFavorite(product);
      }}
      className={`tpl-icon-button ${saved ? 'text-(--accent-ink)' : 'text-(--muted)'} ${className}`}
    >
      <HeartIcon filled={saved} />
    </button>
  );
}

/**
 * The one action a card offers: add a product that needs no choices, or open it to choose. Nothing when the menu takes
 * no orders or the product cannot be ordered now. `icon` is for small buttons (a shape's tag, rim or stamp): always a
 * plus, its label still saying "Choose …" for a product with choices.
 */
export function QuickAction({
  product,
  variant = 'round',
  className = '',
  onAdded,
}: {
  product: MenuProductView;
  variant?: 'round' | 'label' | 'icon';
  className?: string;
  /** Runs after the dish is added straight away (not when it opens for a choice), with the button that added it. */
  onAdded?: (button: HTMLButtonElement) => void;
}) {
  const { t } = useApp();
  const { canOrder, quickAdd, openProduct } = useTemplate();
  const { orderable } = useAvailability(product);
  if (!canOrder || !orderable) return null;
  const choose = product.needsChoices;
  const label = choose ? t('tpl.chooseNamed', { name: product.name }) : t('product.quickAdd', { name: product.name });
  const act = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (choose) {
      openProduct(product.id);
      return;
    }
    const button = event.currentTarget;
    quickAdd(product);
    onAdded?.(button);
  };
  if (variant === 'label') {
    return (
      <button type="button" onClick={act} aria-label={label} className={`tpl-button tpl-button-small ${className}`}>
        {choose ? t('tpl.choose') : t('product.add')}
      </button>
    );
  }
  return (
    <button type="button" onClick={act} aria-label={label} className={`tpl-add ${className}`}>
      {choose && variant === 'round' ? <span className="text-xs leading-none">{t('tpl.choose')}</span> : <PlusIcon />}
    </button>
  );
}

/** The description, cut to a few lines. */
export function Description({ product, lines = 2, className = '' }: { product: MenuProductView; lines?: 1 | 2 | 3; className?: string }) {
  if (!product.description) return null;
  const clamp = lines === 1 ? 'line-clamp-1' : lines === 2 ? 'line-clamp-2' : 'line-clamp-3';
  return <span className={`block text-(--muted) ${clamp} ${className}`}>{product.description}</span>;
}
