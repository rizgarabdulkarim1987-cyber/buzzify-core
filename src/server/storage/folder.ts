import { createHmac, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { isValidKey } from './keys';
import { StorageTooLargeError, type Storage } from './storage';

/**
 * Development storage: files in a folder, served and accepted by the development-only route `/api/dev-media/{key}`
 * (404 in production). Its signed URLs imitate R2's: a PUT or GET for one key, valid until a time, signed with the
 * sign-in secret so nobody else can make one.
 */

interface Meta {
  contentType: string;
  cacheControl: string;
}

export type SignedMethod = 'PUT' | 'GET';

function signature(secret: string, method: SignedMethod, key: string, fields: { len: string; type: string; name: string; expires: string }) {
  return createHmac('sha256', secret)
    .update([method, key, fields.len, fields.type, fields.name, fields.expires].join('\n'))
    .digest('hex');
}

/**
 * Whether a development URL's signature is good for this method and key and has not expired. Answers what was signed:
 * the most bytes a PUT may send and its type, and the file name a GET saves under.
 */
export function verifyFolderSignature(
  secret: string,
  request: { method: SignedMethod; key: string; params: URLSearchParams; now: Date },
): { ok: true; len: number | null; type: string | null; name: string | null } | { ok: false } {
  const { params } = request;
  const fields = {
    len: params.get('len') ?? '',
    type: params.get('type') ?? '',
    name: params.get('name') ?? '',
    expires: params.get('expires') ?? '',
  };
  const given = params.get('sig') ?? '';
  if (params.get('method') !== request.method || !/^\d+$/.test(fields.expires)) return { ok: false };
  const expected = signature(secret, request.method, request.key, fields);
  if (given.length !== expected.length || !timingSafeEqual(Buffer.from(given), Buffer.from(expected))) return { ok: false };
  if (Number(fields.expires) * 1000 < request.now.getTime()) return { ok: false };
  return {
    ok: true,
    len: fields.len === '' ? null : Number(fields.len),
    type: fields.type === '' ? null : fields.type,
    name: fields.name === '' ? null : fields.name,
  };
}

export function folderStorage(dir: string, publicUrl: string, signingSecret: string): Storage {
  const root = resolve(dir);

  /** The file of a key, refusing any key that is not one (and so could leave the folder). */
  function fileOf(key: string): string {
    if (!isValidKey(key)) throw new Error(`Not a storage key: ${JSON.stringify(key)}`);
    const file = resolve(join(root, ...key.split('/')));
    if (!file.startsWith(root + sep)) throw new Error(`Not a storage key: ${JSON.stringify(key)}`);
    return file;
  }

  const metaOf = (file: string) => `${file}.meta.json`;

  async function readMeta(file: string): Promise<Meta> {
    try {
      return JSON.parse(await readFile(metaOf(file), 'utf8')) as Meta;
    } catch {
      return { contentType: 'application/octet-stream', cacheControl: 'no-store' };
    }
  }

  function signedUrl(method: SignedMethod, key: string, fields: { len?: number; type?: string; name?: string }, expiresInSec: number) {
    const signed = {
      len: fields.len === undefined ? '' : String(fields.len),
      type: fields.type ?? '',
      name: fields.name ?? '',
      expires: String(Math.floor(Date.now() / 1000) + expiresInSec),
    };
    const params = new URLSearchParams({ method });
    if (signed.len) params.set('len', signed.len);
    if (signed.type) params.set('type', signed.type);
    if (signed.name) params.set('name', signed.name);
    params.set('expires', signed.expires);
    params.set('sig', signature(signingSecret, method, key, signed));
    return `${publicUrl}/${key}?${params}`;
  }

  return {
    async presignPut(key, { contentType, contentLength, expiresInSec }) {
      fileOf(key);
      return {
        url: signedUrl('PUT', key, { len: contentLength, type: contentType }, expiresInSec),
        headers: { 'content-type': contentType },
      };
    },

    async presignGet(key, { fileName, expiresInSec }) {
      fileOf(key);
      return signedUrl('GET', key, { name: fileName }, expiresInSec);
    },

    async head(key) {
      const file = fileOf(key);
      try {
        const info = await stat(file);
        return { bytes: info.size, contentType: (await readMeta(file)).contentType };
      } catch {
        return null;
      }
    },

    async get(key, maxBytes) {
      const file = fileOf(key);
      let size: number;
      try {
        size = (await stat(file)).size;
      } catch {
        return null;
      }
      if (size > maxBytes) throw new StorageTooLargeError(key, maxBytes);
      const bytes = new Uint8Array(await readFile(file));
      return { bytes, contentType: (await readMeta(file)).contentType };
    },

    async put(key, body, { contentType, cacheControl }) {
      const file = fileOf(key);
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, body);
      await writeFile(metaOf(file), JSON.stringify({ contentType, cacheControl } satisfies Meta));
    },

    async delete(keys) {
      for (const key of keys) {
        const file = fileOf(key);
        await rm(file, { force: true });
        await rm(metaOf(file), { force: true });
      }
    },

    publicUrl(key) {
      return `${publicUrl}/${key}`;
    },
  };
}

