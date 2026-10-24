import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/** The link's shared secret: 32 random bytes as `bzl_` + base64url, shown once and kept encrypted at rest (contract 3.1). */
export function newLinkSecret(): string {
  return `bzl_${randomBytes(32).toString('base64url')}`;
}

/** `LINK_ENCRYPTION_KEY`: base64 of exactly 32 bytes, or null when unset or malformed (linking is then off). */
export function parseEncryptionKey(value: string | undefined): Buffer | null {
  const text = value?.trim();
  if (!text) return null;
  const key = Buffer.from(text, 'base64');
  return key.length === 32 ? key : null;
}

/** AES-256-GCM: `base64url(iv(12) | tag(16) | ciphertext)`. A fresh iv each time, so one secret never encrypts alike. */
export function encryptSecret(secret: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url');
}

/** Throws on a wrong key or any change to the stored value. */
export function decryptSecret(stored: string, key: Buffer): string {
  const raw = Buffer.from(stored, 'base64url');
  if (raw.length < 29) throw new Error('The stored link secret is malformed');
  const decipher = createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
}
