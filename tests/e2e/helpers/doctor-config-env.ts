/**
 * Imported first by `playwright.doctor.config.ts`, before `phase7b-config-env.ts`: the AI Doctor suite runs its own dev server on
 * its own port (`DOCTOR_E2E_PORT`, default 3412; 3411 is often a developer's preview server), with the same scripted-provider
 * wiring as the phase 7 assistant suite. The script file path follows the port, so the two suites never share one.
 */
process.env.PHASE7B_E2E_PORT = process.env.DOCTOR_E2E_PORT ?? process.env.PHASE7B_E2E_PORT ?? '3412';
