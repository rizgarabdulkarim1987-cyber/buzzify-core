import { checkProductionEnv } from '@/server/env';

/**
 * Runs first in `vercel-build` and `build:host`: stops a production deploy that is missing or has wrong settings before
 * anything touches the database, and lists all of them at once. It prints variable names and what is wrong, never a
 * value.
 *
 * It reads the process environment only (no `.env` file): on Vercel and Hostinger that is the site's environment
 * variables.
 */

const result = checkProductionEnv();

if (result.ok) {
  console.log('The production environment is complete.');
} else {
  console.error("The production environment is not ready. Fix these in the site's environment variables, then deploy again:");
  for (const problem of result.problems) console.error(`  - ${problem}`);
  console.error('Hostinger: docs/deploy/hostinger.md. Vercel: docs/deploy/production.md.');
  process.exitCode = 1;
}
