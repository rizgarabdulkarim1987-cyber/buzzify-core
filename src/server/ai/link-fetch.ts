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
export const LINK_PAGE_MAX_CHARS = 100_000;
export const LINK_MAX_IMAGES = 250;
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
  /** `inlineImages`: the text already marks each picture where it belongs (`[picture 3: caption]`). */
  | { kind: 'page'; text: string; images: LinkImage[]; inlineImages: boolean }
  | { kind: 'file'; mediaType: (typeof SUPPLY_MEDIA_TYPES)[number]; base64: string };

function isPrivateIpv4(address: string): boolean {
  const [a, b, c] = address.split('.').map(Number) as [number, number, number];
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  );
}

/** An IPv6 address as its eight 16-bit groups, or null when it is not one. Handles `::` and a dotted IPv4 tail. */
function ipv6Groups(address: string): number[] | null {
  let text = address.toLowerCase();
  const dotted = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(text);
  if (dotted) {
    const octets = dotted.slice(1).map(Number);
    if (octets.some((octet) => octet > 255)) return null;
    text = `${text.slice(0, dotted.index)}${((octets[0]! << 8) | octets[1]!).toString(16)}:${((octets[2]! << 8) | octets[3]!).toString(16)}`;
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill('0'), ...tail].map((group) => Number.parseInt(group, 16));
  return groups.length === 8 && groups.every((group) => Number.isInteger(group) && group >= 0 && group <= 0xffff) ? groups : null;
}

const ipv4Of = (high: number, low: number) => `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;

/**
 * Whether an address is one a server must not call: private, loopback, link-local, multicast or the cloud metadata one.
 * An IPv6 address that carries an IPv4 one (mapped, compatible, NAT64, 6to4) is judged by the IPv4 address inside it,
 * in whatever spelling it arrives: `new URL` rewrites `[::ffff:127.0.0.1]` to `[::ffff:7f00:1]`.
 */
export function isPrivateAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return isPrivateIpv4(address);
  if (version !== 6) return true;
  const g = ipv6Groups(address);
  if (!g) return true;
  const [g0, g1, g2, g3, g4, g5, g6, g7] = g as [number, number, number, number, number, number, number, number];
  if (g.every((group) => group === 0) || (g.slice(0, 7).every((group) => group === 0) && g7 === 1)) return true;
  // ::ffff:a.b.c.d (mapped), ::ffff:0:a.b.c.d (translated), ::a.b.c.d (compatible) and 64:ff9b::a.b.c.d (NAT64).
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0xffff) return isPrivateIpv4(ipv4Of(g6, g7));
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0xffff && g5 === 0) return isPrivateIpv4(ipv4Of(g6, g7));
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) return isPrivateIpv4(ipv4Of(g6, g7));
  if (g0 === 0x64 && g1 === 0xff9b && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) return isPrivateIpv4(ipv4Of(g6, g7));
  // 6to4 (2002:aabb:ccdd::) embeds the IPv4 address in the next two groups.
  if (g0 === 0x2002) return isPrivateIpv4(ipv4Of(g1, g2));
  return (g0 & 0xfe00) === 0xfc00 || (g0 & 0xffc0) === 0xfe80 || (g0 & 0xff00) === 0xff00;
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
export async function openLink(
  input: string,
  deps: LinkDeps,
  accept: string,
  limit: number,
  extra: { headers?: Record<string, string>; timeoutMs?: number } = {},
): Promise<{ url: URL; type: string; bytes: Buffer }> {
  let current = input;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const url = await checkLinkUrl(current, deps);
    let response: Response;
    try {
      response = await deps.fetch(url, { redirect: 'manual', headers: { accept, 'user-agent': 'BuzzifyMenuImport/1.0', ...extra.headers }, signal: AbortSignal.timeout(extra.timeoutMs ?? LINK_TIMEOUT_MS) });
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
  const page = readPage(bytes.toString('utf8'), url);
  if (page.text.length >= MIN_PAGE_CHARS) return { kind: 'page', ...page, inlineImages: false };
  // A page that draws its menu with JavaScript has no text to read: a rendering service opens it in a browser and returns it as text.
  return (await renderPage(url, deps)) ?? { kind: 'page', ...page, inlineImages: false };
}

// A page drawn by JavaScript ------------------------------------------------------------------------------------------

/** Less visible text than this means the page is drawn by script. */
export const MIN_PAGE_CHARS = 40;
const RENDER_ENDPOINT = 'https://r.jina.ai/';
const RENDER_TIMEOUT_MS = 30_000;
const PICTURE = /!\[([^\]]*)\]\((https?:\/\/(?:[^()\s]|\([^()\s]*\))+)[^)]*\)/g;

/**
 * A page's text and pictures from its rendered form (markdown with `![caption](address)`). Each picture is replaced by
 * `[picture N: caption]` where it stood, so the reader knows which item it belongs to; logos, icons and stickers are dropped.
 */
export function readRendered(markdown: string): { text: string; images: LinkImage[] } {
  const images: LinkImage[] = [];
  const seen = new Map<string, number>();
  const text = markdown.replace(PICTURE, (_whole, alt: string, address: string) => {
    let url: URL;
    try {
      url = new URL(address);
    } catch {
      return '';
    }
    if (/\.svg(?:$|\?)/i.test(url.pathname) || SKIPPED_IMAGE.test(url.pathname) || /sticker/i.test(url.pathname)) return '';
    let index = seen.get(url.href);
    if (index === undefined) {
      if (images.length >= LINK_MAX_IMAGES) return '';
      index = images.length;
      seen.set(url.href, index);
      images.push({ url: url.href, alt: alt.replace(/^image \d+:\s*(?:image\s+)?/i, '').slice(0, 120) });
    }
    return `[picture ${index}: ${images[index]!.alt || 'no caption'}]`;
  });
  return { text: text.replace(/\n{3,}/g, '\n\n').slice(0, LINK_PAGE_MAX_CHARS), images };
}

/**
 * The page opened in a browser by a rendering service (Jina Reader; `LINK_RENDER_KEY` raises its limits, `LINK_RENDER=off`
 * turns this off). The service is sent only the address of a public page that has already passed the checks above.
 */
async function renderPage(url: URL, deps: LinkDeps): Promise<Extract<LinkContent, { kind: 'page' }> | null> {
  if (process.env.LINK_RENDER === 'off') return null;
  const key = process.env.LINK_RENDER_KEY;
  try {
    const { bytes } = await openLink(RENDER_ENDPOINT + url.href, deps, 'text/markdown', LINK_PAGE_MAX_BYTES, {
      timeoutMs: RENDER_TIMEOUT_MS,
      headers: key ? { authorization: `Bearer ${key}` } : {},
    });
    const page = readRendered(bytes.toString('utf8'));
    return page.text.length >= MIN_PAGE_CHARS ? { kind: 'page', ...page, inlineImages: true } : null;
  } catch {
    return null;
  }
}
