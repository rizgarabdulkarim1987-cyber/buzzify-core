/**
 * Imported first by `playwright.phase7.config.ts`: gives the run its own port before `helpers/origin` reads it.
 */
process.env.E2E_PORT = process.env.PHASE7_E2E_PORT ?? '3173';
