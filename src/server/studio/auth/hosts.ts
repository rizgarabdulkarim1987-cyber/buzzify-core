import type { AuthEnv } from '@/server/env';

const LOCAL_ORIGINS = ['http://localhost:3100', 'http://127.0.0.1:3100'];

/**
 * An emailed link moved onto the Studio host, keeping path and query. Better Auth builds links from the host a request
 * came in on; one made on the super admin host would put that hidden name in an inbox and answer 404 without the gate
 * cookie, and the pharmacy host does not serve the Studio pages a callback may name.
 */
export function onStudioHost(link: string, baseUrl: string): string {
  if (!URL.canParse(link)) return link;
  const url = new URL(link);
  return `${baseUrl}${url.pathname}${url.search}${url.hash}`;
}

/**
 * Where Better Auth answers. The Studio host is the base URL; the pharmacy and super admin hosts are further hosts it
 * may answer on, each with its own host-only cookie. While no further host is set the base URL stays a plain string,
 * exactly as before. Emailed links stay on the Studio host (the reset page lives under `/studio`).
 */
export function authHostOptions(config: Pick<AuthEnv, 'baseUrl' | 'production' | 'extraHosts'>) {
  const extra = config.extraHosts ?? [];
  const baseURL =
    config.production && extra.length > 0
      ? { allowedHosts: [new URL(config.baseUrl).host, ...extra], fallback: config.baseUrl, protocol: 'https' as const }
      : config.baseUrl;
  const trustedOrigins = [config.baseUrl, ...extra.map((host) => `https://${host}`), ...(config.production ? [] : LOCAL_ORIGINS)];
  return { baseURL, trustedOrigins };
}
