import { toNextJsHandler } from 'better-auth/next-js';
import { getAuth } from '@/server/studio/auth/auth';

/**
 * Better Auth's HTTP endpoints (sign-in, sign-out, reset and e-mail verification links, two-factor). The instance is
 * built when the first request arrives, not when the file is loaded, so building the application reads no sign-in
 * configuration. Only the Studio host serves this path (see `routeHost`).
 */
export const dynamic = 'force-dynamic';

export const { GET, POST } = toNextJsHandler((request) => getAuth().handler(request));
