import { tmpdir } from 'node:os';
import path from 'node:path';

/**
 * Imported first by `playwright.phase7b.config.ts`: gives the run its own port (before `helpers/origin` reads it) and the path of the
 * script file the scripted AI provider reads. The spec imports `ASSISTANT_SCRIPT_PATH` from `phase7b-env.ts`, which resolves to the
 * same file, so the dev server and the test (two processes) agree.
 */
process.env.E2E_PORT = process.env.PHASE7B_E2E_PORT ?? '3174';
process.env.PH_INTAKE_E2E_SCRIPT = process.env.PH_PHASE7B_SCRIPT?.trim() || path.join(tmpdir(), `ph-assistant-e2e-script-${process.env.E2E_PORT}.json`);
