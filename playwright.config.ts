import { defineConfig, devices } from '@playwright/test';
import { E2E_CRON_SECRET } from './tests/e2e/helpers/cron';
import { E2E_ORIGIN, E2E_PORT } from './tests/e2e/helpers/origin';

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
    baseURL: E2E_ORIGIN,
    trace: 'retain-on-failure',
    // The 3D stage has its own suite (stage.spec.ts, which opts back in with ?stage=on). Every other suite
    // tests menu, cart and pricing behaviour and should not depend on how fast software WebGL starts.
    storageState: {
      cookies: [],
      origins: [{ origin: E2E_ORIGIN, localStorage: [{ name: 'atelier:stage', value: 'off' }] }],
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
    // On 3100 (`npm run dev`), or on E2E_PORT when another checkout's dev server has 3100; the menus' canonical links and
    // sign-in then use that address too.
    command: E2E_PORT === 3100 ? 'npm run dev' : `npx next dev -p ${E2E_PORT}`,
    url: `${E2E_ORIGIN}/atelier/en`,
    reuseExistingServer: true,
    timeout: 120_000,
    // The scheduler's endpoint answers only with a secret; the revisions suite calls it with this one. A dev server
    // started by hand needs the same CRON_SECRET for that suite.
    env: { CRON_SECRET: E2E_CRON_SECRET, ...(E2E_PORT === 3100 ? {} : { PUBLIC_MENU_ORIGIN: E2E_ORIGIN, BETTER_AUTH_URL: E2E_ORIGIN }) },
  },
});
