import { createHmac } from 'node:crypto';

/**
 * Set-Cookie lines to a request `Cookie` header. Cookies accumulate in `jar` (pass the same map to keep a session
 * across calls); a cleared cookie (empty value or `Max-Age=0`) is dropped from it.
 */
export function cookieHeader(setCookies: string[], jar: Map<string, string> = new Map()): Headers {
  for (const line of setCookies) {
    const [pair = ''] = line.split(';');
    const i = pair.indexOf('=');
    const name = pair.slice(0, i).trim();
    const value = pair.slice(i + 1).trim();
    if (value === '' || /max-age=0/i.test(line)) jar.delete(name);
    else jar.set(name, value);
  }
  return new Headers({ cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') });
}

/** RFC 4648 base32 to bytes. */
function base32Decode(input: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const ch of input.replace(/=+$/, '').toUpperCase()) bits += alphabet.indexOf(ch).toString(2).padStart(5, '0');
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

/** The RFC 6238 code (SHA-1, 6 digits, 30 s) an authenticator app shows for an `otpauth://` URI. */
export function totpFromUri(uri: string, atMs = Date.now()): string {
  const secret = base32Decode(new URL(uri).searchParams.get('secret') as string);
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(atMs / 30_000)));
  const h = createHmac('sha1', secret).update(counter).digest();
  const o = (h[h.length - 1] as number) & 0xf;
  const code =
    ((((h[o] as number) & 0x7f) << 24) |
      ((h[o + 1] as number) << 16) |
      ((h[o + 2] as number) << 8) |
      (h[o + 3] as number)) %
    1_000_000;
  return String(code).padStart(6, '0');
}
