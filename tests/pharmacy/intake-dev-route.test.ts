import { afterEach, describe, expect, it, vi } from 'vitest';
import { GET } from '@/app/api/dev-intake/[...key]/route';
import { fsIntakeStorage, intakeKey } from '@/server/pharmacy/intake/storage';

const key = intakeKey('rest-dev-route', `file-${Date.now()}`);
const call = (path: string) => GET(new Request(`http://localhost${path}`), { params: Promise.resolve({ key: key.split('/') }) });

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('the development route for private invoices', () => {
  it('streams a file for its signed link, inline, with its type and no caching', async () => {
    const storage = fsIntakeStorage();
    await storage.put(key, Uint8Array.from([1, 2, 3]), 'application/pdf');
    try {
      const reply = await call(await storage.signedUrl(key, 60));
      expect(reply.status).toBe(200);
      expect(reply.headers.get('content-type')).toBe('application/pdf');
      expect(reply.headers.get('content-disposition')).toMatch(/^inline/);
      expect(reply.headers.get('cache-control')).toBe('no-store');
      expect(reply.headers.get('x-content-type-options')).toBe('nosniff');
      expect(Array.from(new Uint8Array(await reply.arrayBuffer()))).toEqual([1, 2, 3]);
    } finally {
      await storage.delete(key);
    }
  });

  it('answers 404 without a valid signature, for an altered or expired one, and for a missing file', async () => {
    const storage = fsIntakeStorage();
    await storage.put(key, Uint8Array.from([1]), 'image/png');
    try {
      const url = await storage.signedUrl(key, 60);
      expect((await call(url.split('?')[0]!)).status).toBe(404);
      expect((await call(url.replace(/sig=[0-9a-f]/, 'sig=0'))).status).toBe(404);
      expect((await call(url.replace(/expires=\d+/, 'expires=1'))).status).toBe(404);
      await storage.delete(key);
      expect((await call(url)).status).toBe(404);
    } finally {
      await storage.delete(key);
    }
  });

  it('does not exist in production', async () => {
    const storage = fsIntakeStorage();
    const url = await storage.signedUrl(key, 60);
    vi.stubEnv('NODE_ENV', 'production');
    expect((await call(url)).status).toBe(404);
  });
});
