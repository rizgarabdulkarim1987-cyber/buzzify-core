import { DeleteObjectsCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { describe, expect, it } from 'vitest';
import { r2Storage } from '@/server/storage/r2';
import { StorageTooLargeError } from '@/server/storage/storage';

const CONFIG = {
  accountId: 'acc',
  accessKeyId: 'AKIAMADEUPEXAMPLE',
  secretAccessKey: 'made-up-secret-access-key-for-tests',
  bucket: 'bucket',
  publicUrl: 'https://media.buzzify.me',
};

/** Records every command sent and answers with the reply the test gives for its type. */
function fakeClient(replies: Record<string, (input: Record<string, unknown>) => unknown> = {}) {
  const sent: Array<{ name: string; input: Record<string, unknown> }> = [];
  return {
    sent,
    async send(command: unknown) {
      const { constructor, input } = command as { constructor: { name: string }; input: Record<string, unknown> };
      sent.push({ name: constructor.name, input });
      const reply = replies[constructor.name];
      if (!reply) return {};
      return reply(input);
    },
  };
}

const notFound = () => {
  throw Object.assign(new Error('Not found'), { name: 'NotFound', $metadata: { httpStatusCode: 404 } });
};

describe('r2Storage', () => {
  it('signs an upload slot on the account endpoint, for the bucket and key, valid for five minutes', async () => {
    const storage = r2Storage(CONFIG, fakeClient());
    const { url, headers } = await storage.presignPut('uploads/r1/u1', { contentType: 'image/png', contentLength: 1234, expiresInSec: 300 });
    const parsed = new URL(url);
    expect(parsed.host).toBe('acc.r2.cloudflarestorage.com');
    expect(parsed.pathname).toBe('/bucket/uploads/r1/u1');
    expect(parsed.searchParams.get('X-Amz-Expires')).toBe('300');
    expect(headers).toEqual({ 'content-type': 'image/png' });
  });

  it('signs an upload slot without a checksum, which the browser’s file could never match', async () => {
    // The SDK otherwise signs the CRC32 of an empty body (AAAAAA==) into the URL, and R2 refuses every real file sent to it.
    const { url } = await r2Storage(CONFIG, fakeClient()).presignPut('uploads/r1/u1', { contentType: 'image/png', contentLength: 1234, expiresInSec: 300 });
    const params = [...new URL(url).searchParams.keys()].map((name) => name.toLowerCase());
    expect(params.filter((name) => name.includes('checksum'))).toEqual([]);
  });

  it('signs a download that saves under its file name', async () => {
    const url = new URL(await r2Storage(CONFIG, fakeClient()).presignGet('exports/m1/e1/menu.csv', { fileName: 'Atelier menu.csv', expiresInSec: 300 }));
    expect(url.pathname).toBe('/bucket/exports/m1/e1/menu.csv');
    expect(url.searchParams.get('response-content-disposition')).toBe("attachment; filename*=UTF-8''Atelier%20menu.csv");
  });

  it('puts, reads, describes and deletes through the S3 API', async () => {
    const body = new Uint8Array([1, 2, 3]);
    const client = fakeClient({
      GetObjectCommand: () => ({ ContentLength: 3, ContentType: 'image/png', Body: { transformToByteArray: async () => body } }),
      HeadObjectCommand: () => ({ ContentLength: 3, ContentType: 'image/png' }),
    });
    const storage = r2Storage(CONFIG, client);
    await storage.put('r/r1/h/original.png', body, { contentType: 'image/png', cacheControl: 'public, max-age=31536000, immutable' });
    expect(await storage.get('r/r1/h/original.png', 10)).toEqual({ bytes: body, contentType: 'image/png' });
    expect(await storage.head('r/r1/h/original.png')).toEqual({ bytes: 3, contentType: 'image/png' });
    await storage.delete(['r/r1/h/original.png', 'r/r1/h/webp-320.webp']);
    await storage.delete([]);

    expect(client.sent.map((c) => c.name)).toEqual([
      PutObjectCommand.name,
      GetObjectCommand.name,
      HeadObjectCommand.name,
      DeleteObjectsCommand.name,
    ]);
    expect(client.sent[0]!.input).toMatchObject({
      Bucket: 'bucket',
      Key: 'r/r1/h/original.png',
      ContentType: 'image/png',
      CacheControl: 'public, max-age=31536000, immutable',
    });
    expect(client.sent[1]!.input).toMatchObject({ Bucket: 'bucket', Key: 'r/r1/h/original.png' });
    expect(client.sent[3]!.input).toEqual({
      Bucket: 'bucket',
      Delete: { Objects: [{ Key: 'r/r1/h/original.png' }, { Key: 'r/r1/h/webp-320.webp' }], Quiet: true },
    });
  });

  it('answers null for a missing object and refuses one larger than allowed before reading it', async () => {
    let read = false;
    const storage = r2Storage(
      CONFIG,
      fakeClient({
        HeadObjectCommand: notFound,
        GetObjectCommand: (input) =>
          input.Key === 'missing'
            ? notFound()
            : {
                ContentLength: 20,
                ContentType: 'image/png',
                Body: {
                  transformToByteArray: async () => {
                    read = true;
                    return new Uint8Array(20);
                  },
                },
              },
      }),
    );
    expect(await storage.head('missing')).toBeNull();
    expect(await storage.get('missing', 10)).toBeNull();
    await expect(storage.get('big', 10)).rejects.toBeInstanceOf(StorageTooLargeError);
    expect(read).toBe(false);
  });

  it('builds public URLs on the media domain', () => {
    expect(r2Storage(CONFIG, fakeClient()).publicUrl('r/r1/h/webp-320.webp')).toBe('https://media.buzzify.me/r/r1/h/webp-320.webp');
  });
});
