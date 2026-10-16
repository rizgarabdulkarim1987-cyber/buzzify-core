import { defineConfig } from 'vitest/config';

/**
 * The load tests (`npm run test:load`): the same test database and global setup as the suite, but only
 * `tests/load/**` and with room to seed a thousand menus. `npm test` does not pick them up (its config includes
 * `*.test.ts` only), and this one does not pick up the suite. Not built on the suite's config with `mergeConfig`, which
 * would add this `include` to that one instead of replacing it.
 */
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    include: ['tests/load/**/*.load.ts'],
    environment: 'node',
    globalSetup: ['tests/helpers/global-setup.ts'],
    fileParallelism: false,
    // The point of the run is the table of times the test prints; the default reporter leaves it out of a piped run.
    reporters: ['verbose'],
    // Seeding is the slow part: a thousand menus and twenty thousand audit rows.
    testTimeout: 120_000,
    hookTimeout: 600_000,
    // As in the suite: Better Auth's own dynamic import of `next/headers` has to go through the same module registry.
    server: { deps: { inline: ['better-auth'] } },
  },
});
