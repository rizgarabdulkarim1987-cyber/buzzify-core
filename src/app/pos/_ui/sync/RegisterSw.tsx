'use client';

import { useEffect } from 'react';

/** Registers the till's service worker (scope /pos/ only) and hands it the scripts this page runs, so the offline shell can open from the cache. */
export function RegisterSw() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    let cancelled = false;
    navigator.serviceWorker
      .register('/pos/sw.js', { scope: '/pos/' })
      .then(() => navigator.serviceWorker.ready)
      .then((registration) => {
        if (cancelled || !registration.active) return;
        const urls = [...document.querySelectorAll<HTMLScriptElement | HTMLLinkElement>('script[src], link[rel="stylesheet"][href]')]
          .map((node) => ('src' in node && node.src ? node.src : (node as HTMLLinkElement).href))
          .map((href) => new URL(href, location.href))
          .filter((url) => url.origin === location.origin && url.pathname.startsWith('/_next/static/'))
          .map((url) => url.pathname + url.search);
        registration.active.postMessage({ type: 'precache', urls });
      })
      .catch(() => {
        // No service worker (private window, blocked): the till still works online.
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return null;
}
