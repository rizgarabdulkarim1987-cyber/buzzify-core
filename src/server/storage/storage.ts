import { authEnv, storageEnv } from '@/server/env';
import { folderStorage } from './folder';
import { r2Storage } from './r2';

/**
 * Where media, sheets and downloads are kept: Cloudflare R2 in production, a folder in development (spec 11). Browsers
 * upload and download large files straight to and from it through short-lived signed URLs, because a Vercel function
 * accepts and returns at most 4.5 MB.
 */
export interface Storage {
  /** A URL the browser can PUT the file to until it expires, and the headers it must send with it. */
  presignPut(
    key: string,
    options: { contentType: string; contentLength: number; expiresInSec: number },
  ): Promise<{ url: string; headers: Record<string, string> }>;
  /** A URL that downloads a private file, saved under `fileName`, until it expires. */
  presignGet(key: string, options: { fileName: string; expiresInSec: number }): Promise<string>;
  head(key: string): Promise<{ bytes: number; contentType: string } | null>;
  /** The whole file, or null when there is none. Throws `StorageTooLargeError` past `maxBytes`, before reading it. */
  get(key: string, maxBytes: number): Promise<{ bytes: Uint8Array; contentType: string } | null>;
  put(key: string, body: Uint8Array, options: { contentType: string; cacheControl: string }): Promise<void>;
  /** Removes the files; keys with no file are fine. */
  delete(keys: readonly string[]): Promise<void>;
  /** Where guests' browsers load a public file from. */
  publicUrl(key: string): string;
}

export class StorageTooLargeError extends Error {
  constructor(key: string, maxBytes: number) {
    super(`${key} is larger than ${maxBytes} bytes`);
    this.name = 'StorageTooLargeError';
  }
}

/** The storage this process uses, made on first use from the environment and then kept. */
const globalForStorage = globalThis as unknown as { __buzzifyStorage?: { config: string; storage: Storage } };

export function getStorage(): Storage {
  const env = storageEnv();
  const config = JSON.stringify(env);
  const kept = globalForStorage.__buzzifyStorage;
  if (kept && kept.config === config) return kept.storage;
  const storage = env.kind === 'r2' ? r2Storage(env) : folderStorage(env.dir, env.publicUrl, authEnv().secret);
  globalForStorage.__buzzifyStorage = { config, storage };
  return storage;
}
