/**
 * Imported first by `playwright.transfers.config.ts`: gives the run its own port before `helpers/origin` reads it.
 */
process.env.E2E_PORT = process.env.TRANSFERS_E2E_PORT ?? '3171';
