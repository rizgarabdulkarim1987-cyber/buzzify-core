/**
 * Imported first by `playwright.reports.config.ts`: gives the run its own port before `helpers/origin` reads it.
 */
process.env.E2E_PORT = process.env.REPORTS_E2E_PORT ?? '3172';
