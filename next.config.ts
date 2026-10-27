import type { NextConfig } from 'next';

/**
 * Policy directives that restrict no script, style, image or connection, so they cannot break a page: no plugins, no
 * `<base>` pointing elsewhere, forms post only to this site. A policy for scripts needs per-request nonces for Next's
 * inline scripts and is a change of its own.
 */
const BASE_POLICY = ["object-src 'none'", "base-uri 'self'", "form-action 'self'"];

const SECURITY_HEADERS = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // Browsers ignore it over plain http, so local development is unaffected. No includeSubDomains: other hosts under the
  // same domain are not this app's to promise.
  { key: 'Strict-Transport-Security', value: 'max-age=31536000' },
  // Nothing here uses these; a feature that needs one (a camera for scanning, say) lifts it here.
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
  { key: 'Content-Security-Policy', value: BASE_POLICY.join('; ') },
];

/**
 * The Studio is framed only by itself (its previews load `/studio/preview` in an iframe). Public menus stay frameable: a
 * restaurant may show its menu on its own site, and a guest's page holds nothing to trick them into. Next applies the
 * last matching rule's value for a header, so this policy repeats the base one.
 */
const STUDIO_HEADERS = [
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  { key: 'Content-Security-Policy', value: [...BASE_POLICY, "frame-ancestors 'self'"].join('; ') },
];

const config: NextConfig = {
  async headers() {
    return [
      { source: '/:path*', headers: SECURITY_HEADERS },
      { source: '/studio/:path*', headers: STUDIO_HEADERS },
      // The till is framed by no one else either: a frame over a payment screen is a clickjacking surface.
      { source: '/pos/:path*', headers: STUDIO_HEADERS },
      // The pharmacy too: its screens sell and dispense.
      { source: '/pharmacy/:path*', headers: STUDIO_HEADERS },
      // The service worker must never be served from a stale cache, and may control only the till.
      {
        source: '/pos/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Service-Worker-Allowed', value: '/pos/' },
          { key: 'Content-Type', value: 'text/javascript; charset=utf-8' },
        ],
      },
    ];
  },
  // Hostinger runs Next.js's self-contained server (it reads the PORT it is given); `npm run build:host` sets this.
  // Local builds stay regular so `npm run start` keeps working.
  ...(process.env.BUILD_TARGET === 'standalone' ? { output: 'standalone' as const } : {}),
  reactStrictMode: true,
  poweredByHeader: false,
  // The end-to-end tests load the dev server through 127.0.0.1 rather than localhost.
  allowedDevOrigins: ['127.0.0.1'],
  // jsdom (the window DOMPurify sanitizes SVG uploads in) reads its own files at run time, so it stays a Node module
  // rather than being bundled. sharp is on Next's own list already.
  serverExternalPackages: ['jsdom'],
  // A QR code's frame text is drawn as outlines from these two fonts, read from disk at run time (src/server/qr/render.ts),
  // which the build's file tracing cannot see.
  outputFileTracingIncludes: {
    '/studio/**': [
      './node_modules/@fontsource-variable/noto-sans-arabic/files/noto-sans-arabic-arabic-wght-normal.woff2',
      './node_modules/@fontsource-variable/hanken-grotesk/files/hanken-grotesk-latin-wght-normal.woff2',
    ],
    // The 3D models are read from disk by their route (src/app/api/assets/models/[file]/route.ts).
    '/api/assets/models/[file]': ['./src/assets/models/*.glb'],
    // The menu-style pages and posters are read from disk by their routes (src/server/studio/style-files.ts).
    '/studio/style-files/**': ['./src/studio/styles/pages/*.html', './src/studio/styles/posters/*.webp'],
  },
  experimental: {
    // Turbopack's production chunker merges chunks smaller than this (unminified bytes; the default is 50,000). With the
    // Studio's routes in the same build, the defaults cut the framework code every page loads first into one more file,
    // and a guest's menu painted one simulated round trip (150 ms) later on a phone. Merging the small chunks brings
    // it back: docs/perf/baseline-2026-10-17-studio-core-2a.md, "After the fix".
    turbopackChunking: { minChunkSize: 200_000 },
    // Hostinger's build machine reports dozens of cores but refuses the threads that many build workers ask for
    // ("OS can't spawn worker thread", build of 2026-10-23), so its build collects page data with a few workers.
    ...(process.env.BUILD_TARGET === 'standalone' ? { cpus: 4 } : {}),
  },
};

export default config;
