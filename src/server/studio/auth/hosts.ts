import type { AuthEnv } from '@/server/env';

const LOCAL_ORIGINS = ['http://localhost:3100', 'http://127.0.0.1:3100'];

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
