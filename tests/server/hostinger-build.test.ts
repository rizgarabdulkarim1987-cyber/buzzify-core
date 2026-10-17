import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * What Hostinger is told to do. Its Node.js build runs `npm run build:host` and serves Next.js's standalone server, so
 * that script must check the settings and migrate the database before it builds a standalone app. It builds with
 * webpack: Turbopack runs PostCSS in helper Node processes that connect back to it over 127.0.0.1, and on Hostinger's
 * build machines they exit before connecting, which fails every build.
 */

const scripts = (JSON.parse(readFileSync('package.json', 'utf8')) as { scripts: Record<string, string> }).scripts;

describe('the build:host script', () => {
  const steps = scripts['build:host']!.split('&&').map((step) => step.trim());

  it('checks the environment first, then migrates, and builds a standalone server with webpack last', () => {
    expect(steps[0]).toBe('tsx scripts/check-env.ts');
    expect(steps).toContain('prisma migrate deploy');
    expect(steps.at(-1)).toBe('BUILD_TARGET=standalone next build --webpack');
    expect(steps.indexOf('prisma migrate deploy')).toBeLessThan(steps.length - 1);
  });
});

describe('next.config standalone output', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('builds a standalone server only for Hostinger', async () => {
    vi.stubEnv('BUILD_TARGET', 'standalone');
    expect((await import('../../next.config')).default.output).toBe('standalone');
  });

  it('keeps local builds regular so npm run start works', async () => {
    vi.stubEnv('BUILD_TARGET', '');
    expect((await import('../../next.config')).default.output).toBeUndefined();
  });
});
