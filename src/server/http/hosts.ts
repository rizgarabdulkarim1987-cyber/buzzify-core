export interface HostConfig {
  /** The host that serves public menus (`menu.buzzify.me`), or null when none is configured. */
  publicHost: string | null;
  /** The host that serves the Studio (`studio.buzzify.me`), or null when none is configured. */
  studioHost: string | null;
  /** Where `/` on the public host goes: the company site. */
  rootRedirect: string;
  /** Whether this is a production deployment (`NODE_ENV` is `production`). */
  production: boolean;
  /** The pharmacy's own host. While null, the Studio host still serves the pharmacy. */
  pharmacyHost?: string | null;
  /** The super admin's host. While null, the Studio host still serves the super admin's pages. */
  coreHost?: string | null;
  /**
   * The super admin host's secret path (`7728914040`, no slashes needed). While set, every request to the core host
   * answers 404 unless it carries the gate cookie, and the path itself hands that cookie out. Unset: no gate.
   */
  coreGatePath?: string | null;
  /** The main domain (`buzzify.tech`): it and its `www.` send every path to `rootRedirect`. */
  apexHost?: string | null;
  /**
   * Old hosts that only redirect. A name starting with `studio.` goes to `studioHost`, any other to `publicHost`,
   * keeping path and query. The scheduler's `/api/cron` routes still answer on them.
   */
  legacyHosts?: string[];
}

/** `knock` is the super admin's secret path: the proxy sets the gate cookie, then redirects to `to`. */
export type HostDecision =
  | { action: 'next' }
  | { action: 'redirect'; to: string }
  | { action: 'knock'; to: string }
  | { action: 'notFound' };

const NEXT: HostDecision = { action: 'next' };
const NOT_FOUND: HostDecision = { action: 'notFound' };

/** Paths that exist only on the Studio host. `/api/retail` is what Buzzify Retail calls (signed, server to server). */
const STUDIO_ONLY = ['/studio', '/pos', '/pharmacy', '/api/auth', '/api/studio', '/api/pos', '/api/pharmacy', '/api/dev-intake', '/api/retail'];
/** What the Studio host serves besides `/`. */
const STUDIO_SERVES = [...STUDIO_ONLY, '/_next'];
/** What belongs to the pharmacy host once it is set (sign-in is `/api/auth`, shared by every product host). */
const PHARMACY_ONLY = ['/pharmacy', '/api/pharmacy', '/api/dev-intake'];
// Signing in, the sign-in's second step, resetting a password, accepting an invitation and the account page live under
// `/studio` and are shared by every product; the pharmacy host serves them so a signed-out pharmacist can get in.
const SHARED_ACCOUNT_PAGES = ['/studio/sign-in', '/studio/forgot', '/studio/reset', '/studio/invite', '/studio/setup-two-factor', '/studio/two-factor', '/studio/account'];
const PHARMACY_SERVES = [...PHARMACY_ONLY, ...SHARED_ACCOUNT_PAGES, '/api/auth', '/_next'];
/** Pages only the super admin has; once the core host is set the Studio host no longer serves them. */
const CORE_ONLY = ['/studio/restaurants', '/studio/team'];
const CORE_SERVES = ['/studio', '/api/auth', '/api/studio', '/_next'];

/** Whether `pathname` is `prefix` or inside it: `/studio` and `/studio/x`, not `/studios`. */
function within(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/**
 * The path as the app router will see it: percent-escapes decoded (`/%73tudio` is `/studio`) and repeated slashes
 * collapsed, so a prefix rule cannot be stepped around. `null` for a malformed escape, which is answered with a 404.
 * Reserved characters stay escaped (`%2F` is not a slash).
 */
function canonicalPath(pathname: string): string | null {
  try {
    return decodeURI(pathname).replace(/\/{2,}/g, '/');
  } catch {
    return null;
  }
}

function normalizeHost(host: string): string {
  return host.trim().toLowerCase().replace(/\.$/, '');
}

/**
 * Whether the request's host is the configured one. A configured name without a port matches the request's host
 * with any port, so `menu.buzzify.me` also matches `menu.buzzify.me:443`; a configured port must match exactly.
 */
function isHost(requestHost: string, configured: string | null): boolean {
  if (!configured) return false;
  const wanted = normalizeHost(configured);
  const actual = normalizeHost(requestHost.replace(/\.(?=:\d+$)/, ''));
  if (actual === wanted) return true;
  return !wanted.includes(':') && actual.replace(/:\d+$/, '') === wanted;
}

type Req = { host: string; pathname: string; search?: string; /** The request carries a valid gate cookie. */ coreGate?: boolean };

/** The request, its path as the app router will see it, and the configuration: what each host's rule needs. */
interface Ctx {
  req: Req;
  path: string;
  cfg: HostConfig;
}

/** A host's rule: `null` when the request is not for that host, otherwise what to do with it. */
type Rule = (ctx: Ctx) => HostDecision | null;

/** Whether the path is the favicon or inside one of the prefixes. */
function serves(path: string, prefixes: string[]): boolean {
  return path === '/favicon.ico' || prefixes.some((prefix) => within(path, prefix));
}

const redirect = (to: string): HostDecision => ({ action: 'redirect', to });

/** `https://host/path?query` on another host, keeping what the visitor asked for. */
const sameRequestOn = (host: string, req: Req): string => `https://${normalizeHost(host)}${req.pathname}${req.search ?? ''}`;

/** The main domain and its `www.` only send visitors to the company site. */
const apexRule: Rule = ({ req, cfg }) =>
  cfg.apexHost && (isHost(req.host, cfg.apexHost) || isHost(req.host, `www.${cfg.apexHost}`)) ? redirect(cfg.rootRedirect) : null;

/** Old hosts only redirect: `studio.*` to the Studio host, any other to the menu host. */
const legacyRule: Rule = ({ req, path, cfg }) => {
  const legacy = (cfg.legacyHosts ?? []).find((host) => isHost(req.host, host));
  if (!legacy) return null;
  const isStudio = normalizeHost(legacy).startsWith('studio.');
  // The old menu host's `/` always went to the company page.
  if (!isStudio && path === '/') return redirect(cfg.rootRedirect);
  const target = isStudio ? cfg.studioHost : cfg.publicHost;
  return target ? redirect(sameRequestOn(target, req)) : NOT_FOUND;
};

const pharmacyRule: Rule = ({ req, path, cfg }) => {
  if (!isHost(req.host, cfg.pharmacyHost ?? null)) return null;
  if (path === '/') return redirect('/pharmacy');
  return serves(path, PHARMACY_SERVES) ? NEXT : NOT_FOUND;
};

/** The super admin host: nothing answers until the secret path has been opened. */
const coreRule: Rule = ({ req, path, cfg }) => {
  if (!isHost(req.host, cfg.coreHost ?? null)) return null;
  const gate = cfg.coreGatePath?.replace(/^\/+|\/+$/g, '');
  if (gate) {
    if (path.replace(/\/+$/, '') === `/${gate}`) return { action: 'knock', to: '/studio' };
    if (!req.coreGate) return NOT_FOUND;
  }
  if (path === '/') return redirect('/studio');
  return serves(path, CORE_SERVES) ? NEXT : NOT_FOUND;
};

const studioRule: Rule = ({ req, path, cfg }) => {
  if (!isHost(req.host, cfg.studioHost)) return null;
  if (path === '/') return redirect('/studio');
  // Once a product has its own host, the Studio host stops serving it.
  if (cfg.pharmacyHost && PHARMACY_ONLY.some((prefix) => within(path, prefix))) return NOT_FOUND;
  if (cfg.coreHost && CORE_ONLY.some((prefix) => within(path, prefix))) return NOT_FOUND;
  return serves(path, STUDIO_SERVES) ? NEXT : NOT_FOUND;
};

const publicRule: Rule = ({ req, path, cfg }) => {
  if (!isHost(req.host, cfg.publicHost)) return null;
  if (STUDIO_ONLY.some((prefix) => within(path, prefix))) return NOT_FOUND;
  return path === '/' ? redirect(cfg.rootRedirect) : NEXT;
};

/** People type `www.` in front of the menus' address; send them to the address itself. */
const wwwRule: Rule = ({ req, cfg }) =>
  cfg.publicHost && !cfg.publicHost.includes(':') && isHost(req.host, `www.${cfg.publicHost}`) ? redirect(sameRequestOn(cfg.publicHost, req)) : null;

/** The first rule that knows the host decides. The order matters: the product hosts come before the shared Studio host. */
const RULES: Rule[] = [apexRule, legacyRule, pharmacyRule, coreRule, studioRule, publicRule, wwwRule];

/**
 * Which host a request belongs to, and what to do with the path. One deployment serves them all: the Studio keeps its
 * `/studio` prefix everywhere, and public menus live at `/{slug}/...`. Each host's rule is a small function above.
 *
 * Any other host depends on where this runs. In production with both hosts configured it answers 404: the configured
 * hosts are the only origins, and another name for the same deployment (its `.vercel.app` address, say) would be a
 * second Studio origin beside the menus. In development and previews the hosts are not both set, and every other host
 * serves everything. Pure, so the proxy that applies it needs no database and no network.
 */
export function routeHost(req: Req, cfg: HostConfig): HostDecision {
  const path = canonicalPath(req.pathname);
  if (path === null) return NOT_FOUND;

  // The platform's scheduler calls these on whatever host the deployment has; each checks its own secret.
  if (within(path, '/api/cron')) return NEXT;

  const ctx: Ctx = { req, path, cfg };
  for (const rule of RULES) {
    const decision = rule(ctx);
    if (decision) return decision;
  }

  if (cfg.production && cfg.publicHost && cfg.studioHost) return NOT_FOUND;
  return path === '/' ? redirect('/studio') : NEXT;
}
