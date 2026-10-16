'use client';

import { useEffect, useRef, useState } from 'react';
import { useApp } from '@/ui/AppProviders';
import { usePrefersReducedMotion } from '@/ui/use-prefers-reduced-motion';
import { DishIcon } from './DishIcon';
import type { GrainEngine } from './grain-engine';
import type { RailProps } from './types';
import { useCentreActive } from './use-centre-active';

function savesData(): boolean {
  return Boolean((navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData);
}

/**
 * Category names with the active category's dish standing above its name, made of gold grains. When the
 * category changes, the dish melts, streams along the rail and reforms as the next category's dish.
 *
 * The grains are drawn by a small canvas engine downloaded once the page is idle, so the menu's first paint
 * does not wait for it. Until then, and for reduced motion or data saving, a line drawing of the dish stands in.
 */
export function GrainsRail({ categories, activeId }: RailProps) {
  const { t } = useApp();
  const reduced = usePrefersReducedMotion();
  const rail = useRef<HTMLElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [engine, setEngine] = useState<GrainEngine | null>(null);
  const running = engine !== null && !reduced;
  useCentreActive(rail, activeId, reduced);

  useEffect(() => {
    if (reduced || savesData()) return;
    let cancelled = false;
    let made: GrainEngine | null = null;
    const load = () => {
      void import('./grain-engine').then(({ createGrainEngine }) => {
        if (cancelled || !canvas.current) return;
        made = createGrainEngine(canvas.current);
        setEngine(made);
      });
    };
    const idle = typeof window.requestIdleCallback === 'function';
    const handle = idle ? window.requestIdleCallback(load, { timeout: 2000 }) : window.setTimeout(load, 800);
    return () => {
      cancelled = true;
      if (idle) window.cancelIdleCallback(handle);
      else window.clearTimeout(handle);
      made?.dispose();
    };
  }, [reduced]);

  const activeDish = categories.find((category) => category.id === activeId)?.dish ?? null;
  useEffect(() => {
    if (!engine || !activeDish) return;
    const slot = rail.current?.querySelector<HTMLElement>('[aria-current="true"] [data-dish-slot]');
    if (slot) engine.show(activeDish, slot);
  }, [engine, activeId, activeDish]);

  return (
    <div className="sticky top-0 z-10 border-b border-line bg-bg/90 backdrop-blur-md">
      <nav
        ref={rail}
        aria-label={t('menu.categories')}
        data-rail-style="grains"
        data-grains={running ? 'live' : 'still'}
        className="scroll-hidden flex gap-1 overflow-x-auto px-3"
      >
        {categories.map((category) => {
          const current = category.id === activeId;
          return (
            <a
              key={category.id}
              href={`#cat-${category.slug}`}
              aria-current={current ? 'true' : undefined}
              className={`relative flex shrink-0 flex-col items-center px-3.5 pt-1 pb-3 text-[0.9375rem] transition-colors duration-150 ${
                current ? 'text-text' : 'text-muted [@media(hover:hover)]:hover:text-text'
              }`}
            >
              <span data-dish-slot aria-hidden="true" className="flex h-11 w-14 items-end justify-center">
                {current && (
                  <DishIcon
                    dish={category.dish}
                    className={`mb-1 text-accent transition-opacity duration-500 ${running ? 'opacity-0' : ''}`}
                  />
                )}
              </span>
              <span className="mt-0.5 leading-tight">{category.name}</span>
              {current && (
                <span data-rail-indicator aria-hidden="true" className="absolute inset-x-3.5 bottom-0 h-0.5 rounded-full bg-accent" />
              )}
            </a>
          );
        })}
      </nav>
      <canvas ref={canvas} aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-[3.25rem] w-full" />
    </div>
  );
}
