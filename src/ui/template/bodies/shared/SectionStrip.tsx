'use client';

import { useRef, type CSSProperties, type MouseEvent, type ReactNode } from 'react';
import { useApp } from '@/ui/AppProviders';
import { useTemplate, type MenuCategory } from '../../context';
import { useKeepInView } from './useKeepInView';

/**
 * A shape's strip of sections (aisle signs, ticket numbers, napkins, page chips, a route, a dock): a sticky `<nav>` with
 * one button per category that jumps to it and is lit (`aria-current`) while its section is in view. The strip keeps the
 * lit button in view, moving only itself (never the page). `marker` names the nav's data attribute (`signs` gives
 * `data-signs`); `prefix` gives the shape's classes (`sf` gives `sf-strip`, `sf-strip-list` and the chip `sf-chip`
 * unless `chip` names another). The shape draws each button's inside with `children`.
 */
export function SectionStrip({
  marker,
  prefix,
  className = '',
  chip,
  chipStyle,
  onPick,
  lead,
  children,
}: {
  marker: string;
  prefix: string;
  /** Classes for the nav besides `tpl-strip-sticky`. */
  className?: string;
  /** The button's class; `<prefix>-chip` when absent. */
  chip?: string;
  /** Per-button style (a hue, for example). */
  chipStyle?: (category: MenuCategory, index: number) => CSSProperties | undefined;
  /** Called with the tapped chip just before the page jumps (a shape that answers the tap with its own effect). */
  onPick?: (category: MenuCategory, button: HTMLButtonElement) => void;
  /** Drawn in the nav before the list (a caption for the lit section); the buttons stay the strip's own. */
  lead?: ReactNode;
  children: (category: MenuCategory, index: number) => ReactNode;
}) {
  const { t } = useApp();
  const { categories, activeId, jumpTo, reduced } = useTemplate();
  const strip = useRef<HTMLUListElement>(null);
  useKeepInView(strip, activeId, 'x', reduced);
  return (
    <nav aria-label={t('menu.categories')} {...{ [`data-${marker}`]: '' }} className={`tpl-strip-sticky ${className}`}>
      {lead}
      <ul ref={strip} className={`scroll-hidden tpl-strip-list ${prefix}-strip-list`}>
        {categories.map((category, index) => (
          <li key={category.id}>
            <button
              type="button"
              data-category={category.id}
              aria-current={category.id === activeId ? 'true' : undefined}
              onClick={(event: MouseEvent<HTMLButtonElement>) => {
                onPick?.(category, event.currentTarget);
                jumpTo(category.id);
              }}
              className={chip ?? `${prefix}-chip`}
              style={chipStyle?.(category, index)}
            >
              {children(category, index)}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/**
 * A shape's section heading: the focus target of a jump (`data-heading`), an `<h2>` with an optional small label (the
 * section's number in the shape's words), the name, and the dish count (`data-count`, read by the shape's CSS only).
 */
export function ShapeHeading({
  id,
  name,
  label,
  count,
  className = '',
  title,
  lead,
}: {
  id: string;
  name: string;
  label?: string;
  count: string;
  /** Classes for the focusable wrapper. */
  className?: string;
  /** Classes for the `<h2>`. */
  title: string;
  /** An ornament drawn first inside the `<h2>` (a crescent); it is decoration, so mark it `aria-hidden`. */
  lead?: ReactNode;
}) {
  return (
    <div tabIndex={-1} data-heading className={`outline-none ${className}`}>
      <h2 id={id} className={`tpl-display ${title}`}>
        {lead}
        {label ? <small aria-hidden>{label}</small> : null}
        <span>{name}</span>
        <b data-count aria-hidden>
          {count}
        </b>
      </h2>
    </div>
  );
}
