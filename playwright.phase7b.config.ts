import './tests/e2e/helpers/phase7b-config-env';
import { devices } from '@playwright/test';
import base from './playwright.config';
import { E2E_ORIGIN } from './tests/e2e/helpers/origin';

/**
 * The phase 7 assistant and printing suite:
 * `npx playwright test -c playwright.phase7b.config.ts --workers=1 tests/e2e/pharmacy-phase7b.spec.ts`.
 * It always starts its own dev server on its own port (`PHASE7B_E2E_PORT`, default 3174) with the SCRIPTED AI provider (no real model is
 * ever called) and the two model prices, and never reuses a running server (one without the hook could call a real provider).
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
    env: {
      PUBLIC_MENU_ORIGIN: E2E_ORIGIN,
      BETTER_AUTH_URL: E2E_ORIGIN,
      AI_PROVIDER: 'scripted',
      PH_INTAKE_E2E_SCRIPT: process.env.PH_INTAKE_E2E_SCRIPT ?? '',
      AI_PRICE_INPUT_USD_MICRO_PER_MTOK: '3000000',
      AI_PRICE_OUTPUT_USD_MICRO_PER_MTOK: '15000000',
      AI_PRICE_MODEL: 'scripted-e2e',
    },
  },
};

export default config;
