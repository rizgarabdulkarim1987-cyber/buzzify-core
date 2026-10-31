import { tmpdir } from 'node:os';
import path from 'node:path';

/** The script file the scripted AI provider reads: the same path `phase7b-config-env.ts` hands the dev server. */
export const ASSISTANT_SCRIPT_PATH =
  process.env.PH_PHASE7B_SCRIPT?.trim() || process.env.PH_INTAKE_E2E_SCRIPT?.trim() || path.join(tmpdir(), `ph-assistant-e2e-script-${process.env.PHASE7B_E2E_PORT ?? '3174'}.json`);
