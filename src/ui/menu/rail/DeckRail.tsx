'use client';

import { useEffect, useRef } from 'react';
import { direction } from '@/lib/locale';
import { deckPose } from '@/lib/rail';
import { useApp } from '@/ui/AppProviders';
import { usePrefersReducedMotion } from '@/ui/use-prefers-reduced-motion';
import { DishIcon } from './DishIcon';
import type { RailProps } from './types';
import { useSwipePosition } from './use-swipe-position';

/** Pixels of drag that move the fan by one card. */
const CARD_STEP = 78;
const GLINT = { duration: 1100, delay: 320, easing: 'cubic-bezier(0.3, 0.6, 0.3, 1)' } as const;

/**
 * The categories as a fanned deck of gilded cards. The active category's card lifts to the front and a light
 * sweeps across it; the rest fan out behind it, turned and receding. Guests drag the fan sideways to look
 * through the deck and tap a card to go to it. Keyboard focus brings the focused card to the front.
 */
export function DeckRail({ categories, activeId }: RailProps) {
  const { t, locale } = useApp();
  const rtl = direction(locale) === 'rtl';
  const reduced = usePrefersReducedMotion();
  const rail = useRef<HTMLElement>(null);
  const active = Math.max(0, categories.findIndex((category) => category.id === activeId));
  // The card the fan is centred on follows the active category, until the guest drags or tabs through it.
  const { position, dragging, turnTo, handlers } = useSwipePosition(active, categories.length, rtl, CARD_STEP);

  // A light sweeps across the card that has just become active. Not on first paint, and not for reduced motion.
  const glinted = useRef<string | null>(activeId);
  useEffect(() => {
    if (glinted.current === activeId) return;
    glinted.current = activeId;
    if (reduced) return;
    const glint = rail.current?.querySelector<HTMLElement>('[aria-current="true"] [data-glint]');
    glint?.animate?.(
      [{ transform: 'translateX(-120%) rotate(20deg)' }, { transform: 'translateX(420%) rotate(20deg)' }],
      GLINT,
    );
  }, [activeId, reduced]);

  return (
    <nav
      ref={rail}
      aria-label={t('menu.categories')}
      data-rail-style="deck"
      {...handlers}
      style={{ perspective: '800px', perspectiveOrigin: '50% 10%' }}
      className="sticky top-0 z-10 h-[5.75rem] touch-pan-y overflow-hidden border-b border-line bg-bg/90 backdrop-blur-md select-none"
    >
      {categories.map((category, index) => {
        const current = category.id === activeId;
        const pose = deckPose(index - position, rtl);
        return (
          <a
            key={category.id}
            href={`#cat-${category.slug}`}
            aria-current={current ? 'true' : undefined}
            draggable={false}
            onFocus={() => turnTo(index)}
            style={{
              transform: `translate3d(calc(-50% + ${pose.x}px), ${pose.y}px, ${pose.z}px) rotateY(${pose.rotateY}deg) rotateZ(${pose.rotateZ}deg)`,
              opacity: pose.opacity,
              zIndex: pose.layer,
              pointerEvents: pose.opacity < 0.05 ? 'none' : undefined,
              transitionDuration: dragging || reduced ? '0ms' : undefined,
            }}
            className={`absolute bottom-3 left-1/2 flex h-[3.9rem] w-[6.5rem] flex-col items-center justify-center gap-1 overflow-hidden rounded-lg border bg-surface transition-[transform,opacity,border-color,color] duration-700 ease-[cubic-bezier(0.2,0.9,0.25,1.08)] ${
              current ? 'border-accent text-text' : 'border-line text-muted'
            }`}
          >
            <DishIcon dish={category.dish} className={current ? 'text-accent' : undefined} />
            <span className="max-w-full truncate px-2 text-[0.8125rem] leading-tight">{category.name}</span>
            {current && (
              <span data-rail-indicator aria-hidden="true" className="absolute inset-x-7 bottom-1 h-0.5 rounded-full bg-accent" />
            )}
            <span
              aria-hidden="true"
              style={{ opacity: pose.shade, transitionDuration: dragging || reduced ? '0ms' : undefined }}
              className="pointer-events-none absolute inset-0 bg-bg transition-opacity duration-700"
            />
            <span
              data-glint
              aria-hidden="true"
              className="pointer-events-none absolute -top-1/4 left-0 h-[150%] w-1/3 -translate-x-[120%] rotate-[20deg] bg-[#fff2d9]/15"
            />
          </a>
        );
      })}
    </nav>
  );
}
