import './tests/e2e/helpers/intake-config-env';
import { devices } from '@playwright/test';
import { INTAKE_SCRIPT_PATH } from './tests/e2e/helpers/intake-env';
import base from './playwright.config';
import { E2E_ORIGIN } from './tests/e2e/helpers/origin';

/**
 * The invoice-by-photo suite: `npx playwright test -c playwright.intake.config.ts --workers=1 tests/e2e/pharmacy-intake.spec.ts`.
 * It always starts its own dev server on its own port (`INTAKE_E2E_PORT`, default 3161) with the scripted AI provider and the
 * two model prices, and never reuses a server that is already running (one without the hook would call a real provider).
 * The desktop project only, with no setup projects.
 */
export default {
  ...base,
  projects: [{ name: 'desktop', use: { ...devices['Desktop Chrome'] }, grep: /@desktop/ }],
  webServer: {
    command: `npx next dev -p ${new URL(E2E_ORIGIN).port}`,
    url: `${E2E_ORIGIN}/pharmacy`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      PUBLIC_MENU_ORIGIN: E2E_ORIGIN,
      BETTER_AUTH_URL: E2E_ORIGIN,
      AI_PROVIDER: 'scripted',
      PH_INTAKE_E2E_SCRIPT: INTAKE_SCRIPT_PATH,
      AI_PRICE_INPUT_USD_MICRO_PER_MTOK: '3000000',
      AI_PRICE_OUTPUT_USD_MICRO_PER_MTOK: '15000000',
    },
  },
};
