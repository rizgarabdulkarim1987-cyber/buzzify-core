import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { checkCashierBaseUrl } from '@/server/domain/link/base-url';
import {
  decodeLinkCode,
  displayCode,
  encodeLinkCode,
  hashPairingCode,
  newPairingCode,
  normalizePairingCode,
} from '@/server/domain/link/pairing-code';
import { decryptSecret, encryptSecret, newLinkSecret, parseEncryptionKey } from '@/server/domain/link/secret';

const KEY = randomBytes(32);

describe('link secret', () => {
  it('has the bzl_ prefix and 32 random bytes', () => {
    const a = newLinkSecret();
    expect(a).toMatch(/^bzl_[A-Za-z0-9_-]{43}$/);
    expect(newLinkSecret()).not.toBe(a);
  });

  it('round-trips and never stores the plaintext (T12 shape)', () => {
    const secret = newLinkSecret();
    const stored = encryptSecret(secret, KEY);
    expect(stored).not.toContain(secret);
    expect(decryptSecret(stored, KEY)).toBe(secret);
    expect(encryptSecret(secret, KEY)).not.toBe(stored);
  });

  it('refuses a wrong key and a tampered value', () => {
    const stored = encryptSecret('bzl_x', KEY);
    expect(() => decryptSecret(stored, randomBytes(32))).toThrow();
    const raw = Buffer.from(stored, 'base64url');
    raw[raw.length - 1] ^= 1;
    expect(() => decryptSecret(raw.toString('base64url'), KEY)).toThrow();
  });

  it('accepts only a 32-byte base64 key', () => {
    expect(parseEncryptionKey(KEY.toString('base64'))?.length).toBe(32);
    expect(parseEncryptionKey(undefined)).toBeNull();
    expect(parseEncryptionKey('')).toBeNull();
    expect(parseEncryptionKey(randomBytes(16).toString('base64'))).toBeNull();
  });
});

describe('pairing code', () => {
  it('is 10 characters of the contract alphabet', () => {
    for (let i = 0; i < 50; i += 1) expect(newPairingCode()).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{10}$/);
  });

  it('shows as ABCDE-FGHJK and normalizes back', () => {
    expect(displayCode('ABCDEFGHJK')).toBe('ABCDE-FGHJK');
    expect(normalizePairingCode('abcde-fghjk')).toBe('ABCDEFGHJK');
    expect(normalizePairingCode('too short')).toBeNull();
    expect(normalizePairingCode('ABCDEFGHJ0')).toBeNull();
  });

  it('hashes with SHA-256 hex', () => {
    expect(hashPairingCode('ABCDEFGHJK')).toMatch(/^[0-9a-f]{64}$/);
    expect(hashPairingCode('ABCDEFGHJK')).toBe(hashPairingCode('ABCDEFGHJK'));
  });

  it('link code round-trips and rejects junk', () => {
    const code = encodeLinkCode('https://menu.buzzify.me', 'ABCDEFGHJK');
    expect(code.startsWith('bzl1.')).toBe(true);
    expect(decodeLinkCode(code)).toEqual({ o: 'https://menu.buzzify.me', c: 'ABCDEFGHJK' });
    expect(decodeLinkCode('bzl1.!!!')).toBeNull();
    expect(decodeLinkCode('other.abc')).toBeNull();
  });
});

describe('cashier base URL guard (T8)', () => {
  const prod = { production: true };
  const dev = { production: false };

  it('accepts a public https origin', () => {
    expect(checkCashierBaseUrl('https://cashier.buzzify.me', prod)).toEqual({ ok: true, url: 'https://cashier.buzzify.me' });
  });

  it.each([
    'http://cashier.buzzify.me',
    'http://169.254.169.254',
    'https://169.254.169.254',
    'https://10.0.0.5',
    'https://192.168.1.4',
    'https://172.16.0.1',
    'https://127.0.0.1',
    'https://localhost',
    'https://[::1]',
    'https://user:pw@host.example',
    'https://host.example/path',
    'https://host.example/?q=1',
    'ftp://host.example',
    'not a url',
    'https://metadata.google.internal',
  ])('refuses %s in production', (url) => {
    expect(checkCashierBaseUrl(url, prod)).toEqual({ ok: false });
  });

  it('allows loopback over http in development only', () => {
    expect(checkCashierBaseUrl('http://127.0.0.1:3200', dev)).toEqual({ ok: true, url: 'http://127.0.0.1:3200' });
    expect(checkCashierBaseUrl('http://localhost:3200', dev).ok).toBe(true);
    expect(checkCashierBaseUrl('http://shop.localhost:3200', dev).ok).toBe(true);
    expect(checkCashierBaseUrl('http://10.0.0.5', dev)).toEqual({ ok: false });
    expect(checkCashierBaseUrl('http://127.0.0.1:3200', prod)).toEqual({ ok: false });
  });
});
