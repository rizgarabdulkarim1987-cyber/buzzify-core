import './tests/e2e/helpers/doctor-config-env';
import './tests/e2e/helpers/phase7b-config-env';
import base from './playwright.phase7b.config';

/**
 * The AI Doctor suite (plan Task 8): `npx playwright test -c playwright.doctor.config.ts --workers=1 tests/e2e/pharmacy-doctor.spec.ts`.
 * The phase 7 assistant config on its own port (`DOCTOR_E2E_PORT`, default 3412): its own dev server with the SCRIPTED AI provider
 * (no real model is ever called), never a reused server.
 */
export default base;
