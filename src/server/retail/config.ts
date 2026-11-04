import { RETAIL_ACTIVITIES, type RetailActivity } from '@/server/domain/retail/activity';

/**
 * The settings of the link to Buzzify Retail. Read from the environment on each access, so a value set or rotated in
 * the platform applies to the next call and a test can set it; a missing or invalid value fails where it is used.
 * Errors name the variable only, never a value.
 *
 * | Studio variable                 | Retails' twin (same value)    | Used to                                            |
 * | ------------------------------- | ----------------------------- | -------------------------------------------------- |
 * | `RETAIL_URL`                    | its `APP_URL`                 | call Retails; a handoff return accepted            |
 * | `RETAIL_URL_SUPERMARKET`        | (an address Retails serves)   | optional: where a supermarket's owner is sent      |
 * | `RETAIL_URL_ELECTRONICS`        | (an address Retails serves)   | optional: where an electronics shop's owner is sent|
 * | `RETAIL_URL_CLOTHING`           | (an address Retails serves)   | optional: where a clothing shop's owner is sent    |
 * | `RETAIL_SYNC_SECRET`            | `CORE_SYNC_SECRET`            | sign provision and state calls to Retails          |
 * | `RETAIL_CALLER_SECRET`          | `CORE_OUT_SECRET`             | verify Retails' calls (ai-config, identities)      |
 * | `RETAIL_CALLER_SECRET_PREVIOUS` | (Retails' previous value)     | optional: also accepted while the secret rotates   |
 * | `RETAIL_HANDOFF_SECRET`         | `CORE_HANDOFF_SECRET`         | sign the sign-in handoff token                     |
 *
 * One Retails app serves the three Retail products, so there is one set of secrets and every server-to-server call goes
 * to `RETAIL_URL`. Each product may have its own address, where its owners sign in (`RETAIL_URL_<PRODUCT>`, the same
 * rules as `RETAIL_URL`); unset, it is `RETAIL_URL`. A handoff may return to any of these addresses, and only to them.
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

const SECRET_NAMES = ['RETAIL_SYNC_SECRET', 'RETAIL_CALLER_SECRET', 'RETAIL_CALLER_SECRET_PREVIOUS', 'RETAIL_HANDOFF_SECRET'] as const;

/** The variable that holds a Retail product's own address. */
export const PRODUCT_URL_VARIABLES: Record<RetailActivity, string> = {
  SUPERMARKET: 'RETAIL_URL_SUPERMARKET',
  ELECTRONICS: 'RETAIL_URL_ELECTRONICS',
  CLOTHING: 'RETAIL_URL_CLOTHING',
};

/** Where Retails takes a signed-in browser back: its handoff callback at an address it serves. */
const CALLBACK_PATH = '/api/core/v1/handoff/callback';

function secret(name: (typeof SECRET_NAMES)[number], required: boolean): string | undefined {
  const v = value(name);
  if (!v) {
    if (required) throw new RetailConfigError(name);
    return undefined;
  }
  if (v.length < MIN_SECRET_LENGTH) throw new RetailConfigError(name);
  // One value for two jobs would let the holder of one (say, a leaked handoff key) forge the other: each must differ.
  if (SECRET_NAMES.some((other) => other !== name && value(other) === v)) throw new RetailConfigError(name);
  return v;
}

/** An address of Retails, checked; the variable's name is the error's. */
function origin(name: string, raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new RetailConfigError(name);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new RetailConfigError(name);
  // An origin only: the paths Studio calls and signs are appended to it, so a path, query, hash or credentials break both.
  if (url.pathname !== '/' || url.search !== '' || url.hash !== '' || url.username !== '' || url.password !== '') {
    throw new RetailConfigError(name);
  }
  // Written exactly as its origin (lowercase, no default port): Retails names the handoff return from the address as
  // written and `checkReturn` compares with the address built from this one, so any other spelling refuses every
  // sign-in. The deploy check (`checkProductionEnv`) applies the same rule.
  if (raw.replace(/\/$/, '') !== url.origin) throw new RetailConfigError(name);
  // The signed calls carry the shop's owner and plan, and the handoff a sign-in token: never over plain http in production.
  if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:') throw new RetailConfigError(name);
  return url.origin;
}

function baseUrl(): string {
  const raw = value('RETAIL_URL');
  if (!raw) throw new RetailConfigError('RETAIL_URL');
  return origin('RETAIL_URL', raw);
}

/** A product's own address, or `RETAIL_URL` when it has none. */
function productUrl(activity: RetailActivity): string {
  const name = PRODUCT_URL_VARIABLES[activity];
  const raw = value(name);
  // The link itself must be on: a product address alone switches nothing on.
  const base = baseUrl();
  return raw ? origin(name, raw) : base;
}

export interface RetailConfig {
  /** RETAIL_URL is set: the link is on. Never throws. */
  readonly enabled: boolean;
  /** Retails' origin, no trailing slash: where every server-to-server call goes. */
  readonly baseUrl: string;
  /** Signs Studio -> Retails calls. */
  readonly syncSecret: string;
  /** Accepted on Retails -> Studio calls: the current one, then the previous one during a rotation. */
  readonly callerSecrets: string[];
  /** Signs handoff tokens. */
  readonly handoffSecret: string;
  /** The handoff return at `RETAIL_URL`. */
  readonly callbackUrl: string;
  /** Every handoff return accepted: `RETAIL_URL`'s and each product address's, without repeats. */
  readonly callbackUrls: string[];
  /** Where a shop of this product's owner signs in to Retails: its own address, else `RETAIL_URL`. */
  baseUrlFor(activity: RetailActivity): string;
  /** The handoff return at that product's address. */
  callbackUrlFor(activity: RetailActivity): string;
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
      return `${baseUrl()}${CALLBACK_PATH}`;
    },
    get callbackUrls() {
      return [...new Set([baseUrl(), ...RETAIL_ACTIVITIES.map(productUrl)])].map((address) => `${address}${CALLBACK_PATH}`);
    },
    baseUrlFor: productUrl,
    callbackUrlFor: (activity) => `${productUrl(activity)}${CALLBACK_PATH}`,
  };
}
