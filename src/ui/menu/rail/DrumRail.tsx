'use client';

import { direction } from '@/lib/locale';
import { drumRadius, drumStep } from '@/lib/rail';
import { useApp } from '@/ui/AppProviders';
import { usePrefersReducedMotion } from '@/ui/use-prefers-reduced-motion';
import type { RailProps } from './types';
import { useSwipePosition } from './use-swipe-position';

/** Width of one name on the drum, in pixels (8.5rem). */
const NAME_WIDTH = 136;
/** Degrees the drum leans back so the guest sees its rings curve. */
const TILT = 10;

/**
 * The category names printed round a gold-ringed drum seen slightly from above. The drum turns so the active
 * category faces the guest; its neighbours curve away and dim. Guests drag sideways to spin it and tap a name
 * to go there; keyboard focus turns the focused name to the front.
 */
export function DrumRail({ categories, activeId }: RailProps) {
  const { t, locale } = useApp();
  const rtl = direction(locale) === 'rtl';
  const reduced = usePrefersReducedMotion();
  const active = Math.max(0, categories.findIndex((category) => category.id === activeId));
  const { position, dragging, turnTo, handlers } = useSwipePosition(active, categories.length, rtl, NAME_WIDTH);
  const step = drumStep(categories.length);
  const radius = drumRadius(step, NAME_WIDTH);
  // Tilting the drum about its axle drops the front name; lift it back so the front name stays centred.
  const lift = radius * Math.sin((TILT * Math.PI) / 180);
  // Later names sit further round toward the end of the line, so the drum turns the other way in RTL.
  const side = rtl ? -1 : 1;
  const still = dragging || reduced;

  return (
    <nav
      aria-label={t('menu.categories')}
      data-rail-style="drum"
      {...handlers}
      style={{ perspective: '640px' }}
      className="sticky top-0 z-10 h-[4.5rem] touch-pan-y overflow-hidden border-b border-line bg-bg/90 backdrop-blur-md select-none"
    >
      <span aria-hidden="true" className="absolute top-1 left-1/2 size-1 -translate-x-1/2 rounded-full bg-accent" />
      <div
        style={{
          transformStyle: 'preserve-3d',
          transform: `translateY(${-lift}px) translateZ(${-radius}px) rotateX(${-TILT}deg) rotateY(${-side * position * step}deg)`,
          transitionDuration: still ? '0ms' : undefined,
        }}
        className="absolute top-1/2 left-1/2 transition-transform duration-1000 ease-[cubic-bezier(0.2,0.8,0.2,1)]"
      >
        {categories.map((category, index) => {
          const current = category.id === activeId;
          const away = Math.abs(index - position);
          return (
            <a
              key={category.id}
              href={`#cat-${category.slug}`}
              aria-current={current ? 'true' : undefined}
              draggable={false}
              onFocus={() => turnTo(index)}
              style={{
                transform: `rotateY(${side * index * step}deg) translateZ(${radius}px)`,
                opacity: Math.max(0.18, 1 - away * 0.3),
                backfaceVisibility: 'hidden',
                transitionDuration: still ? '0ms' : undefined,
              }}
              className={`absolute -mt-5 -ml-[4.25rem] grid h-10 w-[8.5rem] place-items-center border-y border-accent/40 text-[0.9375rem] transition-[color,opacity] duration-500 ${
                current ? 'text-text' : 'text-muted'
              }`}
            >
              <span className="max-w-full truncate px-2">{category.name}</span>
              {current && (
                <span
                  data-rail-indicator
                  aria-hidden="true"
                  className="absolute bottom-1 left-1/2 h-0.5 w-6 -translate-x-1/2 rounded-full bg-accent"
                />
              )}
            </a>
          );
        })}
      </div>
    </nav>
  );
}
