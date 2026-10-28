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
    'must be an address such as studio@buzzify.me, or a name and address such as Buzzify Core <studio@buzzify.me>',
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
  EMAIL_FROM: z.preprocess(unset, sender.default('Buzzify Core <studio@buzzify.me>')),
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
// Media storage
// ---------------------------------------------------------------------------------------------------------------------

const R2_VARIABLES = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET'] as const;

const optionalText = z.preprocess(
  unset,
  z
    .string()
    .trim()
    .nullish()
    .transform((value) => value ?? null),
);

const storageSchema = z.object({
  R2_ACCOUNT_ID: optionalText,
  R2_ACCESS_KEY_ID: optionalText,
  R2_SECRET_ACCESS_KEY: optionalText,
  R2_BUCKET: optionalText,
  /** Where stored files are served from: the bucket's custom domain, or the development route. */
  MEDIA_PUBLIC_URL: optionalText,
  /** The development folder files are kept in. */
  MEDIA_LOCAL_DIR: optionalText,
});

export type StorageEnv =
  | { kind: 'r2'; accountId: string; accessKeyId: string; secretAccessKey: string; bucket: string; publicUrl: string }
  | { kind: 'folder'; dir: string; publicUrl: string };

const DEVELOPMENT_MEDIA_URL = '/api/dev-media';
const DEVELOPMENT_MEDIA_DIR = '.data/media';

/**
 * Reads where media is stored. Cloudflare R2 when all four of its variables are set; none of them means the
 * development folder, which production refuses; some but not all is a mistake, and the missing ones are named.
 */
export function parseStorageEnv(source: Source): StorageEnv {
  const parsed = storageSchema.parse(source);
  const set = R2_VARIABLES.filter((name) => parsed[name] !== null);
  const publicUrl = parsed.MEDIA_PUBLIC_URL?.replace(/\/+$/, '');
  if (set.length === R2_VARIABLES.length) {
    if (!publicUrl) throw new Error('MEDIA_PUBLIC_URL must be set to the address R2 files are served on, such as https://media.buzzify.me.');
    return {
      kind: 'r2',
      accountId: parsed.R2_ACCOUNT_ID!,
      accessKeyId: parsed.R2_ACCESS_KEY_ID!,
      secretAccessKey: parsed.R2_SECRET_ACCESS_KEY!,
      bucket: parsed.R2_BUCKET!,
      publicUrl,
    };
  }
  if (set.length > 0) {
    const missing = R2_VARIABLES.filter((name) => parsed[name] === null);
    throw new Error(`R2 is only partly configured: set ${missing.join(', ')} as well, or unset the others.`);
  }
  if (source.NODE_ENV === 'production') {
    throw new Error('Media storage needs R2 in production: set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_BUCKET.');
  }
  return { kind: 'folder', dir: parsed.MEDIA_LOCAL_DIR ?? DEVELOPMENT_MEDIA_DIR, publicUrl: publicUrl ?? DEVELOPMENT_MEDIA_URL };
}

// ---------------------------------------------------------------------------------------------------------------------
// Private invoice storage (pharmacy intake)
// ---------------------------------------------------------------------------------------------------------------------

const INTAKE_VARIABLES = ['PH_INTAKE_R2_ACCOUNT_ID', 'PH_INTAKE_R2_ACCESS_KEY_ID', 'PH_INTAKE_R2_SECRET_ACCESS_KEY', 'PH_INTAKE_R2_BUCKET'] as const;

const intakeSchema = z.object({
  PH_INTAKE_R2_ACCOUNT_ID: optionalText,
  PH_INTAKE_R2_ACCESS_KEY_ID: optionalText,
  PH_INTAKE_R2_SECRET_ACCESS_KEY: optionalText,
  PH_INTAKE_R2_BUCKET: optionalText,
});

export interface IntakeStorageEnv {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
}

/**
 * Where uploaded supplier invoices are kept: a SEPARATE private R2 bucket, never the public media bucket. All four
 * variables or none; `null` means not configured (the development folder in development, no upload in production).
 */
export function parseIntakeStorageEnv(source: Source): IntakeStorageEnv | null {
  const parsed = intakeSchema.parse(source);
  const set = INTAKE_VARIABLES.filter((name) => parsed[name] !== null);
  if (set.length === 0) return null;
  if (set.length < INTAKE_VARIABLES.length) {
    const missing = INTAKE_VARIABLES.filter((name) => parsed[name] === null);
    throw new Error(`Invoice storage is only partly configured: set ${missing.join(', ')} as well, or unset the others.`);
  }
  return {
    accountId: parsed.PH_INTAKE_R2_ACCOUNT_ID!,
    accessKeyId: parsed.PH_INTAKE_R2_ACCESS_KEY_ID!,
    secretAccessKey: parsed.PH_INTAKE_R2_SECRET_ACCESS_KEY!,
    bucket: parsed.PH_INTAKE_R2_BUCKET!,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Pharmacy AI pricing
// ---------------------------------------------------------------------------------------------------------------------

export interface AiPricingEnv {
  /** Micro-dollars per million input tokens. */
  inputPerMtok: bigint;
  /** Micro-dollars per million output tokens. */
  outputPerMtok: bigint;
}

const PRICE_VARIABLES = ['AI_PRICE_INPUT_USD_MICRO_PER_MTOK', 'AI_PRICE_OUTPUT_USD_MICRO_PER_MTOK'] as const;

/**
 * The model's price, which the pharmacy AI budget is counted in. Both variables or neither, each a positive whole number,
 * and NO default: with none set the pharmacy AI refuses to run (a wrong guessed price would make the budget meaningless).
 */
export function parseAiPricingEnv(source: Source): AiPricingEnv | null {
  const values = PRICE_VARIABLES.map((name) => {
    const value = unset(source[name]);
    return typeof value === 'string' ? value.trim() : null;
  });
  if (values.every((v) => v === null)) return null;
  const missing = PRICE_VARIABLES.filter((_, n) => values[n] === null);
  if (missing.length > 0) throw new Error(`AI pricing is only partly configured: set ${missing.join(', ')} as well, or unset the other.`);
  const [input, output] = values.map((v, n) => {
    if (!/^[1-9][0-9]{0,17}$/.test(v!)) throw new Error(`${PRICE_VARIABLES[n]} must be a positive whole number (micro-dollars per million tokens).`);
    return BigInt(v!);
  }) as [bigint, bigint];
  return { inputPerMtok: input, outputPerMtok: output };
}

// ---------------------------------------------------------------------------------------------------------------------
// Scheduled publishing
// ---------------------------------------------------------------------------------------------------------------------

/** Vercel sends it as a bearer token with every cron request; anyone without it is refused. */
const MIN_CRON_SECRET_LENGTH = 32;

export interface CronEnv {
  /** `null` when none is configured: the cron route then refuses every call. */
  secret: string | null;
}

export function parseCronEnv(source: Source): CronEnv {
  const value = unset(source.CRON_SECRET);
  if (typeof value !== 'string') return { secret: null };
  const secret = value.trim();
  if (secret.length < MIN_CRON_SECRET_LENGTH) {
    throw new Error(`CRON_SECRET must be at least ${MIN_CRON_SECRET_LENGTH} characters (openssl rand -base64 32).`);
  }
  return { secret };
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
  'R2_ACCOUNT_ID',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_BUCKET',
  'MEDIA_PUBLIC_URL',
  'MEDIA_LOCAL_DIR',
  'CRON_SECRET',
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

  const r2 = [
    ['R2_ACCOUNT_ID', 'the account ID shown on the R2 page of Cloudflare'],
    ['R2_ACCESS_KEY_ID', 'the access key of an R2 API token limited to the bucket'],
    ['R2_SECRET_ACCESS_KEY', 'the secret of that R2 API token'],
    ['R2_BUCKET', 'the name of the R2 bucket media is stored in'],
  ] as const;
  for (const [name, what] of r2) if (!text(name)) report(name, `is not set (${what})`);

  const mediaUrl = text('MEDIA_PUBLIC_URL');
  if (!mediaUrl) report('MEDIA_PUBLIC_URL', 'is not set (the address the bucket is served on, such as https://media.buzzify.me)');
  else if (!isHttps(mediaUrl)) report('MEDIA_PUBLIC_URL', 'must start with https://');

  if (text('MEDIA_LOCAL_DIR')) report('MEDIA_LOCAL_DIR', 'must not be set in production; media is stored in R2');

  // Pharmacy invoice storage is optional (without it upload is switched off), but never half set.
  if (INTAKE_VARIABLES.some((name) => text(name))) {
    for (const name of INTAKE_VARIABLES) if (!text(name)) report(name, 'is not set (invoice storage needs all four PH_INTAKE_R2_ variables or none)');
  }

  const cronSecret = text('CRON_SECRET');
  if (!cronSecret) report('CRON_SECRET', 'is not set (generate one with: openssl rand -base64 32)');
  else if (cronSecret.length < MIN_CRON_SECRET_LENGTH) report('CRON_SECRET', `must be at least ${MIN_CRON_SECRET_LENGTH} characters`);

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

/** Where media is stored: R2, or the development folder. */
export const storageEnv = lazy(parseStorageEnv);

/** Where pharmacy invoice files are stored privately, or null when not configured. */
export const intakeStorageEnv = lazy(parseIntakeStorageEnv);

/** The model price for the pharmacy AI budget, or null when not configured (the AI then refuses to run). */
export const aiPricingEnv = lazy(parseAiPricingEnv);

