'use client';

import type { CSSProperties, HTMLAttributes, ReactNode } from 'react';
import type { MenuProductView } from '@/server/data/menu-view';
import { useTemplate } from '../../context';
import { Badges, Description, Price, ProductMedia, QuickAction } from '../../parts';
import './photo-card.css';
import './rows.css';

/**
 * The row card several shapes share (a floor of the Elevator, a stop of the Metro Line, a tile in a Cabinet drawer):
 * a square photo, the name (the button that opens the dish, its tap area covering the whole card), the price with the
 * badges, an optional one-line description, and the add button. `rows.css` lays it out (`.rd-*`); every element also
 * carries `<prefix>-*` (for example `el-row`, `el-name`), so a shape decorates it and sets its gaps in its own CSS.
 */
export function RowDish({
  product,
  prefix,
  suffix,
  sizes,
  priority,
  order,
  description = false,
  iconAdd = false,
  plate = false,
  photoExtras,
  metaExtras,
  rowProps,
}: {
  product: MenuProductView;
  /** The shape's class prefix: `el` gives `el-row`, `el-photo`, `el-text`, `el-name`, `el-meta`, `el-price`… */
  prefix: string;
  /** The photo's media suffix (one per shape). */
  suffix: string;
  /** The photo's `sizes` at its largest. */
  sizes: string;
  priority: boolean;
  /** The row's place in its entrance stagger, set as `--i`; no stagger when absent. */
  order?: number;
  /** Shows the dish's description on one line (the shape's CSS decides at which widths). */
  description?: boolean;
  /** A plus on the add button even for a dish with choices (for a small, fixed-size button). */
  iconAdd?: boolean;
  /** A dish with no media shows the shared tinted plate (`tpl-plate`, photo-card.css) in its frame. */
  plate?: boolean;
  /** Drawn inside the photo frame after the photo (an effect laid over it); the frame clips it. */
  photoExtras?: ReactNode;
  /** Drawn in the price line after the badges (a chip). */
  metaExtras?: ReactNode;
  /** More attributes for the row (a `data-*` the shape's CSS reads). */
  rowProps?: HTMLAttributes<HTMLLIElement> & Record<`data-${string}`, string | undefined>;
}) {
  const { openProduct } = useTemplate();
  return (
    <li data-row {...rowProps} className={`rd-row ${prefix}-row`} style={order === undefined ? undefined : ({ '--i': order } as CSSProperties)}>
      <div data-photo className={`rd-photo ${prefix}-photo${plate ? ' tpl-plate' : ''}`}>
        <ProductMedia product={product} suffix={suffix} sizes={sizes} priority={priority} className={`${prefix}-img`} />
        {photoExtras}
      </div>
      <div className={`rd-text ${prefix}-text`}>
        <button type="button" onClick={() => openProduct(product.id)} className={`tpl-open rd-name ${prefix}-name text-start`}>
          {product.name}
        </button>
        <span className={`rd-meta ${prefix}-meta`}>
          <Price product={product} className={`rd-price ${prefix}-price`} />
          <Badges product={product} className={`${prefix}-badges`} />
          {metaExtras}
        </span>
        {description ? <Description product={product} lines={1} className={`${prefix}-desc`} /> : null}
      </div>
      <QuickAction product={product} variant={iconAdd ? 'icon' : 'round'} className={`${prefix}-add relative z-[2]`} />
    </li>
  );
}
