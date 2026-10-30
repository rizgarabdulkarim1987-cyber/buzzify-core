import { tmpdir } from 'node:os';
import path from 'node:path';

/** The script file the scripted AI provider reads: one default shared by the dev server (via the config) and the spec. */
export const INTAKE_SCRIPT_PATH = process.env.PH_INTAKE_E2E_SCRIPT?.trim() || path.join(tmpdir(), 'ph-intake-e2e-script.json');

/** The invoice suite's own dev-server port. */
export const INTAKE_E2E_PORT = Number(process.env.INTAKE_E2E_PORT ?? 3161);
