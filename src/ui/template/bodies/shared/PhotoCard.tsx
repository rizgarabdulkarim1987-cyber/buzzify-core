'use client';

import type { CSSProperties, MouseEvent, ReactNode } from 'react';
import type { MenuProductView } from '@/server/data/menu-view';
import { useTemplate } from '../../context';
import { Price, ProductMedia, SaleChip } from '../../parts';
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
  /** The add button on the photo's corner (the shape's own quick add). */
  add: ReactNode;
  /** What tapping the card does; opens the dish when absent. */
  onOpen?: (event: MouseEvent<HTMLButtonElement>) => void;
}

/**
 * A dish as a photo card over a solid caption bar (Photo to Details' tiles, Fly to Cart's cards): the photo covering its
 * frame (`[data-photo]`, with the sale chip and the add button on it, and a plate drawn on the media when the dish has
 * none), then the name (the button that opens the dish; the cell is its positioned ancestor, so the whole card is the
 * tap area) and the price. The shapes keep only their grid and decoration.
 */
export function PhotoCard({ product, prefix, suffix, className, style, sizes, priority, add, onOpen }: PhotoCardProps) {
  const { openProduct } = useTemplate();
  return (
    <li data-row className={`tpl-photo-card ${className}`} style={style}>
      <div data-photo className={`${prefix}-photo tpl-cover-media tpl-plate`}>
        <ProductMedia product={product} suffix={suffix} sizes={sizes} priority={priority} className={`${prefix}-img`} rounded={false} />
        <SaleChip product={product} className={`tpl-photo-off ${prefix}-off`} />
        {add}
      </div>
      <div className={`tpl-photo-bar ${prefix}-bar`}>
        <button type="button" onClick={onOpen ?? (() => openProduct(product.id))} className={`tpl-open tpl-dish-name tpl-photo-name ${prefix}-name`}>
          {product.name}
        </button>
        <Price product={product} className={`tpl-price-tight tpl-photo-price ${prefix}-price`} />
      </div>
    </li>
  );
}
