import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    globalSetup: ['tests/helpers/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 20_000,
  },
});
