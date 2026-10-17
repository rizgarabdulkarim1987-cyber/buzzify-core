import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { folderStorage, verifyFolderSignature } from '@/server/storage/folder';
import { StorageTooLargeError, type Storage } from '@/server/storage/storage';

const SECRET = 'folder-storage-test-secret-that-is-long-enough';
const bytes = (text: string) => new TextEncoder().encode(text);

describe('folderStorage', () => {
  let dir: string;
  let storage: Storage;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'buzzify-storage-'));
    storage = folderStorage(dir, '/api/dev-media', SECRET);
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('stores, describes, reads and deletes a file', async () => {
    await storage.put('r/cr1/abc/webp-320.webp', bytes('image'), { contentType: 'image/webp', cacheControl: 'public' });
    expect(await storage.head('r/cr1/abc/webp-320.webp')).toEqual({ bytes: 5, contentType: 'image/webp' });
    const read = await storage.get('r/cr1/abc/webp-320.webp', 100);
    expect(read?.contentType).toBe('image/webp');
    expect(new TextDecoder().decode(read!.bytes)).toBe('image');
    await storage.delete(['r/cr1/abc/webp-320.webp', 'r/cr1/abc/missing.webp']);
    expect(await storage.head('r/cr1/abc/webp-320.webp')).toBeNull();
    expect(await storage.get('r/cr1/abc/webp-320.webp', 100)).toBeNull();
  });

  it('refuses to read a file larger than the caller allows', async () => {
    await storage.put('uploads/cr1/u1', bytes('0123456789'), { contentType: 'image/png', cacheControl: 'no-store' });
    await expect(storage.get('uploads/cr1/u1', 9)).rejects.toBeInstanceOf(StorageTooLargeError);
  });

  it('refuses a key that would leave the folder', async () => {
    await expect(storage.put('../escape', bytes('x'), { contentType: 'text/plain', cacheControl: 'no-store' })).rejects.toThrow();
  });

  it('builds public URLs under the development route', () => {
    expect(storage.publicUrl('r/cr1/abc/webp-320.webp')).toBe('/api/dev-media/r/cr1/abc/webp-320.webp');
  });

  describe('signed URLs', () => {
    const NOW = new Date('2026-10-17T12:00:00Z');
    const params = (url: string) => new URL(url, 'http://127.0.0.1').searchParams;
    const keyOf = (url: string) => new URL(url, 'http://127.0.0.1').pathname.replace('/api/dev-media/', '');

    // Slots are signed for the clock's time; the checks below read the same clock.
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(NOW);
    });
    afterEach(() => vi.useRealTimers());

    it('signs an upload slot that the route accepts until it expires', async () => {
      const { url, headers } = await storage.presignPut('uploads/cr1/u1', { contentType: 'image/png', contentLength: 10, expiresInSec: 300 });
      expect(headers).toEqual({ 'content-type': 'image/png' });
      expect(keyOf(url)).toBe('uploads/cr1/u1');
      const signed = { method: 'PUT' as const, key: 'uploads/cr1/u1', params: params(url) };
      expect(verifyFolderSignature(SECRET, { ...signed, now: NOW })).toEqual({ ok: true, len: 10, type: 'image/png', name: null });
      expect(verifyFolderSignature(SECRET, { ...signed, now: new Date(NOW.getTime() + 301_000) }).ok).toBe(false);
    });

    it('refuses a signature used for another key, another method or another secret', async () => {
      const { url } = await storage.presignPut('uploads/cr1/u1', { contentType: 'image/png', contentLength: 10, expiresInSec: 300 });
      expect(verifyFolderSignature(SECRET, { method: 'PUT', key: 'uploads/cr2/u1', params: params(url), now: NOW }).ok).toBe(false);
      expect(verifyFolderSignature(SECRET, { method: 'GET', key: 'uploads/cr1/u1', params: params(url), now: NOW }).ok).toBe(false);
      expect(verifyFolderSignature(`${SECRET}x`, { method: 'PUT', key: 'uploads/cr1/u1', params: params(url), now: NOW }).ok).toBe(false);
      const tampered = params(url);
      tampered.set('len', '999999');
      expect(verifyFolderSignature(SECRET, { method: 'PUT', key: 'uploads/cr1/u1', params: tampered, now: NOW }).ok).toBe(false);
    });

    it('signs a download with its file name', async () => {
      const url = await storage.presignGet('exports/cm1/e1/menu.csv', { fileName: 'menu.csv', expiresInSec: 300 });
      expect(verifyFolderSignature(SECRET, { method: 'GET', key: 'exports/cm1/e1/menu.csv', params: params(url), now: NOW })).toEqual({
        ok: true,
        len: null,
        type: null,
        name: 'menu.csv',
      });
    });
  });
});
