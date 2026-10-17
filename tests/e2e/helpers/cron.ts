/**
 * The scheduler's secret for the suites: the web server the suites start gets it as `CRON_SECRET` (playwright.config.ts),
 * and a test calls `/api/cron/publish` with it. Not a secret anywhere else.
 */
export const E2E_CRON_SECRET = 'e2e-cron-secret-for-the-test-web-server-only';
