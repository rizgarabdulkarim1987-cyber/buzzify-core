'use client';

import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import type { NavKind } from '@/lib/templates/types';
import { useApp } from '@/ui/AppProviders';
import { ChevronDownIcon, ListIcon } from '@/ui/Icons';
import { useTemplate, type MenuCategory } from './context';
import { ProductMedia } from './parts';

/**
 * The sticky category navigation (spec 5, navigation kinds). Every kind jumps to a category and marks the one in view
 * with `aria-current`; none takes over the page's scroll.
 */

/** Keeps the active entry of a horizontal strip in view, moving only the strip (never the page). */
function useActiveInView(strip: RefObject<HTMLElement | null>, activeId: string | null) {
  const { reduced } = useTemplate();
  useEffect(() => {
    const container = strip.current;
    const active = activeId ? container?.querySelector<HTMLElement>(`[data-category="${CSS.escape(activeId)}"]`) : null;
    if (!container || !active) return;
    const box = container.getBoundingClientRect();
    const item = active.getBoundingClientRect();
    const margin = 24;
    let delta = 0;
    if (item.left < box.left + margin) delta = item.left - box.left - margin;
    else if (item.right > box.right - margin) delta = item.right - box.right + margin;
    if (delta !== 0) container.scrollBy({ left: delta, behavior: reduced ? 'auto' : 'smooth' });
  }, [strip, activeId, reduced]);
}

interface StripProps {
  itemClass: string;
  activeClass?: string;
  className?: string;
  render?: (category: MenuCategory) => ReactNode;
}

/** A horizontal strip of category buttons, the base of most kinds. */
function Strip({ itemClass, className = '', render }: StripProps) {
  const { t } = useApp();
  const { categories, activeId, jumpTo } = useTemplate();
  const strip = useRef<HTMLUListElement>(null);
  useActiveInView(strip, activeId);
  return (
    <ul ref={strip} className={`scroll-hidden flex overflow-x-auto overscroll-x-contain ${className}`}>
      {categories.map((category) => (
        <li key={category.id} className="shrink-0">
          <button
            type="button"
            data-category={category.id}
            aria-current={category.id === activeId ? 'true' : undefined}
            onClick={() => jumpTo(category.id)}
            className={itemClass}
            aria-label={render ? t('tpl.categoryJump', { name: category.name }) : undefined}
          >
            {render ? render(category) : category.name}
          </button>
        </li>
      ))}
    </ul>
  );
}

function NavFrame({ children, className = '' }: { children: ReactNode; className?: string }) {
  const { t } = useApp();
  return (
    <nav aria-label={t('menu.categories')} className={`tpl-nav ${className}`}>
      {children}
    </nav>
  );
}

function UnderlineNav() {
  return (
    <NavFrame>
      <Strip className="gap-7 px-(--gutter)" itemClass="tpl-nav-underline" />
    </NavFrame>
  );
}

function PillsNav() {
  return (
    <NavFrame>
      <Strip className="gap-2 px-(--gutter) py-2.5" itemClass="tpl-nav-pill" />
    </NavFrame>
  );
}

function ChipsNav() {
  return (
    <NavFrame>
      <Strip className="gap-2 px-(--gutter) py-2.5" itemClass="tpl-chip tpl-nav-chip" />
    </NavFrame>
  );
}

/** Names in a quiet row on a phone; a column beside the menu on a wide screen (the layout places it). */
function IndexNav() {
  return (
    <NavFrame className="tpl-nav-index">
      <Strip className="gap-6 px-(--gutter) lg:flex-col lg:gap-1 lg:overflow-visible lg:px-0" itemClass="tpl-nav-index-item" />
    </NavFrame>
  );
}

function SegmentedNav() {
  const { categories } = useTemplate();
  const fits = categories.length <= 4;
  return (
    <NavFrame>
      <div className="px-(--gutter) py-2.5">
        <Strip className={`tpl-segmented ${fits ? '[&>li]:flex-1' : ''}`} itemClass="tpl-segment" />
      </div>
    </NavFrame>
  );
}

/** Small picture tiles: the first dish of each category with its name. */
function TilesNav() {
  const { byCategory } = useTemplate();
  return (
    <NavFrame>
      <Strip
        className="gap-3 px-(--gutter) py-2.5"
        itemClass="tpl-nav-tile"
        render={(category) => {
          const cover = (byCategory.get(category.id) ?? [])[0];
          return (
            <>
              {cover ? <ProductMedia product={cover} dim={false} suffix="nav" sizes="40px" className="size-10 shrink-0" /> : null}
              <span className="max-w-[8rem] truncate">{category.name}</span>
            </>
          );
        }}
      />
    </NavFrame>
  );
}

/** A disclosure that lists every category, opened from a bar or a dock. Escape and a choice close it. */
function CategoryPanel({ open, onClose, id }: { open: boolean; onClose: () => void; id: string }) {
  const { categories, activeId, jumpTo, byCategory } = useTemplate();
  const { t } = useApp();
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    panel.current?.querySelector<HTMLElement>('button[aria-current="true"], button')?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div ref={panel} id={id} className="tpl-panel">
      <ul className="grid gap-1">
        {categories.map((category) => (
          <li key={category.id}>
            <button
              type="button"
              aria-current={category.id === activeId ? 'true' : undefined}
              onClick={() => {
                onClose();
                jumpTo(category.id);
              }}
              className="tpl-panel-item"
            >
              <span className="tpl-display">{category.name}</span>
              <span className="text-sm tabular-nums text-(--muted)">{t('cart.items', { count: byCategory.get(category.id)?.length ?? 0 })}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The chapter in view, named, with a quick menu of all chapters one tap away. */
function ChaptersNav() {
  const { t } = useApp();
  const { categories, activeId } = useTemplate();
  const [open, setOpen] = useState(false);
  const current = categories.find((category) => category.id === activeId) ?? categories[0];
  return (
    <NavFrame className="relative">
      <div className="flex min-h-14 items-center justify-between gap-4 px-(--gutter)">
        <p className="tpl-display tpl-name min-w-0 truncate" aria-live="polite">
          {current?.name}
        </p>
        <button type="button" aria-expanded={open} aria-controls="tpl-quick-menu" onClick={() => setOpen((value) => !value)} className="tpl-button tpl-button-ghost shrink-0">
          <ListIcon className="size-4" />
          {t('tpl.quickMenu')}
        </button>
      </div>
      <CategoryPanel id="tpl-quick-menu" open={open} onClose={() => setOpen(false)} />
    </NavFrame>
  );
}

/** A dock at the bottom, under the thumb, with the category in view; it lifts above the order bar when one shows. */
function DockNav() {
  const { t, itemCount } = useApp();
  const { categories, activeId, canOrder } = useTemplate();
  const [open, setOpen] = useState(false);
  const current = categories.find((category) => category.id === activeId) ?? categories[0];
  const lifted = canOrder && itemCount > 0;
  return (
    <nav aria-label={t('menu.categories')} className={`tpl-dock ${lifted ? 'tpl-dock-lifted' : ''}`}>
      <CategoryPanel id="tpl-dock-menu" open={open} onClose={() => setOpen(false)} />
      <button type="button" aria-expanded={open} aria-controls="tpl-dock-menu" onClick={() => setOpen((value) => !value)} className="tpl-dock-button">
        <ListIcon className="size-5 shrink-0" />
        <span className="tpl-display min-w-0 flex-1 truncate text-start">{current?.name ?? t('tpl.allCategories')}</span>
        <ChevronDownIcon className={`size-5 shrink-0 transition-transform duration-200 ${open ? '' : 'rotate-180'}`} />
      </button>
    </nav>
  );
}

export function Nav({ kind }: { kind: NavKind }) {
  switch (kind) {
    case 'pills':
      return <PillsNav />;
    case 'chips':
      return <ChipsNav />;
    case 'index':
      return <IndexNav />;
    case 'chapters':
      return <ChaptersNav />;
    case 'segmented':
      return <SegmentedNav />;
    case 'tiles':
      return <TilesNav />;
    case 'dock':
      return <DockNav />;
    default:
      return <UnderlineNav />;
  }
}
