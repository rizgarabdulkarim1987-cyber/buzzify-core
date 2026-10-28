'use client';

import { useEffect, useRef } from 'react';
import type { IntroAdvertView } from '@/server/data/intro';

/** Tells the server this advert was seen. Fire and forget; it carries nothing but the advert's id. */
function reportView(slug: string, advertId: string) {
  const url = `/api/${slug}/intro/view`;
  const body = JSON.stringify({ advertId });
  try {
    if (navigator.sendBeacon?.(url, new Blob([body], { type: 'application/json' }))) return;
  } catch {
    // fall through to fetch
  }
  void fetch(url, { method: 'POST', body, keepalive: true }).catch(() => undefined);
}

function Card({ slug, advert, single }: { slug: string; advert: IntroAdvertView; single: boolean }) {
  const card = useRef<HTMLLIElement>(null);
  useEffect(() => {
    const node = card.current;
    if (!node) return;
    // Counted once per page load, and only when the card is actually on screen.
    const watcher = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          reportView(slug, advert.id);
          watcher.disconnect();
        }
      },
      { threshold: 0.5 },
    );
    watcher.observe(node);
    return () => watcher.disconnect();
  }, [slug, advert.id]);

  const { image } = advert;
  const picture = (
    // eslint-disable-next-line @next/next/no-img-element -- an advert picture from the media library
    <img src={image.url} width={image.width} height={image.height} alt={advert.alt} loading="lazy" decoding="async" className="block h-auto w-full" />
  );
  return (
    <li ref={card} className={`${single ? 'w-full' : 'w-[85%] shrink-0 snap-center'} overflow-hidden rounded-2xl border border-white/30 bg-black/20`}>
      {advert.linked ? (
        <a href={`/${slug}/intro/ad/${advert.id}`} rel="noopener noreferrer" className="block">
          {picture}
        </a>
      ) : (
        picture
      )}
    </li>
  );
}

/** The platform's adverts as cards. One shows still; several scroll sideways, each snapping into view, with no timer. */
export function AdvertSlider({ slug, adverts, label }: { slug: string; adverts: IntroAdvertView[]; label: string }) {
  const single = adverts.length === 1;
  return (
    <section data-testid="adverts" aria-label={label} className="w-full">
      <ul className={single ? 'flex' : '-mx-6 flex snap-x snap-mandatory gap-3 overflow-x-auto px-6 pb-2 [scrollbar-width:none]'}>
        {adverts.map((advert) => (
          <Card key={advert.id} slug={slug} advert={advert} single={single} />
        ))}
      </ul>
    </section>
  );
}
