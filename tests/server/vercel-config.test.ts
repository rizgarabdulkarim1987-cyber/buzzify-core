import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * What Vercel is told to do. `vercel.json` takes precedence over the dashboard's Build Command, so it is the one place that
 * makes a deploy check its settings and migrate the database before it builds; a script renamed without it would
 * leave the deploy building an app whose database was never migrated.
 */

const read = (file: string) => JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;

describe('vercel.json', () => {
  const vercel = read('vercel.json');
  const scripts = read('package.json').scripts as Record<string, string>;

  it('runs the app in Frankfurt, next to the database', () => {
    expect(vercel.regions).toEqual(['fra1']);
  });

  it('builds with the vercel-build script, whatever the dashboard says', () => {
    expect(vercel.buildCommand).toBe('npm run vercel-build');
    expect(scripts['vercel-build']).toBeDefined();
  });

  it('runs the scheduled-publishing job every minute, and has nothing else', () => {
    expect(Object.keys(vercel).sort()).toEqual(['buildCommand', 'crons', 'regions']);
    expect(vercel.crons).toEqual([{ path: '/api/cron/publish', schedule: '* * * * *' }]);
  });
});

describe('the vercel-build script', () => {
  const steps = (read('package.json').scripts as Record<string, string>)['vercel-build']!.split('&&').map((step) => step.trim());

  it('checks the environment first, then migrates, and builds last', () => {
    expect(steps[0]).toBe('tsx scripts/check-env.ts');
    expect(steps.indexOf('prisma migrate deploy')).toBeGreaterThan(0);
    expect(steps.at(-1)).toBe('next build');
    expect(steps.indexOf('prisma migrate deploy')).toBeLessThan(steps.indexOf('next build'));
  });
});
