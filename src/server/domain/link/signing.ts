import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Request signing for the Menu <-> Cashier link (contract 3.1). Pure: the secret, the clock and the request come in, a
 * verdict comes out. Both halves of the link sign and verify the same way.
 */

/** How far a request's timestamp may be from the receiver's clock, in seconds. */
export const MAX_SKEW_SECONDS = 300;

const LINK_ID = /^[A-Za-z0-9_-]{8,64}$/;
const TIMESTAMP = /^\d{1,12}$/;
const SIGNATURE = /^[0-9a-f]{64}$/;

export type LinkVerdict =
  | { ok: true; linkId: string }
  | { ok: false; status: 401; code: 'badSignature' | 'staleTimestamp' };

type Bytes = string | Uint8Array;

export function bodyHash(body: Bytes): string {
  return createHash('sha256').update(body).digest('hex');
}

export function canonicalRequest(method: string, pathWithQuery: string, timestamp: number | string, body: Bytes): string {
  return `${method.toUpperCase()}\n${pathWithQuery}\n${timestamp}\n${bodyHash(body)}`;
}

export function signRequest(secret: string, method: string, pathWithQuery: string, timestamp: number | string, body: Bytes): string {
  return createHmac('sha256', secret).update(canonicalRequest(method, pathWithQuery, timestamp, body)).digest('hex');
}

export interface VerifyInput {
  secret: string;
  /** The three `x-link-*` headers, lower-case names. */
  headers: Partial<Record<'x-link-id' | 'x-link-timestamp' | 'x-link-signature', string | null | undefined>>;
  method: string;
  /** Exactly the request target: the path and its query string. */
  pathWithQuery: string;
  /** The raw bytes, hashed before any parsing. */
  body: Bytes;
  /** The receiver's clock, in milliseconds. */
  now: number;
}

/** The headers' shape, checked first and without a secret: the id is what finds the secret. */
export function readLinkHeaders(headers: VerifyInput['headers']): { linkId: string; timestamp: string; signature: string } | null {
  const linkId = headers['x-link-id'];
  const timestamp = headers['x-link-timestamp'];
  const signature = headers['x-link-signature'];
  if (!linkId || !LINK_ID.test(linkId)) return null;
  if (!timestamp || !TIMESTAMP.test(timestamp)) return null;
  if (!signature || !SIGNATURE.test(signature)) return null;
  return { linkId, timestamp, signature };
}

/** Header shapes, then the clock, then the signature (constant-time). The caller handles unknown and revoked links. */
export function verifyRequest(input: VerifyInput): LinkVerdict {
  const parsed = readLinkHeaders(input.headers);
  if (!parsed) return { ok: false, status: 401, code: 'badSignature' };
  const skew = Math.abs(Math.floor(input.now / 1000) - Number(parsed.timestamp));
  if (skew > MAX_SKEW_SECONDS) return { ok: false, status: 401, code: 'staleTimestamp' };
  const expected = Buffer.from(signRequest(input.secret, input.method, input.pathWithQuery, parsed.timestamp, input.body), 'hex');
  const given = Buffer.from(parsed.signature, 'hex');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return { ok: false, status: 401, code: 'badSignature' };
  return { ok: true, linkId: parsed.linkId };
}
