import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ORIGIN = 'http://127.0.0.1:3100';

/** The route and a storage on the same folder, loaded fresh so each test reads its own environment. */
async function load(dir: string) {
  vi.resetModules();
  vi.stubEnv('MEDIA_LOCAL_DIR', dir);
  vi.stubEnv('MEDIA_PUBLIC_URL', '/api/dev-media');
  const route = await import('@/app/api/dev-media/[...key]/route');
  const { getStorage } = await import('@/server/storage/storage');
  return { route, storage: getStorage() };
}

const params = (key: string) => ({ params: Promise.resolve({ key: key.split('/') }) });

describe('the development media route', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'buzzify-dev-media-'));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(dir, { recursive: true, force: true });
  });

  it('serves a public file with its type and the immutable header', async () => {
    const { route, storage } = await load(dir);
    await storage.put('r/cr1/abc/webp-320.webp', new Uint8Array([1, 2]), { contentType: 'image/webp', cacheControl: 'public, max-age=31536000, immutable' });
    const res = await route.GET(new Request(`${ORIGIN}/api/dev-media/r/cr1/abc/webp-320.webp`), params('r/cr1/abc/webp-320.webp'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/webp');
    expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([1, 2]));
  });

  it('refuses a private file without a signature, and serves it with one', async () => {
    const { route, storage } = await load(dir);
    await storage.put('exports/cm1/e1/menu.csv', new TextEncoder().encode('a,b'), { contentType: 'text/csv', cacheControl: 'no-store' });
    const bare = await route.GET(new Request(`${ORIGIN}/api/dev-media/exports/cm1/e1/menu.csv`), params('exports/cm1/e1/menu.csv'));
    expect(bare.status).toBe(404);
    const signed = await storage.presignGet('exports/cm1/e1/menu.csv', { fileName: 'menu.csv', expiresInSec: 300 });
    const res = await route.GET(new Request(`${ORIGIN}${signed}`), params('exports/cm1/e1/menu.csv'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toBe("attachment; filename*=UTF-8''menu.csv");
  });

  it('stores a signed upload no longer than its slot, and nothing else', async () => {
    const { route, storage } = await load(dir);
    const { url, headers } = await storage.presignPut('uploads/cr1/u1', { contentType: 'image/png', contentLength: 4, expiresInSec: 300 });
    const put = (body: Uint8Array<ArrayBuffer>, target = url) =>
      route.PUT(new Request(`${ORIGIN}${target}`, { method: 'PUT', body, headers }), params('uploads/cr1/u1'));

    expect((await put(new Uint8Array([1, 2, 3, 4, 5]))).status).toBe(413);
    expect(await storage.head('uploads/cr1/u1')).toBeNull();
    expect((await put(new Uint8Array([1, 2, 3, 4]), '/api/dev-media/uploads/cr1/u1')).status).toBe(403);
    expect((await put(new Uint8Array([1, 2, 3, 4]))).status).toBe(200);
    expect(await storage.head('uploads/cr1/u1')).toEqual({ bytes: 4, contentType: 'image/png' });
  });

  it('answers 404 in production', async () => {
    const { route, storage } = await load(dir);
    await storage.put('r/cr1/abc/webp-320.webp', new Uint8Array([1]), { contentType: 'image/webp', cacheControl: 'public' });
    vi.stubEnv('NODE_ENV', 'production');
    expect((await route.GET(new Request(`${ORIGIN}/api/dev-media/r/cr1/abc/webp-320.webp`), params('r/cr1/abc/webp-320.webp'))).status).toBe(404);
    expect((await route.PUT(new Request(`${ORIGIN}/api/dev-media/uploads/cr1/u1`, { method: 'PUT', body: 'x' }), params('uploads/cr1/u1'))).status).toBe(404);
  });
});
