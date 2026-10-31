'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { MediaItem } from '@/lib/media';
import { useApp } from '@/ui/AppProviders';
import { ProductVisual } from '@/ui/art/ProductVisual';

const REFRESH_MS = 5 * 60_000;

export interface TvDish {
  id: string;
  slug: string;
  name: string;
  price: string;
  media: MediaItem[];
}

export interface TvPage {
  key: string;
  name: string;
  page: number;
  pages: number;
  dishes: TvDish[];
}

/**
 * The menu on a wall screen: one category page at a time, turning by itself, asking the server for fresh data now and then.
 * Nothing here can be tapped; the arrow keys and F (full screen) are for whoever sets the screen up.
 */
export function TvBoard({ pages, seconds }: { pages: TvPage[]; seconds: number }) {
  const { t, tenant } = useApp();
  const router = useRouter();
  const [index, setIndex] = useState(0);
  const count = pages.length;
  // The loop can get shorter when the menu is refreshed; the place on screen stays valid.
  const at = count === 0 ? 0 : index % count;

  useEffect(() => {
    if (count < 2) return;
    const timer = window.setTimeout(() => setIndex(at + 1), seconds * 1000);
    return () => window.clearTimeout(timer);
  }, [at, count, seconds]);

  useEffect(() => {
    const timer = window.setInterval(() => router.refresh(), REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [router]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') setIndex((current) => current + 1);
      else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') setIndex((current) => current + count - 1);
      else if (event.key.toLowerCase() === 'f') {
        if (document.fullscreenElement) void document.exitFullscreen();
        else void document.documentElement.requestFullscreen?.().catch(() => undefined);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [count]);

  const current = pages[at];

  return (
    <main className="flex h-dvh w-screen cursor-none flex-col gap-[2vmin] overflow-hidden bg-bg p-[3vmin] text-text" data-testid="tv-board">
      <style>{`@media (prefers-reduced-motion: no-preference) { .tv-page { animation: tv-in 700ms ease-out; } } @keyframes tv-in { from { opacity: 0; } to { opacity: 1; } }`}</style>
      {current ? (
        <>
          <header className="flex items-baseline justify-between gap-[3vmin]">
            <h1 className="font-display text-[6vmin] leading-none" data-testid="tv-category">
              {current.name}
            </h1>
            {current.pages > 1 ? <p className="text-[2.4vmin] text-muted">{t('tv.page', { page: current.page, pages: current.pages })}</p> : null}
          </header>
          <section key={current.key} className={`tv-page grid min-h-0 flex-1 gap-[2vmin] ${current.dishes.length <= 4 ? 'grid-cols-2 grid-rows-2' : 'grid-cols-3 grid-rows-2 portrait:grid-cols-2 portrait:grid-rows-3'}`}>
            {current.dishes.map((dish) => (
              <article key={dish.id} className="flex min-h-0 flex-col overflow-hidden rounded-[2vmin] border border-line bg-surface" data-testid="tv-dish">
                <div className="relative min-h-0 flex-1 overflow-hidden">
                  <div className="absolute inset-0"><ProductVisual media={dish.media} name={dish.name} slug={dish.slug} sizes="40vw" priority className="size-full" /></div>
                </div>
                <div className="flex items-baseline justify-between gap-[2vmin] px-[2.2vmin] py-[1.8vmin]">
                  <h2 className="min-w-0 truncate font-display text-[3vmin] leading-tight" dir="auto">
                    {dish.name}
                  </h2>
                  <p className="shrink-0 text-[3vmin] font-semibold text-accent">{dish.price}</p>
                </div>
              </article>
            ))}
          </section>
        </>
      ) : (
        <p className="m-auto font-display text-[5vmin] text-muted">{t('tv.empty')}</p>
      )}
      <footer className="flex flex-col gap-[1.2vmin]">
        <p className="text-[2.2vmin] tracking-wide text-muted">{tenant.name}</p>
        <div className="h-[0.6vmin] w-full overflow-hidden rounded-full bg-line" aria-hidden="true">
          <div className="h-full bg-accent transition-[width] duration-700" style={{ width: count === 0 ? '0%' : `${((at + 1) / count) * 100}%` }} />
        </div>
      </footer>
    </main>
  );
}
