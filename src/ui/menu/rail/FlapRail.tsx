'use client';

import { useEffect, useRef } from 'react';
import { hasJoiningScript } from '@/lib/joining';
import { useApp } from '@/ui/AppProviders';
import { usePrefersReducedMotion } from '@/ui/use-prefers-reduced-motion';
import { flipBoard } from './flap';
import type { RailProps } from './types';
import { useCentreActive } from './use-centre-active';

const CELL =
  'relative inline-grid h-[1.65em] place-items-center rounded-[3px] bg-raised font-display text-accent after:absolute after:inset-x-0 after:top-1/2 after:h-px after:bg-bg/70';

/**
 * A row of category names where the active one is set in split-flap tiles. When the category changes, its
 * letters spin and land one after another like a departures board.
 */
export function FlapRail({ categories, activeId }: RailProps) {
  const { t } = useApp();
  const reduced = usePrefersReducedMotion();
  const rail = useRef<HTMLElement>(null);
  useCentreActive(rail, activeId, reduced);

  // Play the board when a category becomes active; not on first paint, and not for reduced motion.
  const played = useRef(activeId);
  useEffect(() => {
    if (played.current === activeId) return;
    played.current = activeId;
    const link = rail.current?.querySelector<HTMLElement>('[aria-current="true"]');
    if (!link || reduced) return;
    return flipBoard(link);
  }, [activeId, reduced]);

  return (
    <nav
      ref={rail}
      aria-label={t('menu.categories')}
      data-rail-style="flap"
      className="scroll-hidden sticky top-0 z-10 flex gap-1 overflow-x-auto border-b border-line bg-bg/90 px-3 backdrop-blur-md"
    >
      {categories.map((category) => {
        const current = category.id === activeId;
        return (
          <a
            key={category.id}
            href={`#cat-${category.slug}`}
            aria-current={current ? 'true' : undefined}
            aria-label={current ? category.name : undefined}
            className={`relative flex min-h-[3.25rem] shrink-0 items-center px-3 text-[0.9375rem] transition-colors duration-150 ${
              current ? 'text-text' : 'text-muted [@media(hover:hover)]:hover:text-text'
            }`}
          >
            {current ? (
              <span aria-hidden="true" className="flex gap-px text-[1.0625rem]" style={{ perspective: '320px' }}>
                {/* Joined scripts flip whole words, whatever the page's language: letters apart lose their joins. */}
                {!hasJoiningScript(category.name) ? (
                  [...category.name].map((char, index) =>
                    char === ' ' ? (
                      <span key={index} className="w-1.5" />
                    ) : (
                      <span key={index} data-flap={char} className={`${CELL} w-[0.78em]`}>
                        {char}
                      </span>
                    ),
                  )
                ) : (
                  <span data-flap={category.name} data-word="" className={`${CELL} px-2`}>
                    {category.name}
                  </span>
                )}
              </span>
            ) : (
              category.name
            )}
            {current && (
              <span data-rail-indicator aria-hidden="true" className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-accent" />
            )}
          </a>
        );
      })}
    </nav>
  );
}
