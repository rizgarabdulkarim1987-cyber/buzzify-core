import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // The end-to-end tests load the dev server through 127.0.0.1 rather than localhost.
  allowedDevOrigins: ['127.0.0.1'],
  async redirects() {
    return [{ source: '/', destination: '/atelier/en', permanent: false }];
  },
};

export default config;
