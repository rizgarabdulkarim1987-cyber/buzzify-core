import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 30_000,
  expect: { timeout: 7_000 },
  fullyParallel: true,
  // The 3D suites run software WebGL, which is CPU bound; more workers than this starve each other and
  // turn timing into noise.
  workers: 3,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:3100',
    trace: 'retain-on-failure',
    // The 3D stage has its own suite (stage.spec.ts, which opts back in with ?stage=on). Every other suite
    // tests menu, cart and pricing behaviour and should not depend on how fast software WebGL starts.
    storageState: {
      cookies: [],
      origins: [{ origin: 'http://127.0.0.1:3100', localStorage: [{ name: 'atelier:stage', value: 'off' }] }],
    },
  },
  projects: [
    // The Studio's signed-in suites start from a Super Admin with two-factor, made once per run (studio.setup.ts) and
    // removed after the last suite that needs it (studio.teardown.ts).
    { name: 'studio setup', testMatch: /studio\.setup\.ts$/, teardown: 'studio teardown', use: { ...devices['Desktop Chrome'] } },
    { name: 'studio teardown', testMatch: /studio\.teardown\.ts$/ },
    // The public menu is mobile-first; the Studio is a desktop tool, and its suites are tagged @desktop.
    { name: 'mobile', use: { ...devices['Pixel 7'] }, grepInvert: /@desktop/ },
    { name: 'desktop', use: { ...devices['Desktop Chrome'] }, grep: /@desktop/, dependencies: ['studio setup'] },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://127.0.0.1:3100/atelier/en',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
