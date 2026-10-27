import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { AiInputTooLargeError, AiLinkError } from './errors';
import { SUPPLY_FILE_MAX_BYTES, SUPPLY_MEDIA_TYPES } from './supply-limits';

/**
 * Reads another menu from a link, for the AI menu import. The server opens the address, so the address is checked before
 * every request (and again after every redirect): http or https only, no credentials, and only public addresses, never
 * a private, loopback, link-local or metadata one. What comes back is capped in size and time. Everything read here is
 * untrusted data for the model, never instructions.
 */

export const LINK_PAGE_MAX_BYTES = 2 * 1024 * 1024;
export const LINK_TIMEOUT_MS = 10_000;
export const LINK_PAGE_MAX_CHARS = 60_000;
export const LINK_MAX_IMAGES = 80;
const MAX_REDIRECTS = 3;

export interface LinkDeps {
  lookup: (host: string) => Promise<string[]>;
  fetch: typeof fetch;
}

export const realLinkDeps: LinkDeps = {
  lookup: async (host) => (await lookup(host, { all: true })).map((entry) => entry.address),
  fetch: (input, init) => fetch(input, init),
};

let current = realLinkDeps;

/** The network the link reads use; a test can stand in for it. */
export const linkDeps = (): LinkDeps => current;
export function setLinkDepsForTests(deps: LinkDeps | undefined): void {
  current = deps ?? realLinkDeps;
}

export interface LinkImage {
  url: string;
  alt: string;
}

export type LinkContent =
  | { kind: 'page'; text: string; images: LinkImage[] }
  | { kind: 'file'; mediaType: (typeof SUPPLY_MEDIA_TYPES)[number]; base64: string };

function isPrivateIpv4(address: string): boolean {
  const [a, b] = address.split('.').map(Number) as [number, number];
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
}

/** Whether an address is one a server must not call: private, loopback, link-local, multicast or the cloud metadata one. */
export function isPrivateAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return isPrivateIpv4(address);
  if (version !== 6) return true;
  const lower = address.toLowerCase();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
  if (mapped) return isPrivateIpv4(mapped[1]!);
  return lower === '::' || lower === '::1' || /^f[cd]/.test(lower) || /^fe[89ab]/.test(lower) || lower.startsWith('ff');
}

/** The address to open, or throws: refuses anything but a public http(s) address. */
export async function checkLinkUrl(input: string, deps: Pick<LinkDeps, 'lookup'>): Promise<URL> {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new AiLinkError();
  }
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password) throw new AiLinkError();
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === '' || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal') || host.endsWith('.local')) throw new AiLinkError();
  let addresses: string[];
  try {
    addresses = isIP(host) ? [host] : await deps.lookup(host);
  } catch {
    throw new AiLinkError();
  }
  if (addresses.length === 0 || addresses.some(isPrivateAddress)) throw new AiLinkError();
  return url;
}

async function readCapped(response: Response, limit: number): Promise<Buffer> {
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      throw new AiInputTooLargeError();
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/** One address's response, following at most three redirects, each checked like the first address. */
export async function openLink(input: string, deps: LinkDeps, accept: string, limit: number): Promise<{ url: URL; type: string; bytes: Buffer }> {
  let current = input;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const url = await checkLinkUrl(current, deps);
    let response: Response;
    try {
      response = await deps.fetch(url, { redirect: 'manual', headers: { accept, 'user-agent': 'BuzzifyMenuImport/1.0' }, signal: AbortSignal.timeout(LINK_TIMEOUT_MS) });
    } catch {
      throw new AiLinkError();
    }
    if (response.status >= 300 && response.status < 400) {
      const next = response.headers.get('location');
      if (!next) throw new AiLinkError();
      current = new URL(next, url).toString();
      continue;
    }
    if (!response.ok) throw new AiLinkError();
    const declared = Number(response.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > limit) throw new AiInputTooLargeError();
    return { url, type: (response.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase(), bytes: await readCapped(response, limit) };
  }
  throw new AiLinkError();
}

// A page as text and pictures --------------------------------------------------------------------------------------------

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decode(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === '#') {
      const code = body[1]?.toLowerCase() === 'x' ? parseInt(body.slice(2), 16) : Number(body.slice(1));
      return Number.isInteger(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : ' ';
    }
    return ENTITIES[body.toLowerCase()] ?? whole;
  });
}

function attribute(tag: string, name: string): string | null {
  const match = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
  const value = match?.[1] ?? match?.[2] ?? match?.[3];
  return value === undefined ? null : decode(value).trim();
}

const SKIPPED_IMAGE = /(?:logo|icon|sprite|avatar|favicon|pixel|tracking|placeholder|banner)/i;

/** The page's visible text (with its JSON-LD, which often holds the menu's items and prices) and its candidate pictures. */
export function readPage(html: string, base: URL): { text: string; images: LinkImage[] } {
  const structured = [...html.matchAll(/<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)].map((match) => match[1]!.trim());

  const images: LinkImage[] = [];
  const seen = new Set<string>();
  const add = (source: string | null, alt: string) => {
    if (!source || source.startsWith('data:')) return;
    let url: URL;
    try {
      url = new URL(source, base);
    } catch {
      return;
    }
    if ((url.protocol !== 'https:' && url.protocol !== 'http:') || /\.svg(?:$|\?)/i.test(url.pathname) || SKIPPED_IMAGE.test(url.pathname) || seen.has(url.href)) return;
    seen.add(url.href);
    images.push({ url: url.href, alt: alt.slice(0, 120) });
  };
  for (const tag of html.match(/<img\b[^>]*>/gi) ?? []) {
    const srcset = attribute(tag, 'srcset')?.split(',').at(-1)?.trim().split(/\s+/)[0] ?? null;
    add(attribute(tag, 'data-src') ?? attribute(tag, 'src') ?? srcset, attribute(tag, 'alt') ?? '');
  }
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) if (attribute(tag, 'property') === 'og:image') add(attribute(tag, 'content'), '');

  const body = html
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<noscript[\s\S]*?<\/noscript>|<!--[\s\S]*?-->/gi, ' ')
    .replace(/<\/(?:p|div|li|tr|h[1-6]|section|article|ul|ol|table)>|<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  const text = [...decode(body).split('\n').map((line) => line.replace(/[ \t\f\v ]+/g, ' ').trim()).filter(Boolean), ...structured].join('\n');
  return { text: text.slice(0, LINK_PAGE_MAX_CHARS), images: images.slice(0, LINK_MAX_IMAGES) };
}

/** A link's content: a page as text and pictures, or a PDF or picture the link points straight at. */
export async function fetchLink(input: string, deps: LinkDeps = linkDeps()): Promise<LinkContent> {
  const { url, type, bytes } = await openLink(input, deps, 'text/html,application/xhtml+xml,application/pdf,image/*;q=0.8', Math.max(LINK_PAGE_MAX_BYTES, SUPPLY_FILE_MAX_BYTES));
  const media = SUPPLY_MEDIA_TYPES.find((candidate) => candidate === type);
  if (media) {
    if (bytes.byteLength > SUPPLY_FILE_MAX_BYTES) throw new AiInputTooLargeError();
    return { kind: 'file', mediaType: media, base64: bytes.toString('base64') };
  }
  if (type !== 'text/html' && type !== 'application/xhtml+xml' && type !== '') throw new AiLinkError();
  if (bytes.byteLength > LINK_PAGE_MAX_BYTES) throw new AiInputTooLargeError();
  return { kind: 'page', ...readPage(bytes.toString('utf8'), url) };
}
