import type { NextConfig } from 'next';

const config: NextConfig = {
  // Hostinger runs Next.js's self-contained server (it reads the PORT it is given); `npm run build:host` sets this.
  // Local builds stay regular so `npm run start` keeps working.
  ...(process.env.BUILD_TARGET === 'standalone' ? { output: 'standalone' as const } : {}),
  reactStrictMode: true,
  poweredByHeader: false,
  // The end-to-end tests load the dev server through 127.0.0.1 rather than localhost.
  allowedDevOrigins: ['127.0.0.1'],
  experimental: {
    // Turbopack's production chunker merges chunks smaller than this (unminified bytes; the default is 50,000). With the
    // Studio's routes in the same build, the defaults cut the framework code every page loads first into one more file,
    // and a guest's menu painted one simulated round trip (150 ms) later on a phone. Merging the small chunks brings
    // it back: docs/perf/baseline-2026-10-17-studio-core-2a.md, "After the fix".
    turbopackChunking: { minChunkSize: 200_000 },
  },
};

export default config;
