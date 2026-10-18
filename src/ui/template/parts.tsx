'use client';

import type { MouseEvent } from 'react';
import type { MenuProductView } from '@/server/data/menu-view';
import { useApp } from '@/ui/AppProviders';
import { ProductVisual } from '@/ui/art/ProductVisual';
import { HeartIcon, PlusIcon } from '@/ui/Icons';
import { useTemplate } from './context';

/** The lowest price a product can be ordered at with no options: its cheapest size. */
export function lowestPrice(product: MenuProductView): number {
  if (product.variants.length < 2) return product.displayPrice;
  const base = product.displayPrice - (product.variants.find((variant) => variant.isDefault)?.priceDelta ?? 0);
  return Math.min(...product.variants.map((variant) => base + variant.priceDelta));
}

/** "From 4.50" when sizes start lower than the default, else the price itself. */
export function usePriceText(): (product: MenuProductView) => string {
  const { money, t } = useApp();
  return (product) => {
    const lowest = lowestPrice(product);
    return lowest < product.displayPrice ? t('tpl.from', { price: money(lowest) }) : money(product.displayPrice);
  };
}

export function Price({ product, className = '' }: { product: MenuProductView; className?: string }) {
  const text = usePriceText();
  return <span className={`tabular-nums text-(--accent-ink) ${className}`}>{text(product)}</span>;
}

/** Whether a product can be ordered right now, and the words for when it cannot. */
export function useAvailability(product: MenuProductView): { orderable: boolean; label: string | null } {
  const { t } = useApp();
  if (product.orderState === 'OK') return { orderable: true, label: null };
  return { orderable: false, label: t(product.orderState === 'OUT_OF_STOCK' ? 'product.soldOut' : 'product.unavailable') };
}

export function SoldOut({ product, className = '' }: { product: MenuProductView; className?: string }) {
  const { label } = useAvailability(product);
  if (!label) return null;
  return <span className={`text-sm text-(--muted) ${className}`}>{label}</span>;
}

/** The restaurant's own labels (new, popular, recommended), only when it gave them. */
export function Badges({ product, className = '' }: { product: MenuProductView; className?: string }) {
  const { t } = useApp();
  if (!product.badges) return null;
  return (
    <span className={`flex flex-wrap gap-1.5 ${className}`}>
      {product.badges.map((badge) => (
        <span key={badge} className="tpl-badge">
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
 * no orders or the product cannot be ordered now.
 */
export function QuickAction({ product, variant = 'round', className = '' }: { product: MenuProductView; variant?: 'round' | 'label'; className?: string }) {
  const { t } = useApp();
  const { canOrder, quickAdd, openProduct } = useTemplate();
  const { orderable } = useAvailability(product);
  if (!canOrder || !orderable) return null;
  const choose = product.needsChoices;
  const label = choose ? t('tpl.chooseNamed', { name: product.name }) : t('product.quickAdd', { name: product.name });
  const act = (event: MouseEvent) => {
    event.stopPropagation();
    if (choose) openProduct(product.id);
    else quickAdd(product);
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
      {choose ? <span className="text-xs leading-none">{t('tpl.choose')}</span> : <PlusIcon />}
    </button>
  );
}

/** The description, cut to a few lines. */
export function Description({ product, lines = 2, className = '' }: { product: MenuProductView; lines?: 1 | 2 | 3; className?: string }) {
  if (!product.description) return null;
  const clamp = lines === 1 ? 'line-clamp-1' : lines === 2 ? 'line-clamp-2' : 'line-clamp-3';
  return <span className={`block text-(--muted) ${clamp} ${className}`}>{product.description}</span>;
}
