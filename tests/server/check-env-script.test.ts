import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

/**
 * `scripts/check-env.ts` as `vercel-build` runs it: the first step of a production deploy. The rules themselves are
 * tested on `checkProductionEnv`; this shows that the script stops the deploy (exit code), lists what is wrong, and
 * prints no value.
 */

const TSX = 'node_modules/tsx/dist/cli.mjs';
const NAMES = [
  'DATABASE_URL',
  'DIRECT_DATABASE_URL',
  'BETTER_AUTH_SECRET',
  'BETTER_AUTH_URL',
  'RESEND_API_KEY',
  'EMAIL_FROM',
  'PUBLIC_MENU_HOST',
  'STUDIO_HOST',
  'PUBLIC_MENU_ORIGIN',
  'PUBLIC_ROOT_REDIRECT',
  'DEV_SEED_PASSWORD',
];

const complete = {
  DATABASE_URL: 'postgresql://app:hunter2-pooled@ep-quiet-sun-123456-pooler.eu-central-1.aws.neon.tech/buzzify',
  DIRECT_DATABASE_URL: 'postgresql://app:hunter2-direct@ep-quiet-sun-123456.eu-central-1.aws.neon.tech/buzzify',
  BETTER_AUTH_SECRET: 'hunter2-k3Y9qLw0pVx7ZtB2nM5sD8fH1jR4uC6aE9gI0oPq7Ws=',
  BETTER_AUTH_URL: 'https://studio.buzzify.me',
  RESEND_API_KEY: 're_hunter2_made_up_key',
  PUBLIC_MENU_HOST: 'menu.buzzify.me',
  STUDIO_HOST: 'studio.buzzify.me',
  PUBLIC_MENU_ORIGIN: 'https://menu.buzzify.me',
};

/** Runs the script with the checked variables set to exactly `env`: whatever this machine has set is cleared first. */
function run(env: Record<string, string>) {
  const cleared = Object.fromEntries(NAMES.map((name) => [name, '']));
  const result = spawnSync(process.execPath, [TSX, 'scripts/check-env.ts'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    timeout: 60_000,
    env: { ...process.env, ...cleared, ...env },
  });
  return { code: result.status, out: `${result.stdout}${result.stderr}` };
}

describe('scripts/check-env.ts', () => {
  it('passes a complete production environment', () => {
    const { code, out } = run(complete);
    expect(code, out).toBe(0);
    expect(out).toContain('complete');
    expect(out).not.toContain('hunter2');
  });

  it('fails the deploy with the whole list, naming variables and no value', () => {
    const { code, out } = run({ ...complete, BETTER_AUTH_SECRET: '', RESEND_API_KEY: '', DEV_SEED_PASSWORD: 'hunter2-seed-password' });
    expect(code).toBe(1);
    for (const name of ['BETTER_AUTH_SECRET', 'RESEND_API_KEY', 'DEV_SEED_PASSWORD']) expect(out).toContain(name);
    expect(out).not.toContain('hunter2');
  });
});
