import { z } from 'zod';

/**
 * Configuration comes in three independent sections, each parsed on first use from `process.env` and then kept, so one
 * bad variable breaks only the feature that needs it:
 *
 * - `hostEnv()`: which host serves what. The only section `src/proxy.ts` reads, so a mistake in the email or sign-in
 *   variables can never take public menus down.
 * - `mailEnv()`: the Resend key and the sender. Read when an email is sent.
 * - `authEnv()`: the sign-in secret and URL. Read when the Studio's auth is built.
 *
 * Each section also has a pure `parse*Env(source)` for tests.
 *
 * `checkProductionEnv` is separate: the deploy-time check (`scripts/check-env.ts`, first step of `vercel-build`) that
 * judges all three sections for production at once and lists every problem, so a bad deploy fails before it migrates.
 */

type Source = Record<string, string | undefined>;

/** An unset variable and an empty one mean the same: not configured. */
const unset = (value: unknown) => (typeof value === 'string' && value.trim() === '' ? undefined : value);

/** A host name with an optional port and nothing else: no scheme, no path. A value like `https://x.me` would never match a request's host. */
const host = z.preprocess(
  unset,
  z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:\d{1,5})?$/, 'must be a host name such as menu.buzzify.me, without https:// or a path')
    .nullish()
    .transform((value) => value ?? null),
);

const httpUrl = z
  .string()
  .trim()
  .refine((value) => URL.canParse(value) && /^https?:$/.test(new URL(value).protocol), 'must be an http(s) URL');

/** A bare address, or a display name followed by an address in angle brackets: what Resend accepts as `from`. */
const sender = z
  .string()
  .trim()
  .regex(
    /^(?:[^<>@\r\n]+ <[^\s<>@]+@[^\s<>@]+>|[^\s<>@]+@[^\s<>@]+)$/,
    'must be an address such as studio@buzzify.me, or a name and address such as Buzzify Studio <studio@buzzify.me>',
  );

// ---------------------------------------------------------------------------------------------------------------------
// Hosts
// ---------------------------------------------------------------------------------------------------------------------

const hostSchema = z.object({
  /** The host that serves public menus. Unset in development. */
  PUBLIC_MENU_HOST: host,
  /** The host that serves the Studio. Unset in development. */
  STUDIO_HOST: host,
  /** The origin public menu URLs are built on (canonical links, QR codes). */
  PUBLIC_MENU_ORIGIN: z.preprocess(unset, httpUrl.default('http://127.0.0.1:3100')),
  /** Where `/` on the public host sends visitors. */
  PUBLIC_ROOT_REDIRECT: z.preprocess(unset, httpUrl.default('https://buzzify.me')),
});

export interface HostEnv {
  publicHost: string | null;
  studioHost: string | null;
  /** No trailing slash. */
  publicOrigin: string;
  rootRedirect: string;
}

/** Reads the host configuration. Throws a `ZodError` naming the variable when a value is malformed. */
export function parseHostEnv(source: Source): HostEnv {
  const parsed = hostSchema.parse(source);
  return {
    publicHost: parsed.PUBLIC_MENU_HOST,
    studioHost: parsed.STUDIO_HOST,
    publicOrigin: parsed.PUBLIC_MENU_ORIGIN.replace(/\/+$/, ''),
    rootRedirect: parsed.PUBLIC_ROOT_REDIRECT,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Email
// ---------------------------------------------------------------------------------------------------------------------

const mailSchema = z.object({
  /** The Resend API key. Unset in development, where mail goes to `.data/mail`; production refuses to send without it. */
  RESEND_API_KEY: z.preprocess(
    unset,
    z
      .string()
      .trim()
      .nullish()
      .transform((value) => value ?? null),
  ),
  /** The sender of every Studio email. */
  EMAIL_FROM: z.preprocess(unset, sender.default('Buzzify Studio <studio@buzzify.me>')),
});

export interface MailEnv {
  /** `null` when no key is configured. */
  resendApiKey: string | null;
  /** The `from` of every Studio email. */
  emailFrom: string;
}

/** Reads the email configuration. Throws a `ZodError` naming the variable when a value is malformed. */
export function parseMailEnv(source: Source): MailEnv {
  const parsed = mailSchema.parse(source);
  return { resendApiKey: parsed.RESEND_API_KEY, emailFrom: parsed.EMAIL_FROM };
}

// ---------------------------------------------------------------------------------------------------------------------
// Sign-in
// ---------------------------------------------------------------------------------------------------------------------

/** The shortest secret Better Auth is safe with (it signs cookies and encrypts two-factor secrets with it). */
const MIN_SECRET_LENGTH = 32;

/**
 * Signs and encrypts in development when no secret is set. It is public, so it must never be accepted in production:
 * anyone could forge a session cookie with it.
 */
const DEVELOPMENT_SECRET = 'buzzify-studio-development-secret-not-for-production-use';

const DEVELOPMENT_URL = 'http://127.0.0.1:3100';

/** An origin and nothing else: Better Auth appends its own `/api/auth` to it, and emailed links are built on it. */
const origin = httpUrl.refine((value) => {
  // Refinements all run even when an earlier one failed, so a value that is not a URL at all gets here too.
  if (!URL.canParse(value)) return true;
  const url = new URL(value);
  return url.pathname === '/' && url.search === '' && url.hash === '';
}, 'must be an origin such as https://studio.buzzify.me, without a path');

/** What `.env.example` holds. Copied as it is, it must count as no secret rather than as a public one. */
const SECRET_PLACEHOLDER = /^generate with/i;

const authSchema = z.object({
  BETTER_AUTH_SECRET: z.preprocess(
    (value) => (typeof value === 'string' && SECRET_PLACEHOLDER.test(value.trim()) ? undefined : unset(value)),
    z
      .string()
      .trim()
      .nullish()
      .transform((value) => value ?? null),
  ),
  BETTER_AUTH_URL: z.preprocess(
    unset,
    origin.nullish().transform((value) => value ?? null),
  ),
});

export interface AuthEnv {
  /** At least 32 characters in production; a fixed development value elsewhere. */
  secret: string;
  /** The origin the Studio is served on, no trailing slash. Emailed links are built on it. */
  baseUrl: string;
  production: boolean;
}

/**
 * Reads the sign-in configuration. In production the secret must be set to 32 characters or more and the URL must be
 * set, otherwise this throws: a forgotten secret would let anyone forge a session, and a forgotten URL would send
 * reset links to the local machine. Outside production both fall back to development values.
 */
export function parseAuthEnv(source: Source): AuthEnv {
  const parsed = authSchema.parse(source);
  const production = source.NODE_ENV === 'production';

  if (production) {
    if (!parsed.BETTER_AUTH_SECRET || parsed.BETTER_AUTH_SECRET.length < MIN_SECRET_LENGTH) {
      throw new Error(`BETTER_AUTH_SECRET must be set to at least ${MIN_SECRET_LENGTH} characters in production (openssl rand -base64 32).`);
    }
    if (parsed.BETTER_AUTH_SECRET === DEVELOPMENT_SECRET) {
      throw new Error('BETTER_AUTH_SECRET is the public development secret; set a private one in production.');
    }
    if (!parsed.BETTER_AUTH_URL) {
      throw new Error('BETTER_AUTH_URL must be set in production, to the origin the Studio is served on.');
    }
  }

  return {
    secret: parsed.BETTER_AUTH_SECRET ?? DEVELOPMENT_SECRET,
    baseUrl: (parsed.BETTER_AUTH_URL ?? DEVELOPMENT_URL).replace(/\/+$/, ''),
    production,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// The production check
// ---------------------------------------------------------------------------------------------------------------------

export type ProductionEnvCheck = { ok: true } | { ok: false; problems: string[] };

/** The variables the production check looks at, in the order its problems are listed. */
const CHECKED_VARIABLES = [
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
] as const;

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** What is wrong with a database URL, or null. Neon's pooled hosts carry `-pooler` after the endpoint name. */
function databaseUrlProblem(url: string, direct: boolean): string | null {
  if (!/^postgres(ql)?:\/\//i.test(url) || !URL.canParse(url)) return 'must be a postgresql:// connection URL';
  const { hostname } = new URL(url);
  if (LOOPBACK_HOSTS.has(hostname)) return 'points at this machine; use the hosted database';
  if (direct && hostname.split('.')[0].endsWith('-pooler')) {
    return 'is the pooled URL; migrations need the direct one (its host has no "-pooler")';
  }
  return null;
}

const isHttps = (value: string) => URL.canParse(value) && new URL(value).protocol === 'https:';

/**
 * Checks everything a production deployment needs and says what is wrong with all of it at once, so one failed deploy
 * is enough to fix every variable. It judges the values as production would, whatever `NODE_ENV` says, and each
 * problem starts with the variable's name and never repeats a value (these are secrets).
 *
 * This is the deploy-time guard (`scripts/check-env.ts`, run first by `vercel-build`). It does not replace the runtime
 * readers: each section is still parsed on first use and breaks only its own feature. The host section is the one place
 * the runtime stays lenient, on purpose: it is read by the proxy on every request, so a mistake there must not take
 * public menus down.
 */
export function checkProductionEnv(source: Source = process.env): ProductionEnvCheck {
  const found = new Map<string, string>();
  /** The first problem found for a variable is the one reported. */
  const report = (name: string, message: string) => {
    if (!found.has(name)) found.set(name, message);
  };
  const text = (name: string): string | undefined => {
    const value = unset(source[name]);
    return typeof value === 'string' ? value.trim() : undefined;
  };

  // Malformed values, by the same rules the sections apply at run time. Their messages are written for people and name
  // no value.
  for (const schema of [hostSchema, mailSchema, authSchema]) {
    const result = schema.safeParse(source);
    if (result.success) continue;
    for (const issue of result.error.issues) report(String(issue.path[0]), issue.message);
  }

  const databaseUrls = [
    ['DATABASE_URL', 'the pooled connection URL from Neon', false],
    ['DIRECT_DATABASE_URL', 'the direct connection URL from Neon, used to migrate the database', true],
  ] as const;
  for (const [name, what, direct] of databaseUrls) {
    const url = text(name);
    if (!url) report(name, `is not set (${what})`);
    else {
      const problem = databaseUrlProblem(url, direct);
      if (problem) report(name, problem);
    }
  }

  const secret = text('BETTER_AUTH_SECRET');
  if (!secret || SECRET_PLACEHOLDER.test(secret)) report('BETTER_AUTH_SECRET', 'is not set (generate one with: openssl rand -base64 32)');
  else if (secret.length < MIN_SECRET_LENGTH) report('BETTER_AUTH_SECRET', `must be at least ${MIN_SECRET_LENGTH} characters`);
  else if (secret === DEVELOPMENT_SECRET) report('BETTER_AUTH_SECRET', 'is the public development secret; set a private one');

  const authUrl = text('BETTER_AUTH_URL');
  if (!authUrl) report('BETTER_AUTH_URL', 'is not set (the address the Studio is served on, such as https://studio.buzzify.me)');
  else if (!isHttps(authUrl)) report('BETTER_AUTH_URL', 'must start with https://');

  if (!text('RESEND_API_KEY')) report('RESEND_API_KEY', 'is not set (create an API key in Resend)');

  const publicHost = text('PUBLIC_MENU_HOST')?.toLowerCase();
  if (!publicHost) report('PUBLIC_MENU_HOST', 'is not set (the host that serves public menus, such as menu.buzzify.me)');
  const studioHost = text('STUDIO_HOST')?.toLowerCase();
  if (!studioHost) report('STUDIO_HOST', 'is not set (the host that serves the Studio, such as studio.buzzify.me)');

  // Development falls back to the local address; production must not, or every canonical link and QR code would carry it.
  const publicOrigin = text('PUBLIC_MENU_ORIGIN');
  if (!publicOrigin) report('PUBLIC_MENU_ORIGIN', 'is not set (the address public menus are served on, such as https://menu.buzzify.me)');
  else if (!isHttps(publicOrigin)) report('PUBLIC_MENU_ORIGIN', 'must start with https://');

  if (text('DEV_SEED_PASSWORD')) {
    report('DEV_SEED_PASSWORD', 'must not be set in production; it creates users whose password is published in .env.example');
  }

  // The values have to agree with each other. These only run when each side is otherwise fine.
  const clean = (name: string) => !found.has(name);
  const hostOf = (url: string) => new URL(url).host.toLowerCase();
  // Sign-in turns away requests from an origin it was not told about.
  if (authUrl && studioHost && clean('BETTER_AUTH_URL') && clean('STUDIO_HOST') && hostOf(authUrl) !== studioHost) {
    report('BETTER_AUTH_URL', 'must be an https address on the host named by STUDIO_HOST');
  }
  // Canonical links and QR codes are built on the origin, so it has to be where menus are served.
  if (publicOrigin && publicHost && clean('PUBLIC_MENU_ORIGIN') && clean('PUBLIC_MENU_HOST') && hostOf(publicOrigin) !== publicHost) {
    report('PUBLIC_MENU_ORIGIN', 'must be an https address on the host named by PUBLIC_MENU_HOST');
  }
  // The proxy gives the Studio host first claim, so a shared host would make every menu there a 404.
  if (publicHost && publicHost === studioHost && clean('STUDIO_HOST')) {
    report('STUDIO_HOST', 'must differ from PUBLIC_MENU_HOST; one host cannot serve both');
  }

  // In the order of CHECKED_VARIABLES; anything else a schema might name follows, so no problem is ever dropped.
  const order = new Set<string>([...CHECKED_VARIABLES, ...found.keys()]);
  const problems = [...order].filter((name) => found.has(name)).map((name) => `${name} ${found.get(name)}`);
  return problems.length > 0 ? { ok: false, problems } : { ok: true };
}

// ---------------------------------------------------------------------------------------------------------------------
// Cached readers
// ---------------------------------------------------------------------------------------------------------------------

/** Reads a section on first use and keeps it. A section that throws is not kept, so the next call throws again. */
function lazy<T>(parse: (source: Source) => T): () => T {
  let cached: T | undefined;
  return () => (cached ??= parse(process.env));
}

/** Host routing: the proxy's whole configuration. */
export const hostEnv = lazy(parseHostEnv);

/** The email key and sender. */
export const mailEnv = lazy(parseMailEnv);

/** The sign-in secret and URL. */
export const authEnv = lazy(parseAuthEnv);
