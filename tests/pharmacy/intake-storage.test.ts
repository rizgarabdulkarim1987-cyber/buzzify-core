import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseIntakeStorageEnv, checkProductionEnv } from '@/server/env';
import {
  DEV_INTAKE_DIR,
  fsIntakeStorage,
  getIntakeStorage,
  intakeKey,
  IntakeStorageNotConfiguredError,
  MAX_SIGNED_URL_SECONDS,
  r2IntakeStorage,
  resolveIntakeStorage,
  withIntakeStorage,
} from '@/server/pharmacy/intake/storage';
import { memoryIntakeStorage } from './intake-helpers';

const R2 = { PH_INTAKE_R2_ACCOUNT_ID: 'acc', PH_INTAKE_R2_ACCESS_KEY_ID: 'key', PH_INTAKE_R2_SECRET_ACCESS_KEY: 'secret', PH_INTAKE_R2_BUCKET: 'private-invoices' };

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('intake storage keys', () => {
  it('are intake/<restaurantId>/<fileId>, made from ids only', () => {
    expect(intakeKey('rest1', 'file1')).toBe('intake/rest1/file1');
    expect(() => intakeKey('../etc', 'file1')).toThrow();
    expect(() => intakeKey('rest1', 'a/b')).toThrow();
    expect(() => intakeKey('rest1', 'invoice final.pdf')).toThrow();
  });
});

describe('the development folder adapter', () => {
  it('lives under the system temp directory, outside the repository', () => {
    expect(DEV_INTAKE_DIR.startsWith(tmpdir())).toBe(true);
  });

  it('stores, reads back, signs and deletes by key', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ph-intake-test-'));
    try {
      const storage = fsIntakeStorage({ dir, secret: 'test-secret', now: () => 1_000_000 });
      const key = intakeKey('rest1', 'file1');
      expect(await storage.get(key)).toBeNull();
      await storage.put(key, Uint8Array.from([1, 2, 3]), 'image/png');
      const back = await storage.get(key);
      expect(Array.from(back!.bytes)).toEqual([1, 2, 3]);
      expect(back!.mediaType).toBe('image/png');
      const url = await storage.signedUrl(key, 120);
      expect(url).toContain(`/api/dev-intake/${key}?expires=${1_000_000 + 120_000}&sig=`);
      await storage.delete(key);
      expect(await storage.get(key)).toBeNull();
      await storage.delete(key);
      expect(await readdir(join(dir, 'intake', 'rest1'))).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('refuses a key that is not an intake key, so no path escapes the folder', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ph-intake-test-'));
    try {
      const storage = fsIntakeStorage({ dir });
      await expect(storage.put('../outside', Uint8Array.from([1]), 'image/png')).rejects.toThrow();
      await expect(storage.get('intake/a/../../b')).rejects.toThrow();
      await expect(storage.delete('x')).rejects.toThrow();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('caps a signed URL at five minutes', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ph-intake-test-'));
    try {
      const storage = fsIntakeStorage({ dir, secret: 'test-secret' });
      const key = intakeKey('rest1', 'file1');
      expect(MAX_SIGNED_URL_SECONDS).toBe(300);
      await expect(storage.signedUrl(key, 300)).resolves.toContain('sig=');
      await expect(storage.signedUrl(key, 301)).rejects.toThrow(RangeError);
      await expect(storage.signedUrl(key, 0)).rejects.toThrow(RangeError);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('is refused in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(() => fsIntakeStorage()).toThrow(IntakeStorageNotConfiguredError);
  });
});

describe('the private R2 adapter', () => {
  it('puts private objects into its own bucket, signs a short GET and deletes by key', async () => {
    const sent: { name: string; input: Record<string, unknown> }[] = [];
    const client = {
      async send(command: unknown) {
        const c = command as { constructor: { name: string }; input: Record<string, unknown> };
        sent.push({ name: c.constructor.name, input: c.input });
        if (c.constructor.name === 'GetObjectCommand') {
          return { ContentLength: 3, ContentType: 'image/jpeg', Body: { transformToByteArray: async () => Uint8Array.from([7, 8, 9]) } };
        }
        return {};
      },
    };
    const storage = r2IntakeStorage({ accountId: 'acc', accessKeyId: 'key', secretAccessKey: 'secret', bucket: 'private-invoices' }, client);
    const key = intakeKey('rest1', 'file1');
    await storage.put(key, Uint8Array.from([7, 8, 9]), 'image/jpeg');
    expect(sent[0]).toMatchObject({ name: 'PutObjectCommand', input: { Bucket: 'private-invoices', Key: key, ContentType: 'image/jpeg', CacheControl: 'private, no-store' } });
    expect(Array.from((await storage.get(key))!.bytes)).toEqual([7, 8, 9]);
    const url = await storage.signedUrl(key, 300);
    expect(url).toContain('private-invoices');
    expect(url).toMatch(/X-Amz-Expires=300/);
    await expect(storage.signedUrl(key, 301)).rejects.toThrow(RangeError);
    await storage.delete(key);
    expect(sent.at(-1)).toMatchObject({ name: 'DeleteObjectsCommand', input: { Bucket: 'private-invoices', Delete: { Objects: [{ Key: key }] } } });
  });
});

describe('which adapter a process uses', () => {
  it('is the R2 adapter when the private bucket is configured, in any environment', () => {
    expect(resolveIntakeStorage(parseIntakeStorageEnv(R2), 'production')).toBeTruthy();
  });

  it('is the temp folder outside production without the bucket', () => {
    expect(resolveIntakeStorage(null, 'development')).toBeTruthy();
  });

  it('is the typed state INTAKE_STORAGE_NOT_CONFIGURED in production without the bucket, never the public media bucket', () => {
    let error: unknown;
    try {
      resolveIntakeStorage(null, 'production');
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(IntakeStorageNotConfiguredError);
    expect((error as IntakeStorageNotConfiguredError).code).toBe('INTAKE_STORAGE_NOT_CONFIGURED');
  });

  it('can be replaced by an injected adapter, and restored', async () => {
    const memory = memoryIntakeStorage();
    const restore = withIntakeStorage(memory);
    expect(getIntakeStorage()).toBe(memory);
    restore();
    expect(getIntakeStorage()).not.toBe(memory);
  });
});

describe('the private bucket settings', () => {
  it('are all four or none', () => {
    expect(parseIntakeStorageEnv({})).toBeNull();
    expect(parseIntakeStorageEnv(R2)).toEqual({ accountId: 'acc', accessKeyId: 'key', secretAccessKey: 'secret', bucket: 'private-invoices' });
    expect(() => parseIntakeStorageEnv({ PH_INTAKE_R2_ACCOUNT_ID: 'acc', PH_INTAKE_R2_BUCKET: 'b' })).toThrow(/PH_INTAKE_R2_ACCESS_KEY_ID.*PH_INTAKE_R2_SECRET_ACCESS_KEY/);
  });

  it('are never the same variables as the public media bucket', () => {
    expect(parseIntakeStorageEnv({ R2_ACCOUNT_ID: 'a', R2_ACCESS_KEY_ID: 'k', R2_SECRET_ACCESS_KEY: 's', R2_BUCKET: 'media' })).toBeNull();
  });

  it('are named by the production check when only some are set', () => {
    const check = checkProductionEnv({ PH_INTAKE_R2_BUCKET: 'private-invoices' });
    expect(check.ok).toBe(false);
    const problems = check.ok ? [] : check.problems;
    expect(problems.some((p) => p.startsWith('PH_INTAKE_R2_ACCOUNT_ID '))).toBe(true);
    expect(problems.some((p) => p.startsWith('PH_INTAKE_R2_BUCKET '))).toBe(false);
    expect(JSON.stringify(problems)).not.toContain('private-invoices');
  });
});
