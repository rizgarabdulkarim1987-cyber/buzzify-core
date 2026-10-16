import { z } from 'zod';

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

const schema = z.object({
  /** The host that serves public menus. Unset in development. */
  PUBLIC_MENU_HOST: host,
  /** The host that serves the Studio. Unset in development. */
  STUDIO_HOST: host,
  /** The origin public menu URLs are built on (canonical links, QR codes). */
  PUBLIC_MENU_ORIGIN: z.preprocess(unset, httpUrl.default('http://127.0.0.1:3100')),
  /** Where `/` on the public host sends visitors. */
  PUBLIC_ROOT_REDIRECT: z.preprocess(unset, httpUrl.default('https://buzzify.me')),
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

export interface Env {
  publicHost: string | null;
  studioHost: string | null;
  /** No trailing slash. */
  publicOrigin: string;
  rootRedirect: string;
  /** `null` when no key is configured. */
  resendApiKey: string | null;
  /** The `from` of every Studio email. */
  emailFrom: string;
}

/** Reads the configuration from an environment. Throws a `ZodError` naming the variable when a value is malformed. */
export function parseEnv(source: Record<string, string | undefined>): Env {
  const parsed = schema.parse(source);
  return {
    publicHost: parsed.PUBLIC_MENU_HOST,
    studioHost: parsed.STUDIO_HOST,
    publicOrigin: parsed.PUBLIC_MENU_ORIGIN.replace(/\/+$/, ''),
    rootRedirect: parsed.PUBLIC_ROOT_REDIRECT,
    resendApiKey: parsed.RESEND_API_KEY,
    emailFrom: parsed.EMAIL_FROM,
  };
}

let cached: Env | undefined;

/** The application's configuration, parsed from `process.env` on first use and kept. Later tasks add variables here. */
export function env(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}
