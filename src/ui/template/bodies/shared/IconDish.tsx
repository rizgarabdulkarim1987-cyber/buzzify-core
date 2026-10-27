'use client';

import type { CSSProperties, HTMLAttributes, ReactNode } from 'react';
import type { MenuProductView } from '@/server/data/menu-view';
import { useTemplate } from '../../context';
import { Price, ProductMedia, QuickAction } from '../../parts';
import './photo-card.css';

export interface IconDishProps {
  product: MenuProductView;
  /**
   * The shape's class prefix: the cell's parts are `<prefix>-photo`, `<prefix>-img`, `<prefix>-add` and `<prefix>-name`,
   * and the photo's SVG ids take `suffix` (the shape's kind).
   */
  prefix: string;
  suffix: string;
  /** The cell's (`li`) own classes, and the photo frame's (the head: the photo with what sits on its rim). */
  cell: string;
  head: string;
  /** The price's own class (a tag, a pill, a badge, a lid). */
  price: string;
  /** Where the price sits: above the photo inside the head, in the head after the photo, or under the head. */
  pricePlace: 'top' | 'head' | 'below';
  /** The photo covers its frame (`tpl-cover-media`, the frame sized elsewhere) or fills it (`tpl-fill-media`). */
  media?: 'fill' | 'cover';
  /** Drawn in the head after the photo (a level number, a sale chip), under the add button. */
  extras?: ReactNode;
  /** Drawn inside the photo frame after the photo, and the add button there too (for a frame that is the head's foot). */
  inPhoto?: ReactNode;
  addInPhoto?: boolean;
  /** A dish with no media shows the shared tinted plate (`tpl-plate`, photo-card.css) in its frame. */
  plate?: boolean;
  sizes: string;
  priority: boolean;
  /** The entrance order (`--i`). */
  order: number;
  /** More attributes and style for the cell (a grid place, a road link). */
  cellProps?: HTMLAttributes<HTMLLIElement> & Record<`data-${string}`, string | undefined>;
  style?: CSSProperties;
}

/**
 * A dish as an icon-sized cell (spec 2026-10-26-menu-styles-in-templates-design.md): its photo in the shape's frame,
 * its price in a tight spot (`tpl-price-tight`), a small add button on the rim, and its name below as the button that
 * opens it; the cell is the name's positioned ancestor, so the whole cell is the tap area. The shapes that draw dishes
 * this way (the home screen's apps, the map's pins, the game's levels, the fridge's jars) keep only their frame and
 * decoration.
 */
export function IconDish({ product, prefix, suffix, cell, head, price, pricePlace, media = 'fill', extras, inPhoto, addInPhoto = false, plate = false, sizes, priority, order, cellProps, style }: IconDishProps) {
  const { openProduct } = useTemplate();
  const priceTag = <Price product={product} className={`tpl-price-tight ${price}`} />;
  const add = <QuickAction product={product} variant="icon" className={`tpl-rim-add ${prefix}-add relative z-[2]`} />;
  return (
    <li data-row {...cellProps} className={cell} style={{ ...style, '--i': order } as CSSProperties}>
      <div className={head}>
        {pricePlace === 'top' && priceTag}
        <div data-photo className={`${prefix}-photo ${media === 'cover' ? 'tpl-cover-media' : 'tpl-fill-media'}${plate ? ' tpl-plate' : ''}`}>
          <ProductMedia product={product} suffix={suffix} sizes={sizes} priority={priority} className={`${prefix}-img`} rounded={false} />
          {inPhoto}
          {addInPhoto && add}
        </div>
        {pricePlace === 'head' && priceTag}
        {extras}
        {!addInPhoto && add}
      </div>
      {pricePlace === 'below' && priceTag}
      <button type="button" onClick={() => openProduct(product.id)} className={`tpl-open tpl-dish-name ${prefix}-name text-center`}>
        {product.name}
      </button>
    </li>
  );
}
