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
  /** The main domain (`buzzify.tech`): it and its `www.` send every path to `rootRedirect`. */
  apexHost?: string | null;
  /**
   * Old hosts that only redirect. A name starting with `studio.` goes to `studioHost`, any other to `publicHost`,
   * keeping path and query. The scheduler's `/api/cron` routes still answer on them.
   */
  legacyHosts?: string[];
}

export type HostDecision = { action: 'next' } | { action: 'redirect'; to: string } | { action: 'notFound' };

const NEXT: HostDecision = { action: 'next' };
const NOT_FOUND: HostDecision = { action: 'notFound' };

/** Paths that exist only on the Studio host. `/api/retail` is what Buzzify Retail calls (signed, server to server). */
const STUDIO_ONLY = ['/studio', '/pos', '/pharmacy', '/api/auth', '/api/studio', '/api/pos', '/api/pharmacy', '/api/dev-intake', '/api/retail'];
/** What the Studio host serves besides `/`. */
const STUDIO_SERVES = [...STUDIO_ONLY, '/_next'];
/** What belongs to the pharmacy host once it is set (sign-in is `/api/auth`, shared by every product host). */
const PHARMACY_ONLY = ['/pharmacy', '/api/pharmacy', '/api/dev-intake'];
const PHARMACY_SERVES = [...PHARMACY_ONLY, '/api/auth', '/_next'];
/** Pages only the super admin has; once the core host is set the Studio host no longer serves them. */
const CORE_ONLY = ['/studio/restaurants', '/studio/team'];
const CORE_SERVES = ['/studio', '/api/auth', '/api/studio', '/_next'];

/** Whether `pathname` is `prefix` or inside it: `/studio` and `/studio/x`, not `/studios`. */
function within(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
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

/**
 * Which of the two hosts a request belongs to, and what to do with the path. One deployment serves both: the Studio
 * keeps its `/studio` prefix everywhere, and public menus live at `/{slug}/...`.
 *
 * Any other host depends on where this runs. In production with both hosts configured it answers 404: the two hosts
 * are the only origins, and another name for the same deployment (its `.vercel.app` address, say) would be a second
 * Studio origin beside the menus. In development and previews the hosts are not both set, and every other host serves
 * everything. Pure, so the proxy that applies it needs no database and no network.
 */
export function routeHost(req: { host: string; pathname: string; search?: string }, cfg: HostConfig): HostDecision {
  const { pathname } = req;

  // The platform's scheduler calls these on whatever host the deployment has; each checks its own secret.
  if (within(pathname, '/api/cron')) return NEXT;

  if (cfg.apexHost && (isHost(req.host, cfg.apexHost) || isHost(req.host, `www.${cfg.apexHost}`))) {
    return { action: 'redirect', to: cfg.rootRedirect };
  }

  const legacy = (cfg.legacyHosts ?? []).find((host) => isHost(req.host, host));
  if (legacy) {
    const target = normalizeHost(legacy).startsWith('studio.') ? cfg.studioHost : cfg.publicHost;
    if (target) return { action: 'redirect', to: `https://${normalizeHost(target)}${pathname}${req.search ?? ''}` };
    return NOT_FOUND;
  }

  if (isHost(req.host, cfg.pharmacyHost ?? null)) {
    if (pathname === '/') return { action: 'redirect', to: '/pharmacy' };
    if (pathname === '/favicon.ico' || PHARMACY_SERVES.some((prefix) => within(pathname, prefix))) return NEXT;
    return NOT_FOUND;
  }

  if (isHost(req.host, cfg.coreHost ?? null)) {
    if (pathname === '/') return { action: 'redirect', to: '/studio' };
    if (pathname === '/favicon.ico' || CORE_SERVES.some((prefix) => within(pathname, prefix))) return NEXT;
    return NOT_FOUND;
  }

  if (isHost(req.host, cfg.studioHost)) {
    if (pathname === '/') return { action: 'redirect', to: '/studio' };
    // Once a product has its own host, the Studio host stops serving it.
    if (cfg.pharmacyHost && PHARMACY_ONLY.some((prefix) => within(pathname, prefix))) return NOT_FOUND;
    if (cfg.coreHost && CORE_ONLY.some((prefix) => within(pathname, prefix))) return NOT_FOUND;
    if (pathname === '/favicon.ico' || STUDIO_SERVES.some((prefix) => within(pathname, prefix))) return NEXT;
    return NOT_FOUND;
  }

  if (isHost(req.host, cfg.publicHost)) {
    if (STUDIO_ONLY.some((prefix) => within(pathname, prefix))) return NOT_FOUND;
    if (pathname === '/') return { action: 'redirect', to: cfg.rootRedirect };
    return NEXT;
  }

  // People type `www.` in front of the menus' address; send them to the address itself, keeping what they asked for.
  if (cfg.publicHost && !cfg.publicHost.includes(':') && isHost(req.host, `www.${cfg.publicHost}`)) {
    return { action: 'redirect', to: `https://${normalizeHost(cfg.publicHost)}${pathname}${req.search ?? ''}` };
  }

  if (cfg.production && cfg.publicHost && cfg.studioHost) return NOT_FOUND;
  if (pathname === '/') return { action: 'redirect', to: '/studio' };
  return NEXT;
}
