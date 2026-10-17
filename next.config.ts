import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // The end-to-end tests load the dev server through 127.0.0.1 rather than localhost.
  allowedDevOrigins: ['127.0.0.1'],
  // jsdom (the window DOMPurify sanitizes SVG uploads in) reads its own files at run time, so it stays a Node module
  // rather than being bundled. sharp is on Next's own list already.
  serverExternalPackages: ['jsdom'],
  experimental: {
    // Turbopack's production chunker merges chunks smaller than this (unminified bytes; the default is 50,000). With the
    // Studio's routes in the same build, the defaults cut the framework code every page loads first into one more file,
    // and a guest's menu painted one simulated round trip (150 ms) later on a phone. Merging the small chunks brings
    // it back: docs/perf/baseline-2026-10-17-studio-core-2a.md, "After the fix".
    turbopackChunking: { minChunkSize: 200_000 },
  },
};

export default config;
