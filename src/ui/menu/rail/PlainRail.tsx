'use client';

import { useLayoutEffect, useRef } from 'react';
import { useApp } from '@/ui/AppProviders';
import type { RailProps } from './types';

const SLIDE = { duration: 350, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' } as const;

/** A row of category names with an underline that slides to the active one. */
export function PlainRail({ categories, activeId }: RailProps) {
  const { t } = useApp();
  const rail = useRef<HTMLElement>(null);
  const last = useRef<{ left: number; width: number } | null>(null);

  // The indicator is rendered inside whichever link is active, so it is a new element each time the active
  // category changes. It slides from where the previous one was: measure, apply the inverse offset, then let
  // the Web Animations API play it back to rest (FLIP). Positions are kept relative to the rail's scrolled
  // content so scrolling the rail between changes does not skew the start.
  useLayoutEffect(() => {
    const nav = rail.current;
    const indicator = nav?.querySelector<HTMLElement>('[data-rail-indicator]');
    if (!nav || !indicator) {
      last.current = null;
      return;
    }
    const box = indicator.getBoundingClientRect();
    const origin = nav.getBoundingClientRect().left - nav.scrollLeft;
    const now = { left: box.left - origin, width: box.width };
    const before = last.current;
    last.current = now;
    if (!before || typeof indicator.animate !== 'function') return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const shift = before.left - now.left;
    const stretch = before.width / now.width;
    if (shift === 0 && stretch === 1) return;
    indicator.animate(
      [{ transformOrigin: 'left center', transform: `translateX(${shift}px) scaleX(${stretch})` }, { transformOrigin: 'left center', transform: 'none' }],
      SLIDE,
    );
  }, [activeId]);

  return (
    <nav
      ref={rail}
      aria-label={t('menu.categories')}
      data-rail-style="plain"
      className="scroll-hidden sticky top-0 z-10 flex gap-1 overflow-x-auto border-b border-line bg-bg/90 px-3 backdrop-blur-md"
    >
      {categories.map((category) => {
        const active = category.id === activeId;
        return (
          <a
            key={category.id}
            href={`#cat-${category.slug}`}
            aria-current={active ? 'true' : undefined}
            className={`relative grid min-h-12 shrink-0 place-items-center px-3.5 text-[0.9375rem] transition-colors duration-150 ${
              active ? 'text-text' : 'text-muted [@media(hover:hover)]:hover:text-text'
            }`}
          >
            {category.name}
            {active && (
              <span
                data-rail-indicator
                aria-hidden="true"
                className="absolute inset-x-3.5 bottom-0 h-0.5 rounded-full bg-accent"
              />
            )}
          </a>
        );
      })}
    </nav>
  );
}
