export interface HostConfig {
  /** The host that serves public menus (`menu.buzzify.me`), or null when none is configured. */
  publicHost: string | null;
  /** The host that serves the Studio (`studio.buzzify.me`), or null when none is configured. */
  studioHost: string | null;
  /** Where `/` on the public host goes: the company site. */
  rootRedirect: string;
  /** Whether this is a production deployment (`NODE_ENV` is `production`). */
  production: boolean;
}

export type HostDecision = { action: 'next' } | { action: 'redirect'; to: string } | { action: 'notFound' };

const NEXT: HostDecision = { action: 'next' };
const NOT_FOUND: HostDecision = { action: 'notFound' };

/** Paths that exist only on the Studio host. */
const STUDIO_ONLY = ['/studio', '/api/auth', '/api/studio'];
/** What the Studio host serves besides `/`. */
const STUDIO_SERVES = [...STUDIO_ONLY, '/_next'];

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
export function routeHost(req: { host: string; pathname: string }, cfg: HostConfig): HostDecision {
  const { pathname } = req;

  // The platform's scheduler calls these on whatever host the deployment has; each checks its own secret.
  if (within(pathname, '/api/cron')) return NEXT;

  if (isHost(req.host, cfg.studioHost)) {
    if (pathname === '/') return { action: 'redirect', to: '/studio' };
    if (pathname === '/favicon.ico' || STUDIO_SERVES.some((prefix) => within(pathname, prefix))) return NEXT;
    return NOT_FOUND;
  }

  if (isHost(req.host, cfg.publicHost)) {
    if (STUDIO_ONLY.some((prefix) => within(pathname, prefix))) return NOT_FOUND;
    if (pathname === '/') return { action: 'redirect', to: cfg.rootRedirect };
    return NEXT;
  }

  if (cfg.production && cfg.publicHost && cfg.studioHost) return NOT_FOUND;
  if (pathname === '/') return { action: 'redirect', to: '/studio' };
  return NEXT;
}
