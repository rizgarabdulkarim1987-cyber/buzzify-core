'use client';

import type { CSSProperties, MouseEvent, ReactNode } from 'react';
import type { MenuProductView } from '@/server/data/menu-view';
import { useTemplate } from '../../context';
import { DishCounts, Price, ProductMedia, SaleChip } from '../../parts';
import './photo-card.css';

export interface PhotoCardProps {
  product: MenuProductView;
  /** The shape's class prefix: the parts are `<prefix>-photo`, `<prefix>-img`, `<prefix>-off`, `<prefix>-bar`, `<prefix>-name` and `<prefix>-price`. */
  prefix: string;
  /** The photo's SVG ids take it (the shape's kind). */
  suffix: string;
  /** The cell's (`li`) own classes and style (a grid span, the entrance order). */
  className: string;
  style?: CSSProperties;
  sizes: string;
  priority: boolean;
  /** The add button (the shape's own quick add): on the photo's corner, or on the bar after the price (`addOnBar`). */
  add: ReactNode;
  /** Put the add on the bar beside the price instead of over the photo. */
  addOnBar?: boolean;
  /** Put the photo after the bar in the page order (a shape whose photo sits at the end of its card). */
  photoLast?: boolean;
  /** What tapping the card does; opens the dish when absent. */
  onOpen?: (event: MouseEvent<HTMLButtonElement>) => void;
}

/**
 * A dish as a photo card over a solid caption bar (Photo to Details' tiles, Fly to Cart's cards): the photo covering its
 * frame (`[data-photo]`, with the sale chip and the add button on it, and a plate drawn on the media when the dish has
 * none), then the name (the button that opens the dish; the cell is its positioned ancestor, so the whole card is the
 * tap area) and the price. The shapes keep only their grid and decoration.
 */
export function PhotoCard({ product, prefix, suffix, className, style, sizes, priority, add, addOnBar = false, photoLast = false, onOpen }: PhotoCardProps) {
  const { openProduct } = useTemplate();
  const photo = (
    <div data-photo className={`${prefix}-photo tpl-cover-media tpl-plate`}>
      <ProductMedia product={product} suffix={suffix} sizes={sizes} priority={priority} className={`${prefix}-img`} rounded={false} />
      <SaleChip product={product} className={`tpl-photo-off ${prefix}-off`} />
      {!addOnBar && add}
    </div>
  );
  return (
    <li data-row className={`tpl-photo-card ${className}`} style={style}>
      {!photoLast && photo}
      <div className={`tpl-photo-bar ${prefix}-bar`}>
        <button type="button" onClick={onOpen ?? (() => openProduct(product.id))} className={`tpl-open tpl-dish-name tpl-photo-name ${prefix}-name`}>
          {product.name}
        </button>
        <Price product={product} className={`tpl-price-tight tpl-photo-price ${prefix}-price`} />
        {addOnBar && add}
      </div>
      <DishCounts product={product} className="block px-2 pb-1.5" />
      {photoLast && photo}
    </li>
  );
}
