import { useSyncExternalStore } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

function subscribe(notify: () => void): () => void {
  const media = window.matchMedia(QUERY);
  media.addEventListener('change', notify);
  return () => media.removeEventListener('change', notify);
}

/**
 * Whether the visitor asked for less motion. Read straight from the media query so the menu's initial
 * JavaScript does not need the animation library just to answer this; the server and the first client
 * render both say `false`, so hydration matches.
 */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => false,
  );
}
