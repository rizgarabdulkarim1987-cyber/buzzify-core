import { authEnv, storageEnv } from '@/server/env';
import { verifyFolderSignature } from '@/server/storage/folder';
import { IMMUTABLE_CACHE, isPublicKey, isValidKey } from '@/server/storage/keys';
import { getStorage } from '@/server/storage/storage';

/**
 * Development storage over HTTP, standing in for the R2 bucket and its custom domain: GET serves a library file (or a
 * private one with a signed link), PUT accepts a signed upload. It does not exist in production, where R2 serves and
 * accepts files itself.
 */

/** The most a GET reads: the largest file the Studio ever stores (a 15 MB upload) with room to spare. */
const MAX_READ = 64 * 1024 * 1024;

const notFound = () => new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain' } });

async function keyOf(context: { params: Promise<{ key?: string[] }> }): Promise<string | null> {
  const key = (await context.params).key?.join('/') ?? '';
  return isValidKey(key) ? key : null;
}

function available(): boolean {
  return process.env.NODE_ENV !== 'production' && storageEnv().kind === 'folder';
}

export async function GET(request: Request, context: { params: Promise<{ key?: string[] }> }): Promise<Response> {
  if (!available()) return notFound();
  const key = await keyOf(context);
  if (!key) return notFound();

  const params = new URL(request.url).searchParams;
  let fileName: string | null = null;
  if (!isPublicKey(key)) {
    const signed = verifyFolderSignature(authEnv().secret, { method: 'GET', key, params, now: new Date() });
    if (!signed.ok) return notFound();
    fileName = signed.name;
  }

  const file = await getStorage().get(key, MAX_READ);
  if (!file) return notFound();
  const headers: Record<string, string> = {
    'content-type': file.contentType,
    'cache-control': isPublicKey(key) ? IMMUTABLE_CACHE : 'no-store',
    'x-content-type-options': 'nosniff',
  };
  if (fileName) headers['content-disposition'] = `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`;
  return new Response(file.bytes as unknown as BodyInit, { status: 200, headers });
}

export async function PUT(request: Request, context: { params: Promise<{ key?: string[] }> }): Promise<Response> {
  if (!available()) return notFound();
  const key = await keyOf(context);
  if (!key) return notFound();

  const params = new URL(request.url).searchParams;
  const signed = verifyFolderSignature(authEnv().secret, { method: 'PUT', key, params, now: new Date() });
  if (!signed.ok || signed.len === null || signed.type === null) return new Response('Forbidden', { status: 403 });

  const body = new Uint8Array(await request.arrayBuffer());
  if (body.length > signed.len) return new Response('Too large', { status: 413 });
  await getStorage().put(key, body, { contentType: signed.type, cacheControl: 'no-store' });
  return new Response(null, { status: 200 });
}
