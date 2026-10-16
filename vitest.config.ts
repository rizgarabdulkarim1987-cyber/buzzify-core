import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    globalSetup: ['tests/helpers/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 20_000,
    // Better Auth's `nextCookies()` plugin loads `next/headers` with a dynamic import of its own. Left external, that import
    // is Node's and ignores `vi.mock`, so a test cannot stand in for the request's cookies. Inlined, it goes through the
    // same module registry as the Studio's code.
    server: { deps: { inline: ['better-auth'] } },
  },
});
