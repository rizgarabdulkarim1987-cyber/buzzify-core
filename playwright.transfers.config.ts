import './tests/e2e/helpers/transfers-config-env';
import { devices } from '@playwright/test';
import base from './playwright.config';
import { E2E_ORIGIN } from './tests/e2e/helpers/origin';

/**
 * The transfers suite: `npx playwright test -c playwright.transfers.config.ts --workers=1 tests/e2e/pharmacy-transfers.spec.ts`.
 * It always starts its own dev server on its own port (`TRANSFERS_E2E_PORT`, default 3171) and never reuses a running one.
 * The desktop project only, with no setup projects.
 */
const config = {
  ...base,
  projects: [{ name: 'desktop', use: { ...devices['Desktop Chrome'] }, grep: /@desktop/ }],
  webServer: {
    command: `npx next dev -p ${new URL(E2E_ORIGIN).port}`,
    url: `${E2E_ORIGIN}/pharmacy`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: { PUBLIC_MENU_ORIGIN: E2E_ORIGIN, BETTER_AUTH_URL: E2E_ORIGIN },
  },
};

export default config;
