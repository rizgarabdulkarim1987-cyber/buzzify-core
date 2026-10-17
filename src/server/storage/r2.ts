import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { StorageTooLargeError, type Storage } from './storage';

export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  /** The bucket's public address (its custom domain), without a trailing slash. */
  publicUrl: string;
}

/** What the adapter sends commands through: the S3 client, or a stand-in in tests. */
export interface S3Like {
  send(command: unknown): Promise<unknown>;
}

/** S3's limit for one DeleteObjects request. */
const DELETE_BATCH = 1000;

function isNotFound(error: unknown): boolean {
  const e = error as { name?: string; $metadata?: { httpStatusCode?: number } } | null;
  return e?.name === 'NotFound' || e?.name === 'NoSuchKey' || e?.$metadata?.httpStatusCode === 404;
}

/** `attachment; filename*=UTF-8''…`: the RFC 5987 form, so a name in any script survives. */
function attachment(fileName: string): string {
  return `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

/**
 * Cloudflare R2 through its S3-compatible API (spec 11). Signing happens on this machine with the account's keys and
 * needs no request to R2, so signed URLs are cheap; `client` replaces the S3 client for the commands in tests.
 */
export function r2Storage(config: R2Config, client?: S3Like): Storage {
  const s3 = new S3Client({
    region: 'auto',
    endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    // Path-style addressing keeps the bucket in the path, which R2's account endpoint expects.
    forcePathStyle: true,
    // Checksums only where an operation requires one. The SDK's default would sign the CRC32 of an empty body into each
    // upload slot, and R2 refuses every real file the browser sends to it.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
  const send = (command: unknown) => (client ?? (s3 as unknown as S3Like)).send(command);
  const Bucket = config.bucket;

  return {
    async presignPut(key, { contentType, contentLength, expiresInSec }) {
      const command = new PutObjectCommand({ Bucket, Key: key, ContentType: contentType, ContentLength: contentLength });
      const url = await getSignedUrl(s3, command, { expiresIn: expiresInSec });
      return { url, headers: { 'content-type': contentType } };
    },

    async presignGet(key, { fileName, expiresInSec }) {
      const command = new GetObjectCommand({ Bucket, Key: key, ResponseContentDisposition: attachment(fileName) });
      return getSignedUrl(s3, command, { expiresIn: expiresInSec });
    },

    async head(key) {
      try {
        const reply = (await send(new HeadObjectCommand({ Bucket, Key: key }))) as { ContentLength?: number; ContentType?: string };
        return { bytes: reply.ContentLength ?? 0, contentType: reply.ContentType ?? 'application/octet-stream' };
      } catch (error) {
        if (isNotFound(error)) return null;
        throw error;
      }
    },

    async get(key, maxBytes) {
      let reply: { ContentLength?: number; ContentType?: string; Body?: { transformToByteArray(): Promise<Uint8Array> } };
      try {
        reply = (await send(new GetObjectCommand({ Bucket, Key: key }))) as typeof reply;
      } catch (error) {
        if (isNotFound(error)) return null;
        throw error;
      }
      // Refused from the length R2 reports, before any of the body is read.
      if ((reply.ContentLength ?? 0) > maxBytes) {
        (reply.Body as { destroy?: () => void } | undefined)?.destroy?.();
        throw new StorageTooLargeError(key, maxBytes);
      }
      const bytes = (await reply.Body?.transformToByteArray()) ?? new Uint8Array();
      if (bytes.length > maxBytes) throw new StorageTooLargeError(key, maxBytes);
      return { bytes, contentType: reply.ContentType ?? 'application/octet-stream' };
    },

    async put(key, body, { contentType, cacheControl }) {
      await send(new PutObjectCommand({ Bucket, Key: key, Body: body, ContentType: contentType, CacheControl: cacheControl }));
    },

    async delete(keys) {
      for (let at = 0; at < keys.length; at += DELETE_BATCH) {
        const batch = keys.slice(at, at + DELETE_BATCH);
        await send(new DeleteObjectsCommand({ Bucket, Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true } }));
      }
    },

    publicUrl(key) {
      return `${config.publicUrl}/${key}`;
    },
  };
}
