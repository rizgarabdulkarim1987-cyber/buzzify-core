import { INTAKE_E2E_PORT, INTAKE_SCRIPT_PATH } from './intake-env';

/**
 * Imported first by `playwright.intake.config.ts`: gives the run its own port (before `helpers/origin` reads it), the script
 * path, and the marker the spec requires. Only that config imports this, so the marker proves the server was started with the
 * scripted AI provider.
 */
process.env.E2E_PORT = String(INTAKE_E2E_PORT);
process.env.PH_INTAKE_E2E_SCRIPT = INTAKE_SCRIPT_PATH;
process.env.PH_INTAKE_E2E_CONFIG = '1';
