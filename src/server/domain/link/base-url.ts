import { isIP } from 'node:net';

/**
 * The cashier address a pairing request names, checked before the Menu ever calls it (contract 5.6, the SSRF guard):
 * an origin only (no path, query or credentials), https, and not a private, link-local, loopback or metadata address.
 * Development allows http on loopback names.
 */
export type BaseUrlVerdict = { ok: true; url: string } | { ok: false };

const REFUSED: BaseUrlVerdict = { ok: false };

function isLoopbackName(host: string): boolean {
  return host === 'localhost' || host.endsWith('.localhost') || host === '127.0.0.1' || host === '[::1]';
}

function isPrivateIpv4(host: string): boolean {
  const [a, b] = host.split('.').map(Number) as [number, number];
  return (
    a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224
  );
}

const METADATA_NAMES = ['metadata.google.internal', 'metadata', 'instance-data'];

export function checkCashierBaseUrl(input: string, options: { production: boolean }): BaseUrlVerdict {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return REFUSED;
  }
  if (url.username || url.password || url.search || url.hash) return REFUSED;
  if (url.pathname !== '/' && url.pathname !== '') return REFUSED;
  const host = url.hostname.toLowerCase();
  const loopback = isLoopbackName(host);

  if (url.protocol === 'http:') {
    if (options.production || !loopback) return REFUSED;
    return { ok: true, url: url.origin };
  }
  if (url.protocol !== 'https:') return REFUSED;
  if (options.production) {
    if (loopback || METADATA_NAMES.includes(host) || host.endsWith('.internal') || host.endsWith('.local')) return REFUSED;
    // IPv6 literals are not accepted as cashier addresses.
    if (host.startsWith('[')) return REFUSED;
    if (isIP(host) === 4 && isPrivateIpv4(host)) return REFUSED;
  }
  return { ok: true, url: url.origin };
}
