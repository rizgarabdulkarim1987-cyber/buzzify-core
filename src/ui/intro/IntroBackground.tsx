'use client';

import { useEffect, useRef } from 'react';
import type { IntroBackground as Background } from '@/server/data/intro';

/** Whether a video may start by itself: not when the visitor asked for less motion or is saving data. */
function mayPlay(): boolean {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
  return (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData !== true;
}

/** The picture or video behind the page. A video shows its poster until it may play, and keeps showing it when it may not. */
export function IntroBackground({ background }: { background: Background | null }) {
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (background?.kind === 'video' && mayPlay()) void video.current?.play().catch(() => undefined);
  }, [background]);

  if (!background) return null;
  const fill = 'absolute inset-0 -z-20 size-full object-cover';
  if (background.kind === 'video') {
    return <video ref={video} src={background.url} poster={background.poster} muted loop playsInline preload="metadata" aria-hidden className={fill} />;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- a library picture, sized by the page
    <img
      src={background.url}
      width={background.width}
      height={background.height}
      alt=""
      fetchPriority="high"
      decoding="async"
      className={fill}
      style={background.placeholder ? { backgroundImage: `url(${background.placeholder})`, backgroundSize: 'cover' } : undefined}
    />
  );
}
