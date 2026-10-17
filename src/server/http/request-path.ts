/**
 * The request header `src/proxy.ts` sets to the path the visitor asked for. A page gets its route's params, but the
 * 404 page gets none; it reads the path from here to link back to the right menu (`backToMenuHref`). The proxy always
 * overwrites it, so a value sent by a browser is never read on a path the proxy handles; on the few it skips (paths
 * with a dot) it may be absent or forged, so it is only ever parsed into a slug and a language, never echoed.
 */
export const REQUEST_PATH_HEADER = 'x-buzzify-path';
