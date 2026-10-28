import { createHmac } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { authEnv, intakeStorageEnv, type IntakeStorageEnv } from '@/server/env';
import { r2Storage } from '@/server/storage/r2';

/**
 * Private storage of supplier invoices (R5-4). Invoices carry supplier prices and pharmacy business data, so they live in
 * their OWN private bucket: never the public media bucket, and a file is only ever reached through a signed URL of a few
 * minutes that is minted per request and never stored. Keys are made here from ids (`intake/<restaurantId>/<fileId>`),
 * never from a name the user sent.
 */

export interface IntakeStorage {
  put(key: string, bytes: Uint8Array, mediaType: string): Promise<void>;
  /** The stored bytes, or null when there is none. */
  get(key: string): Promise<{ bytes: Uint8Array; mediaType: string } | null>;
  /** A URL that downloads the file until `ttlSeconds` pass; 1..300. */
  signedUrl(key: string, ttlSeconds: number): Promise<string>;
  /** Removes the object; a key with no object is fine. */
  delete(key: string): Promise<void>;
}

/** The longest a signed URL may live. */
export const MAX_SIGNED_URL_SECONDS = 300;

/** The largest object read back (the upload limit). */
const MAX_OBJECT_BYTES = 8 * 1024 * 1024;

export class IntakeStorageNotConfiguredError extends Error {
  readonly code = 'INTAKE_STORAGE_NOT_CONFIGURED';
  constructor() {
    super('Invoice storage is not configured');
    this.name = 'IntakeStorageNotConfiguredError';
  }
}

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const KEY = /^intake\/[A-Za-z0-9_-]{1,64}\/[A-Za-z0-9_-]{1,64}$/;

/** `intake/<restaurantId>/<fileId>`: built from ids only. */
export function intakeKey(restaurantId: string, fileId: string): string {
  if (!ID.test(restaurantId) || !ID.test(fileId)) throw new Error('An intake storage key is made from plain ids');
  return `intake/${restaurantId}/${fileId}`;
}

function assertKey(key: string): void {
  if (!KEY.test(key)) throw new Error('Not an intake storage key');
}

function assertTtl(ttlSeconds: number): void {
  if (!Number.isFinite(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > MAX_SIGNED_URL_SECONDS) {
    throw new RangeError(`A signed URL lives 1 to ${MAX_SIGNED_URL_SECONDS} seconds`);
  }
}

// Development and tests ----------------------------------------------------------------------------------------------

/** The folder development keeps invoices in: outside the repository tree. */
export const DEV_INTAKE_DIR = join(tmpdir(), 'buzzify-intake');

/**
 * Files in a folder under the system temp directory. Refused in production, where a missing bucket must switch upload off
 * instead of writing to a local disk. Its signed URLs are HMAC-signed paths (`/api/dev-intake/<key>?expires=&sig=`).
 */
export function fsIntakeStorage(options: { dir?: string; secret?: string; now?: () => number } = {}): IntakeStorage {
  if (process.env.NODE_ENV === 'production') throw new IntakeStorageNotConfiguredError();
  const root = resolve(options.dir ?? DEV_INTAKE_DIR);
  const now = options.now ?? Date.now;
  const pathOf = (key: string) => {
    assertKey(key);
    const full = resolve(root, ...key.split('/'));
    if (!full.startsWith(root + sep)) throw new Error('Not an intake storage key');
    return full;
  };
  return {
    async put(key, bytes, mediaType) {
      const path = pathOf(key);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, bytes);
      await writeFile(`${path}.type`, mediaType);
    },
    async get(key) {
      const path = pathOf(key);
      try {
        const [bytes, mediaType] = await Promise.all([readFile(path), readFile(`${path}.type`, 'utf8')]);
        return { bytes: new Uint8Array(bytes), mediaType };
      } catch (error) {
        if ((error as { code?: unknown }).code === 'ENOENT') return null;
        throw error;
      }
    },
    async signedUrl(key, ttlSeconds) {
      assertKey(key);
      assertTtl(ttlSeconds);
      const expires = now() + ttlSeconds * 1000;
      const sig = createHmac('sha256', options.secret ?? authEnv().secret).update(`GET\n${key}\n${expires}`).digest('hex');
      return `/api/dev-intake/${key}?expires=${expires}&sig=${sig}`;
    },
    async delete(key) {
      const path = pathOf(key);
      await Promise.all([rm(path, { force: true }), rm(`${path}.type`, { force: true })]);
    },
  };
}

// Production -----------------------------------------------------------------------------------------------------------

/** The private R2 bucket, through the same S3 adapter the media bucket uses (its public address is never used). */
export function r2IntakeStorage(config: IntakeStorageEnv, client?: { send(command: unknown): Promise<unknown> }): IntakeStorage {
  const r2 = r2Storage({ ...config, publicUrl: '' }, client);
  return {
    async put(key, bytes, mediaType) {
      assertKey(key);
      await r2.put(key, bytes, { contentType: mediaType, cacheControl: 'private, no-store' });
    },
    async get(key) {
      assertKey(key);
      const found = await r2.get(key, MAX_OBJECT_BYTES);
      return found ? { bytes: found.bytes, mediaType: found.contentType } : null;
    },
    async signedUrl(key, ttlSeconds) {
      assertKey(key);
      assertTtl(ttlSeconds);
      return r2.presignGet(key, { fileName: 'invoice', expiresInSec: ttlSeconds });
    },
    async delete(key) {
      assertKey(key);
      await r2.delete([key]);
    },
  };
}

// Which one -------------------------------------------------------------------------------------------------------------

/**
 * The private R2 bucket when configured; the temp folder outside production; otherwise
 * `IntakeStorageNotConfiguredError` (production without the bucket never falls back to anything else).
 */
export function resolveIntakeStorage(env: IntakeStorageEnv | null, nodeEnv: string | undefined = process.env.NODE_ENV): IntakeStorage {
  if (env) return r2IntakeStorage(env);
  if (nodeEnv === 'production') throw new IntakeStorageNotConfiguredError();
  return fsIntakeStorage();
}

const globalForIntake = globalThis as unknown as { __buzzifyIntakeStorage?: IntakeStorage; __buzzifyIntakeStorageOverride?: IntakeStorage | null };

/** The storage this process uses, made on first use and kept. */
export function getIntakeStorage(): IntakeStorage {
  if (globalForIntake.__buzzifyIntakeStorageOverride) return globalForIntake.__buzzifyIntakeStorageOverride;
  return (globalForIntake.__buzzifyIntakeStorage ??= resolveIntakeStorage(intakeStorageEnv()));
}

/** Test seam: uses `adapter` from now on, and returns the function that puts the previous one back. Not for application code. */
export function withIntakeStorage(adapter: IntakeStorage): () => void {
  const previous = globalForIntake.__buzzifyIntakeStorageOverride ?? null;
  globalForIntake.__buzzifyIntakeStorageOverride = adapter;
  return () => {
    globalForIntake.__buzzifyIntakeStorageOverride = previous;
  };
}
