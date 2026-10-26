import { createHash, randomInt } from 'node:crypto';

/** No 0/O, 1/I/L: the codes are read aloud and typed by people. */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{10}$/;

export const PAIRING_CODE_MINUTES = 15;
/** Wrong attempts a code survives. */
export const PAIRING_MAX_ATTEMPTS = 5;

export function newPairingCode(): string {
  let code = '';
  for (let i = 0; i < 10; i += 1) code += ALPHABET[randomInt(ALPHABET.length)];
  return code;
}

export function displayCode(code: string): string {
  return `${code.slice(0, 5)}-${code.slice(5)}`;
}

/** What a person typed (any case, an optional dash or spaces), as the 10-character code, or null. */
export function normalizePairingCode(input: string): string | null {
  const code = input.replace(/[\s-]/g, '').toUpperCase();
  return CODE.test(code) ? code : null;
}

export function hashPairingCode(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

/** The text the Menu owner copies: `bzl1.` + base64url of `{ o: menu origin, c: code }`. */
export function encodeLinkCode(origin: string, code: string): string {
  return `bzl1.${Buffer.from(JSON.stringify({ o: origin, c: code })).toString('base64url')}`;
}

export function decodeLinkCode(text: string): { o: string; c: string } | null {
  if (!text.startsWith('bzl1.')) return null;
  try {
    const value: unknown = JSON.parse(Buffer.from(text.slice(5), 'base64url').toString('utf8'));
    if (typeof value !== 'object' || value === null) return null;
    const { o, c } = value as Record<string, unknown>;
    return typeof o === 'string' && typeof c === 'string' && CODE.test(c) ? { o, c } : null;
  } catch {
    return null;
  }
}
