import { defineConfig, devices } from '@playwright/test';

/** The suites that start software WebGL (the 3D stage). They run one test at a time; see the `webgl` project. */
const WEBGL_SUITES = /(stage|explore|motion)\.spec\.ts$/;

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
    // Every suite reads the seeded ATELIER menu: the run starts once the dev server serves the one the database holds
    // (after `npm run db:seed` it can serve the replaced menu from its cache for up to 5 minutes).
    { name: 'public setup', testMatch: /public\.setup\.ts$/ },
    // The Studio's signed-in suites start from people signed in once per run (studio.setup.ts): Super Admins with
    // two-factor (one per Studio language) and the seeded owner of ATELIER. The teardown removes the Super Admins and
    // ends the owner's session after the last suite that needs them.
    {
      name: 'studio setup',
      testMatch: /studio\.setup\.ts$/,
      teardown: 'studio teardown',
      dependencies: ['public setup'],
      use: { ...devices['Desktop Chrome'] },
    },
    { name: 'studio teardown', testMatch: /studio\.teardown\.ts$/ },
    // The public menu is mobile-first; the Studio is a desktop tool, and its suites are tagged @desktop.
    {
      name: 'mobile',
      use: { ...devices['Pixel 7'] },
      grepInvert: /@desktop/,
      testIgnore: WEBGL_SUITES,
      dependencies: ['public setup'],
    },
    // Software WebGL is CPU bound: one worker for the 3D suites, so one 3D page starts at a time and its start stays
    // well inside the suites' waits whatever else the run is doing.
    {
      name: 'webgl',
      use: { ...devices['Pixel 7'] },
      grepInvert: /@desktop/,
      testMatch: WEBGL_SUITES,
      workers: 1,
      dependencies: ['public setup'],
    },
    { name: 'desktop', use: { ...devices['Desktop Chrome'] }, grep: /@desktop/, dependencies: ['studio setup'] },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://127.0.0.1:3100/atelier/en',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
