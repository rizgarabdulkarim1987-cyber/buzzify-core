import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkProductionEnv, parseAuthEnv } from '@/server/env';

/** A complete production configuration. Every password and key in it is made up. */
const complete = {
  DATABASE_URL: 'postgresql://app:pooled-pw@ep-quiet-sun-123456-pooler.eu-central-1.aws.neon.tech/buzzify?sslmode=require',
  DIRECT_DATABASE_URL: 'postgresql://app:direct-pw@ep-quiet-sun-123456.eu-central-1.aws.neon.tech/buzzify?sslmode=require',
  BETTER_AUTH_SECRET: 'k3Y9qLw0pVx7ZtB2nM5sD8fH1jR4uC6aE9gI0oPq7Ws=',
  BETTER_AUTH_URL: 'https://studio.buzzify.me',
  RESEND_API_KEY: 're_made_up_key_123',
  PUBLIC_MENU_HOST: 'menu.buzzify.me',
  STUDIO_HOST: 'studio.buzzify.me',
  PUBLIC_MENU_ORIGIN: 'https://menu.buzzify.me',
  R2_ACCOUNT_ID: 'made-up-account',
  R2_ACCESS_KEY_ID: 'made-up-access-key',
  R2_SECRET_ACCESS_KEY: 'made-up-secret-access-key',
  R2_BUCKET: 'buzzify-media',
  MEDIA_PUBLIC_URL: 'https://media.buzzify.me',
  CRON_SECRET: 'made-up-cron-secret-that-is-32-chars-or-more',
};

/** The problems found in `complete` with some variables replaced (`undefined` removes one). Empty when it is fine. */
function problemsWith(changes: Record<string, string | undefined>): string[] {
  const result = checkProductionEnv({ ...complete, ...changes });
  return result.ok ? [] : result.problems;
}

/** The variables a list of problems is about: every problem starts with the variable's name. */
const named = (problems: string[]) => problems.map((problem) => problem.split(' ')[0]);

describe('checkProductionEnv', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('accepts a complete production configuration, with or without the optional variables', () => {
    expect(checkProductionEnv(complete)).toEqual({ ok: true });
    expect(
      checkProductionEnv({ ...complete, EMAIL_FROM: 'Menus <menus@buzzify.me>', PUBLIC_ROOT_REDIRECT: 'https://buzzify.me/welcome' }),
    ).toEqual({ ok: true });
  });

  it('refuses the canned AI providers and the browser-test script path', () => {
    expect(named(problemsWith({ AI_PROVIDER: 'scripted' }))).toEqual(['AI_PROVIDER']);
    expect(named(problemsWith({ AI_PROVIDER: 'fake' }))).toEqual(['AI_PROVIDER']);
    expect(named(problemsWith({ PH_INTAKE_E2E_SCRIPT: '/tmp/x.json' }))).toEqual(['PH_INTAKE_E2E_SCRIPT']);
    expect(problemsWith({ AI_PROVIDER: 'openai' })).toEqual([]);
  });

  it('checks the pharmacy AI price: none is fine, a half-set one or one for another model than AI_MODEL_EXTRACT is not', () => {
    const price = { AI_PRICE_INPUT_USD_MICRO_PER_MTOK: '5000000', AI_PRICE_OUTPUT_USD_MICRO_PER_MTOK: '25000000', AI_PRICE_MODEL: 'claude-opus-5-5' };
    expect(problemsWith({})).toEqual([]);
    expect(problemsWith(price)).toEqual([]);
    // a price without the model it is for (or with a missing side) is refused, naming the missing variable
    expect(named(problemsWith({ ...price, AI_PRICE_MODEL: undefined }))).toEqual(['AI_PRICE_MODEL']);
    expect(named(problemsWith({ ...price, AI_PRICE_OUTPUT_USD_MICRO_PER_MTOK: undefined }))).toEqual(['AI_PRICE_OUTPUT_USD_MICRO_PER_MTOK']);
    expect(named(problemsWith({ ...price, AI_PRICE_INPUT_USD_MICRO_PER_MTOK: '1.5' }))).toEqual(['AI_PRICE_INPUT_USD_MICRO_PER_MTOK']);
    // the environment's own extraction model must be the one that was priced
    expect(problemsWith({ ...price, AI_MODEL_EXTRACT: 'claude-opus-5-5' })).toEqual([]);
    expect(named(problemsWith({ ...price, AI_MODEL_EXTRACT: 'claude-sonnet-5' }))).toEqual(['AI_PRICE_MODEL']);
    expect(named(problemsWith({ ...price, AI_PROVIDER: 'openai', AI_OPENAI_MODEL_EXTRACT: 'gpt-5-mini' }))).toEqual(['AI_PRICE_MODEL']);
    // no price at all: the AI refuses to run, and the deploy check does not mind
    expect(problemsWith({ AI_MODEL_EXTRACT: 'anything' })).toEqual([]);
  });

  it('names every missing variable at once, so one failed deploy shows the whole list', () => {
    const result = checkProductionEnv({});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(named(result.problems)).toEqual([
      'DATABASE_URL',
      'DIRECT_DATABASE_URL',
      'BETTER_AUTH_SECRET',
      'BETTER_AUTH_URL',
      'RESEND_API_KEY',
      'PUBLIC_MENU_HOST',
      'STUDIO_HOST',
      'PUBLIC_MENU_ORIGIN',
      'R2_ACCOUNT_ID',
      'R2_ACCESS_KEY_ID',
      'R2_SECRET_ACCESS_KEY',
      'R2_BUCKET',
      'MEDIA_PUBLIC_URL',
      'CRON_SECRET',
    ]);
  });

  it('lists the sign-in secret and the email key when only those are missing', () => {
    expect(named(problemsWith({ BETTER_AUTH_SECRET: undefined, RESEND_API_KEY: undefined }))).toEqual([
      'BETTER_AUTH_SECRET',
      'RESEND_API_KEY',
    ]);
  });

  it('counts a blank value as missing, and does not wait for NODE_ENV to say production', () => {
    expect(named(problemsWith({ RESEND_API_KEY: '   ', STUDIO_HOST: '' }))).toEqual(['RESEND_API_KEY', 'STUDIO_HOST']);
    expect(checkProductionEnv({ ...complete, NODE_ENV: 'development' })).toEqual({ ok: true });
    expect(checkProductionEnv({ NODE_ENV: 'development' }).ok).toBe(false);
  });

  it('reads process.env when no source is given', () => {
    vi.stubEnv('DEV_SEED_PASSWORD', 'a-made-up-dev-password');
    const result = checkProductionEnv();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(named(result.problems)).toContain('DEV_SEED_PASSWORD');
  });

  it('refuses a sign-in secret that is short, the placeholder from .env.example, or the public development one', () => {
    const developmentSecret = parseAuthEnv({}).secret;
    for (const bad of ['x'.repeat(31), 'generate with: openssl rand -base64 32', developmentSecret]) {
      expect(named(problemsWith({ BETTER_AUTH_SECRET: bad }))).toEqual(['BETTER_AUTH_SECRET']);
    }
    expect(problemsWith({ BETTER_AUTH_SECRET: 'x'.repeat(32) })).toEqual([]);
  });

  it('refuses DEV_SEED_PASSWORD, which would create users whose password is published', () => {
    expect(named(problemsWith({ DEV_SEED_PASSWORD: 'dev-only-change-me-2026' }))).toEqual(['DEV_SEED_PASSWORD']);
    expect(problemsWith({ DEV_SEED_PASSWORD: '' })).toEqual([]);
    expect(problemsWith({ DEV_SEED_PASSWORD: undefined })).toEqual([]);
  });

  it('requires https for the Studio URL and the public origin, and a bare origin for the Studio URL', () => {
    expect(named(problemsWith({ BETTER_AUTH_URL: 'http://studio.buzzify.me' }))).toEqual(['BETTER_AUTH_URL']);
    expect(named(problemsWith({ BETTER_AUTH_URL: 'https://studio.buzzify.me/studio' }))).toEqual(['BETTER_AUTH_URL']);
    expect(named(problemsWith({ PUBLIC_MENU_ORIGIN: 'http://menu.buzzify.me' }))).toEqual(['PUBLIC_MENU_ORIGIN']);
    expect(named(problemsWith({ PUBLIC_MENU_ORIGIN: 'menu.buzzify.me' }))).toEqual(['PUBLIC_MENU_ORIGIN']);
  });

  it('has no development default for the public origin: the local address is refused, not assumed', () => {
    expect(named(problemsWith({ PUBLIC_MENU_ORIGIN: undefined }))).toEqual(['PUBLIC_MENU_ORIGIN']);
    expect(named(problemsWith({ PUBLIC_MENU_ORIGIN: 'http://127.0.0.1:3100' }))).toEqual(['PUBLIC_MENU_ORIGIN']);
  });

  it('refuses database URLs that are not PostgreSQL URLs, or that point at this machine', () => {
    expect(named(problemsWith({ DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:54329/buzzify' }))).toEqual(['DATABASE_URL']);
    expect(named(problemsWith({ DIRECT_DATABASE_URL: 'postgresql://app:pw@localhost/buzzify' }))).toEqual(['DIRECT_DATABASE_URL']);
    expect(named(problemsWith({ DATABASE_URL: 'mysql://app:pw@db.example.com/buzzify' }))).toEqual(['DATABASE_URL']);
    expect(named(problemsWith({ DATABASE_URL: 'not a url' }))).toEqual(['DATABASE_URL']);
  });

  it('refuses the pooled URL for migrations, which need the direct connection', () => {
    expect(named(problemsWith({ DIRECT_DATABASE_URL: complete.DATABASE_URL }))).toEqual(['DIRECT_DATABASE_URL']);
  });

  it('needs the media storage and the cron secret', () => {
    expect(named(problemsWith({ R2_BUCKET: undefined, CRON_SECRET: undefined }))).toEqual(['R2_BUCKET', 'CRON_SECRET']);
    expect(named(problemsWith({ MEDIA_PUBLIC_URL: 'http://media.buzzify.me' }))).toEqual(['MEDIA_PUBLIC_URL']);
    expect(named(problemsWith({ MEDIA_PUBLIC_URL: '/api/dev-media' }))).toEqual(['MEDIA_PUBLIC_URL']);
    expect(named(problemsWith({ CRON_SECRET: 'short' }))).toEqual(['CRON_SECRET']);
    // The development folder is never production storage.
    expect(named(problemsWith({ MEDIA_LOCAL_DIR: '.data/media' }))).toEqual(['MEDIA_LOCAL_DIR']);
  });

  it('reports malformed values of the optional variables too', () => {
    expect(named(problemsWith({ EMAIL_FROM: 'Buzzify Core' }))).toEqual(['EMAIL_FROM']);
    expect(named(problemsWith({ PUBLIC_ROOT_REDIRECT: 'javascript:alert(1)' }))).toEqual(['PUBLIC_ROOT_REDIRECT']);
    expect(named(problemsWith({ STUDIO_HOST: 'https://studio.buzzify.me' }))).toEqual(['STUDIO_HOST']);
  });

  it('checks that the URLs and the hosts belong together', () => {
    // Sign-in turns away requests from an origin it was not told about, so a Studio URL on another host breaks it.
    expect(named(problemsWith({ BETTER_AUTH_URL: 'https://app.buzzify.me' }))).toEqual(['BETTER_AUTH_URL']);
    // Canonical links and QR codes would point at a host that does not serve menus.
    expect(named(problemsWith({ PUBLIC_MENU_ORIGIN: 'https://www.buzzify.me' }))).toEqual(['PUBLIC_MENU_ORIGIN']);
    // One host cannot be both: the Studio would answer for it and every menu there would be a 404.
    expect(named(problemsWith({ STUDIO_HOST: 'menu.buzzify.me', BETTER_AUTH_URL: 'https://menu.buzzify.me' }))).toEqual(['STUDIO_HOST']);
  });

  describe('the Buzzify Retail link', () => {
    const retail = {
      RETAIL_URL: 'https://retail.buzzify.me',
      RETAIL_SYNC_SECRET: 'made-up-sync-secret-of-32-characters!',
      RETAIL_CALLER_SECRET: 'made-up-caller-secret-of-32-characters',
      RETAIL_HANDOFF_SECRET: 'made-up-handoff-secret-of-32-characters',
    };

    it('is optional: without RETAIL_URL nothing about it is a problem, even stray secrets', () => {
      expect(problemsWith({})).toEqual([]);
      expect(problemsWith({ RETAIL_SYNC_SECRET: 'short', RETAIL_HANDOFF_SECRET: complete.CRON_SECRET })).toEqual([]);
      expect(problemsWith({ ...retail, RETAIL_URL: '  ' })).toEqual([]);
    });

    it('accepts a complete link, with or without the previous caller secret, and a trailing slash on the URL', () => {
      expect(problemsWith(retail)).toEqual([]);
      expect(problemsWith({ ...retail, RETAIL_CALLER_SECRET_PREVIOUS: 'made-up-previous-caller-secret-32ch' })).toEqual([]);
      expect(problemsWith({ ...retail, RETAIL_URL: 'https://retail.buzzify.me/' })).toEqual([]);
      expect(problemsWith({ ...retail, RETAIL_URL: 'https://retail.buzzify.me:8443' })).toEqual([]);
    });

    it('with RETAIL_URL set, needs the three shared secrets (the placeholder counts as none)', () => {
      expect(named(problemsWith({ RETAIL_URL: retail.RETAIL_URL }))).toEqual(['RETAIL_SYNC_SECRET', 'RETAIL_CALLER_SECRET', 'RETAIL_HANDOFF_SECRET']);
      const placeholder = 'generate with: openssl rand -base64 32';
      expect(named(problemsWith({ ...retail, RETAIL_CALLER_SECRET: placeholder }))).toEqual(['RETAIL_CALLER_SECRET']);
      // Each problem names the Retails twin to copy the value from.
      expect(problemsWith({ ...retail, RETAIL_HANDOFF_SECRET: undefined })[0]).toContain('CORE_HANDOFF_SECRET');
    });

    it('requires https and a bare origin written as Retails writes its APP_URL', () => {
      for (const bad of [
        'http://retail.buzzify.me',
        'retail.buzzify.me',
        'ftp://retail.buzzify.me',
        'https://retail.buzzify.me/app',
        'https://retail.buzzify.me/?a=1',
        'https://retail.buzzify.me/#x',
        'https://user:pw@retail.buzzify.me',
        'https://Retail.Buzzify.me',
        'https://retail.buzzify.me:443',
      ]) {
        expect(named(problemsWith({ ...retail, RETAIL_URL: bad })), bad).toEqual(['RETAIL_URL']);
      }
    });

    it('refuses a secret under 16 characters, including the optional previous one', () => {
      expect(named(problemsWith({ ...retail, RETAIL_SYNC_SECRET: 'x'.repeat(15) }))).toEqual(['RETAIL_SYNC_SECRET']);
      expect(named(problemsWith({ ...retail, RETAIL_CALLER_SECRET_PREVIOUS: 'x'.repeat(15) }))).toEqual(['RETAIL_CALLER_SECRET_PREVIOUS']);
      expect(problemsWith({ ...retail, RETAIL_SYNC_SECRET: 'x'.repeat(16) })).toEqual([]);
    });

    it('refuses one value for two jobs: among the four, or shared with CRON_SECRET or BETTER_AUTH_SECRET', () => {
      expect(named(problemsWith({ ...retail, RETAIL_HANDOFF_SECRET: retail.RETAIL_SYNC_SECRET }))).toEqual(['RETAIL_HANDOFF_SECRET']);
      expect(named(problemsWith({ ...retail, RETAIL_CALLER_SECRET_PREVIOUS: retail.RETAIL_CALLER_SECRET }))).toEqual(['RETAIL_CALLER_SECRET_PREVIOUS']);
      expect(named(problemsWith({ ...retail, RETAIL_SYNC_SECRET: complete.CRON_SECRET }))).toEqual(['RETAIL_SYNC_SECRET']);
      expect(named(problemsWith({ ...retail, RETAIL_CALLER_SECRET: complete.BETTER_AUTH_SECRET }))).toEqual(['RETAIL_CALLER_SECRET']);
    });

    it('never repeats a value in its problems', () => {
      const result = checkProductionEnv({
        ...complete,
        RETAIL_URL: 'http://hunter2.example.com/hunter2',
        RETAIL_SYNC_SECRET: 'hunter2',
        RETAIL_CALLER_SECRET: complete.CRON_SECRET,
        RETAIL_HANDOFF_SECRET: 'hunter2-handoff-secret-value',
        RETAIL_CALLER_SECRET_PREVIOUS: 'hunter2-handoff-secret-value',
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.problems.join('\n')).not.toMatch(/hunter2|made-up-cron/);
      expect(named(result.problems)).toEqual(['RETAIL_URL', 'RETAIL_SYNC_SECRET', 'RETAIL_CALLER_SECRET', 'RETAIL_HANDOFF_SECRET']);
    });
  });

  it('names each variable once and never repeats a value', () => {
    const wrong = {
      DATABASE_URL: 'postgresql://app:hunter2-pooled@127.0.0.1/buzzify',
      DIRECT_DATABASE_URL: 'mysql://app:hunter2-direct@db.example.com/buzzify',
      BETTER_AUTH_SECRET: 'short-secret-value',
      BETTER_AUTH_URL: 'http://studio.buzzify.me/hunter2-path',
      RESEND_API_KEY: '',
      EMAIL_FROM: 'hunter2 sender',
      PUBLIC_MENU_HOST: 'https://hunter2.buzzify.me',
      STUDIO_HOST: 'studio.buzzify.me/hunter2',
      PUBLIC_MENU_ORIGIN: 'hunter2-origin',
      PUBLIC_ROOT_REDIRECT: 'hunter2-redirect',
      R2_ACCOUNT_ID: 'hunter2-account',
      R2_ACCESS_KEY_ID: '',
      R2_SECRET_ACCESS_KEY: 'hunter2-r2-secret',
      R2_BUCKET: 'hunter2-bucket',
      MEDIA_PUBLIC_URL: 'http://hunter2-media.example.com',
      MEDIA_LOCAL_DIR: 'hunter2-dir',
      CRON_SECRET: 'hunter2-short',
      DEV_SEED_PASSWORD: 'hunter2-seed-password',
    };
    const result = checkProductionEnv(wrong);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems.join('\n')).not.toMatch(/hunter2|short-secret-value/);
    expect(named(result.problems)).toEqual([
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
      'R2_ACCESS_KEY_ID',
      'MEDIA_PUBLIC_URL',
      'MEDIA_LOCAL_DIR',
      'CRON_SECRET',
      'DEV_SEED_PASSWORD',
    ]);
  });
});
