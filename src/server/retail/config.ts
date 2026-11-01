/**
 * The settings of the link to Buzzify Retail. Read from the environment on each access, so a value set or rotated in
 * the platform applies to the next call and a test can set it; a missing or invalid value fails where it is used.
 * Errors name the variable only, never a value.
 *
 * | Studio variable                 | Retails' twin (same value)    | Used to                                            |
 * | ------------------------------- | ----------------------------- | -------------------------------------------------- |
 * | `RETAIL_URL`                    | its `APP_URL`                 | call Retails; the only handoff return accepted     |
 * | `RETAIL_SYNC_SECRET`            | `CORE_SYNC_SECRET`            | sign provision and state calls to Retails          |
 * | `RETAIL_CALLER_SECRET`          | `CORE_OUT_SECRET`             | verify Retails' calls (ai-config, identities)      |
 * | `RETAIL_CALLER_SECRET_PREVIOUS` | (Retails' previous value)     | optional: also accepted while the secret rotates   |
 * | `RETAIL_HANDOFF_SECRET`         | `CORE_HANDOFF_SECRET`         | sign the sign-in handoff token                     |
 *
 * Without `RETAIL_URL` the link is off: nothing is sent and the cron routes do nothing.
 */

export class RetailConfigError extends Error {
  readonly variable: string;
  constructor(variable: string) {
    super(`Missing or invalid environment variable ${variable}`);
    this.name = 'RetailConfigError';
    this.variable = variable;
  }
}

const MIN_SECRET_LENGTH = 16;

/** `.env.example`'s placeholder, copied unchanged, is no value (it would pass the length check). */
const PLACEHOLDER = /^generate with:/i;

const value = (name: string): string | undefined => {
  const v = process.env[name]?.trim();
  return v && !PLACEHOLDER.test(v) ? v : undefined;
};

function secret(name: string, required: boolean): string | undefined {
  const v = value(name);
  if (!v) {
    if (required) throw new RetailConfigError(name);
    return undefined;
  }
  if (v.length < MIN_SECRET_LENGTH) throw new RetailConfigError(name);
  return v;
}

function baseUrl(): string {
  const raw = value('RETAIL_URL');
  if (!raw) throw new RetailConfigError('RETAIL_URL');
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new RetailConfigError('RETAIL_URL');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new RetailConfigError('RETAIL_URL');
  // The signed calls carry the shop's owner and plan, and the handoff a sign-in token: never over plain http in production.
  if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:') throw new RetailConfigError('RETAIL_URL');
  return raw.replace(/\/+$/, '');
}

export interface RetailConfig {
  /** RETAIL_URL is set: the link is on. Never throws. */
  readonly enabled: boolean;
  /** Retails' origin, no trailing slash. */
  readonly baseUrl: string;
  /** Signs Studio -> Retails calls. */
  readonly syncSecret: string;
  /** Accepted on Retails -> Studio calls: the current one, then the previous one during a rotation. */
  readonly callerSecrets: string[];
  /** Signs handoff tokens. */
  readonly handoffSecret: string;
  /** The one return address a handoff may go back to. */
  readonly callbackUrl: string;
}

export function retailConfig(): RetailConfig {
  return {
    get enabled() {
      return value('RETAIL_URL') !== undefined;
    },
    get baseUrl() {
      return baseUrl();
    },
    get syncSecret() {
      return secret('RETAIL_SYNC_SECRET', true)!;
    },
    get callerSecrets() {
      const list = [secret('RETAIL_CALLER_SECRET', true)!];
      const previous = secret('RETAIL_CALLER_SECRET_PREVIOUS', false);
      if (previous) list.push(previous);
      return list;
    },
    get handoffSecret() {
      return secret('RETAIL_HANDOFF_SECRET', true)!;
    },
    get callbackUrl() {
      return `${baseUrl()}/api/core/v1/handoff/callback`;
    },
  };
}
