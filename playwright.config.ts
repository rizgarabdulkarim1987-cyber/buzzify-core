import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 30_000,
  expect: { timeout: 7_000 },
  fullyParallel: true,
  retries: 0,
  reporter: [['list']],
  use: { baseURL: 'http://127.0.0.1:3100', trace: 'retain-on-failure' },
  projects: [
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
    { name: 'desktop', use: { ...devices['Desktop Chrome'] }, grep: /@desktop/ },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://127.0.0.1:3100/atelier/en',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
