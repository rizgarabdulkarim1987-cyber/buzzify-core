import { checkProductionEnv } from '@/server/env';

/**
 * Runs first in `vercel-build`: stops a production deploy that is missing or has wrong settings before anything touches
 * the database, and lists all of them at once. It prints variable names and what is wrong, never a value.
 *
 * It reads the process environment only (no `.env` file): on Vercel that is the project's environment variables.
 */

const result = checkProductionEnv();

if (result.ok) {
  console.log('The production environment is complete.');
} else {
  console.error('The production environment is not ready. Fix these in the Vercel project (Settings, Environment Variables), then deploy again:');
  for (const problem of result.problems) console.error(`  - ${problem}`);
  console.error('The steps for each value are in docs/deploy/production.md.');
  process.exitCode = 1;
}
