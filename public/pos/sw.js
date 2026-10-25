/*
 * The till's service worker. Scope: /pos/ only (served by next.config.ts with `Service-Worker-Allowed: /pos/`).
 *
 * It keeps what the offline till needs to open without a network: the built scripts and styles (`/_next/static/`, immutable)
 * and one page, /pos/offline, which holds no restaurant data (it is a shell that reads IndexedDB). It never stores an API
 * answer, a Studio page or any other HTML. A navigation inside /pos that fails because there is no network gets that shell.
 */
const VERSION = 'pos-sw-v1';
const STATIC_CACHE = VERSION + '-static';
const SHELL_CACHE = VERSION + '-shell';
const SHELL_URL = '/pos/offline';
const STATIC_PREFIX = '/_next/static/';

const isStatic = (url) => url.origin === self.location.origin && url.pathname.startsWith(STATIC_PREFIX);
const isShell = (url) => url.origin === self.location.origin && url.pathname === SHELL_URL;
const isTill = (url) => url.origin === self.location.origin && (url.pathname === '/pos' || url.pathname.startsWith('/pos/'));

/** The scripts, styles and fonts a page names, so the shell can open with nothing but the cache. */
function staticUrlsIn(html) {
  const found = new Set();
  const pattern = /["'(]((?:\/_next\/static\/)[^"'()\s\\]+)/g;
  let match;
  while ((match = pattern.exec(html)) !== null) found.add(match[1]);
  return [...found];
}

async function remember(urls) {
  const cache = await caches.open(STATIC_CACHE);
  await Promise.all(
    urls.map(async (path) => {
      try {
        if (await cache.match(path)) return;
        const response = await fetch(path, { credentials: 'same-origin' });
        if (response.ok) await cache.put(path, response);
      } catch (error) {
        // One file missing from the cache is not worth failing the install for.
      }
    }),
  );
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      try {
        const response = await fetch(SHELL_URL, { credentials: 'same-origin', cache: 'no-store' });
        if (response.ok) {
          const copy = response.clone();
          await (await caches.open(SHELL_CACHE)).put(SHELL_URL, response);
          await remember(staticUrlsIn(await copy.text()));
        }
      } catch (error) {
        // Installed without the shell: the next visit to /pos/offline online fills it.
      }
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((name) => !name.startsWith(VERSION)).map((name) => caches.delete(name)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  const data = event.data;
  if (data && data.type === 'precache' && Array.isArray(data.urls)) {
    const urls = data.urls.filter((u) => typeof u === 'string' && u.startsWith(STATIC_PREFIX));
    event.waitUntil(remember(urls));
  }
});

async function cacheFirst(request) {
  const cache = await caches.open(STATIC_CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}

async function shellFallback(request) {
  try {
    const response = await fetch(request);
    // Only the shell itself is ever stored, and only when it came back fine.
    if (isShell(new URL(request.url)) && response.ok) await (await caches.open(SHELL_CACHE)).put(SHELL_URL, response.clone());
    return response;
  } catch (error) {
    const cached = await (await caches.open(SHELL_CACHE)).match(SHELL_URL);
    if (!cached) throw error;
    // Any other till page needs the server: send the cashier to the offline till rather than serve it a page that cannot run.
    if (!isShell(new URL(request.url))) return Response.redirect(new URL(SHELL_URL, self.location.origin).href, 302);
    return cached;
  }
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (isStatic(url)) {
    event.respondWith(cacheFirst(request));
    return;
  }
  if (request.mode === 'navigate' && isTill(url)) event.respondWith(shellFallback(request));
});
