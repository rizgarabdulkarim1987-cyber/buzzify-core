import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { faviconFiles, prepareAsset, storeAsset, type PreparedAsset } from '@/server/media/process';
import { folderStorage } from '@/server/storage/folder';
import type { Storage } from '@/server/storage/storage';
import { buildGlb, buildMp4 } from '../helpers/scene-files';

const jpeg = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: '#C8261C' } }).jpeg().toBuffer().then((b) => new Uint8Array(b));
const png = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 4, background: { r: 20, g: 80, b: 200, alpha: 1 } } }).png().toBuffer().then((b) => new Uint8Array(b));

/** A picture of random pixels: the worst case for a placeholder's size. */
async function noise(width: number, height: number): Promise<Uint8Array> {
  const raw = Buffer.alloc(width * height * 3);
  for (let i = 0; i < raw.length; i++) raw[i] = Math.floor(Math.random() * 256);
  return new Uint8Array(await sharp(raw, { raw: { width, height, channels: 3 } }).png().toBuffer());
}

function prepared(result: Awaited<ReturnType<typeof prepareAsset>>): PreparedAsset {
  if (!result.ok) throw new Error(`refused: ${result.reason}`);
  return result.asset;
}

const variantNames = (asset: PreparedAsset) =>
  asset.files.map((file) => file.variant).sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));

const fileOf = (asset: PreparedAsset, variant: string) => asset.files.find((file) => file.variant === variant)!;

describe('prepareAsset', () => {
  it('makes AVIF and WebP at 320, 640 and 1080 for a 1200 px photo, never upscaled', async () => {
    const asset = prepared(await prepareAsset(await jpeg(1200, 800)));
    expect(variantNames(asset)).toEqual(['avif-320', 'avif-640', 'avif-1080', 'original', 'webp-320', 'webp-640', 'webp-1080']);
    expect(asset).toMatchObject({ kind: 'IMAGE', mime: 'image/jpeg', width: 1200, height: 800 });
    expect((await sharp(fileOf(asset, 'webp-640').body).metadata()).width).toBe(640);
    expect((await sharp(fileOf(asset, 'avif-1080').body).metadata()).format).toBe('heif');
    expect(fileOf(asset, 'original').ext).toBe('jpg');
  });

  it('makes all four widths for a large photo, and one pair at its own width for a small one', async () => {
    expect(variantNames(prepared(await prepareAsset(await jpeg(2400, 1600))))).toEqual([
      'avif-320',
      'avif-640',
      'avif-1080',
      'avif-1600',
      'original',
      'webp-320',
      'webp-640',
      'webp-1080',
      'webp-1600',
    ]);
    const small = prepared(await prepareAsset(await png(200, 100)));
    expect(variantNames(small)).toEqual(['avif-200', 'original', 'webp-200']);
  });

  it('drops EXIF metadata and applies its orientation', async () => {
    const turned = await sharp({ create: { width: 400, height: 200, channels: 3, background: '#336699' } })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .withExif({ IFD0: { Copyright: 'Secret Owner', Artist: 'Someone' } })
      .toBuffer();
    const asset = prepared(await prepareAsset(new Uint8Array(turned)));
    // Orientation 6 is a quarter turn: the picture stands upright as 200 × 400.
    expect(asset).toMatchObject({ width: 200, height: 400 });
    for (const file of asset.files.filter((f) => f.variant !== 'original')) {
      const meta = await sharp(file.body).metadata();
      expect(meta.exif).toBeUndefined();
      expect(meta.orientation ?? 1).toBe(1);
    }
    // The original is stored re-encoded without its metadata too: a phone photo can carry the place it was taken.
    expect((await sharp(fileOf(asset, 'original').body).metadata()).exif).toBeUndefined();
  });

  it('treats a PNG named .jpg as the PNG it is', async () => {
    const asset = prepared(await prepareAsset(await png(400, 300)));
    expect(asset.mime).toBe('image/png');
    expect(fileOf(asset, 'original').ext).toBe('png');
  });

  it('refuses a 1 × 20,000 image, and one too wide for its height, as DIMENSIONS', async () => {
    expect(await prepareAsset(await png(1, 20_000))).toEqual({ ok: false, reason: 'DIMENSIONS' });
    expect(await prepareAsset(await png(900, 100))).toEqual({ ok: false, reason: 'DIMENSIONS' });
    expect((await prepareAsset(await png(800, 100))).ok).toBe(true);
  });

  it('refuses bytes sharp cannot read as UNREADABLE, and what is not an allowed type as TYPE', async () => {
    const broken = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(await prepareAsset(broken)).toEqual({ ok: false, reason: 'UNREADABLE' });
    expect(await prepareAsset(new TextEncoder().encode('<!doctype html><svg/>'))).toEqual({ ok: false, reason: 'TYPE' });
    expect(await prepareAsset(new TextEncoder().encode('GIF89a......'))).toEqual({ ok: false, reason: 'TYPE' });
  });

  it('refuses 15 MB plus one byte as SIZE without decoding it', async () => {
    const big = new Uint8Array(15_728_641);
    big.set([0xff, 0xd8, 0xff, 0xe0]);
    expect(await prepareAsset(big)).toEqual({ ok: false, reason: 'SIZE' });
  });

  it('keeps the placeholder under 1,024 characters, even for noise in the tallest allowed shape', async () => {
    for (const picture of [await jpeg(1200, 800), await noise(400, 3200), await noise(1600, 200)]) {
      const { placeholder } = prepared(await prepareAsset(picture));
      expect(placeholder).toMatch(/^data:image\/webp;base64,/);
      expect(placeholder.length).toBeLessThanOrEqual(1024);
    }
  });

  it('hashes the bytes as uploaded', async () => {
    const input = await jpeg(500, 500);
    expect(prepared(await prepareAsset(input)).contentHash).toBe(createHash('sha256').update(input).digest('hex'));
  });

  it('stores a sanitized SVG with two WebP renderings', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="100"><script>x()</script><rect width="300" height="100" fill="#123456"/></svg>';
    const asset = prepared(await prepareAsset(new TextEncoder().encode(svg)));
    expect(asset).toMatchObject({ kind: 'SVG', mime: 'image/svg+xml', width: 300, height: 100 });
    expect(variantNames(asset)).toEqual(['original', 'webp-320', 'webp-640']);
    expect(new TextDecoder().decode(fileOf(asset, 'original').body)).not.toContain('<script');
    expect((await sharp(fileOf(asset, 'webp-640').body).metadata()).width).toBe(640);
  });

  it('refuses an SVG that has no size as SVG_UNSAFE', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>';
    expect(await prepareAsset(new TextEncoder().encode(svg))).toEqual({ ok: false, reason: 'SVG_UNSAFE' });
  });

  it('stores an icon as it is, sized from its first entry', async () => {
    const image = await png(32, 32);
    const header = Buffer.alloc(22);
    header.writeUInt16LE(0, 0);
    header.writeUInt16LE(1, 2);
    header.writeUInt16LE(1, 4);
    header.writeUInt8(32, 6);
    header.writeUInt8(32, 7);
    header.writeUInt16LE(1, 10);
    header.writeUInt16LE(32, 12);
    header.writeUInt32LE(image.length, 14);
    header.writeUInt32LE(22, 18);
    const ico = new Uint8Array(Buffer.concat([header, image]));
    const asset = prepared(await prepareAsset(ico));
    expect(asset).toMatchObject({ kind: 'ICON', mime: 'image/x-icon', width: 32, height: 32, placeholder: '' });
    expect(asset.files).toEqual([{ variant: 'original', ext: 'ico', contentType: 'image/x-icon', body: ico }]);
  });
});

describe('storeAsset', () => {
  let dir: string;
  let storage: Storage;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'buzzify-store-'));
    storage = folderStorage(dir, '/api/dev-media', 'store-asset-test-secret-long-enough-for-hmac');
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('writes every file under the restaurant and the content hash, cached forever, and counts the bytes', async () => {
    const asset = prepared(await prepareAsset(await jpeg(700, 400)));
    const stored = await storeAsset(storage, { restaurantId: 'cr1' }, asset);
    expect(stored.storageKey).toBe(`r/cr1/${asset.contentHash}`);
    expect(stored.variants).toEqual({
      original: `r/cr1/${asset.contentHash}/original.jpg`,
      avif: { '320': `r/cr1/${asset.contentHash}/avif-320.avif`, '640': `r/cr1/${asset.contentHash}/avif-640.avif` },
      webp: { '320': `r/cr1/${asset.contentHash}/webp-320.webp`, '640': `r/cr1/${asset.contentHash}/webp-640.webp` },
    });
    expect(stored.storedBytes).toBe(asset.files.reduce((sum, file) => sum + file.body.length, 0));
    expect(await storage.head(stored.variants.webp!['320']!)).toEqual({ bytes: fileOf(asset, 'webp-320').body.length, contentType: 'image/webp' });
  });

  it('writes a shared asset under shared/', async () => {
    const asset = prepared(await prepareAsset(await png(100, 100)));
    expect((await storeAsset(storage, { restaurantId: null }, asset)).storageKey).toBe(`shared/${asset.contentHash}`);
  });
});

describe('faviconFiles', () => {
  it('draws a square PNG at 32, 180 and 512 px from a wide logo', async () => {
    const files = await faviconFiles({ kind: 'IMAGE', original: await png(300, 100) });
    for (const size of ['32', '180', '512'] as const) {
      const meta = await sharp(files[size]).metadata();
      expect(meta).toMatchObject({ format: 'png', width: Number(size), height: Number(size), hasAlpha: true });
    }
  });

  it('draws one from an SVG logo', async () => {
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20"/></svg>');
    expect((await sharp((await faviconFiles({ kind: 'SVG', original: svg }))['180']).metadata()).width).toBe(180);
  });
});

// Scene files (spec 2026-10-18-template-studio-stage-2-scene-files-design.md, 3) --------------------------------------

describe('prepareAsset for scene files', () => {
  it('keeps a GLB as it is, as a model, with what it holds', async () => {
    const glb = buildGlb({ triangles: 2 });
    const asset = prepared(await prepareAsset(glb));
    expect(asset).toMatchObject({ kind: 'MODEL', mime: 'model/gltf-binary', width: null, height: null, durationMs: null, placeholder: '' });
    expect(asset.meta).toEqual({ triangles: 2, nodes: 1, materials: 1, textures: 0, animations: 0 });
    expect(asset.files).toEqual([{ variant: 'original', ext: 'glb', contentType: 'model/gltf-binary', body: glb }]);
  });

  it('stores a Lottie animation as its checked, minified JSON', async () => {
    const json = { v: '5.7.4', fr: 25, ip: 0, op: 50, w: 300, h: 200, layers: [{ ty: 3, ind: 1, ks: {}, ip: 0, op: 50, st: 0, ln: 'x' }] };
    const asset = prepared(await prepareAsset(new TextEncoder().encode(JSON.stringify(json, null, 2))));
    expect(asset).toMatchObject({ kind: 'LOTTIE', mime: 'application/json', width: 300, height: 200, durationMs: 2000 });
    expect(asset.meta).toEqual({ frameRate: 25, layers: 1 });
    const original = fileOf(asset, 'original');
    expect(original).toMatchObject({ ext: 'json', contentType: 'application/json' });
    expect(JSON.parse(new TextDecoder().decode(original.body)).layers[0].ln).toBeUndefined();
  });

  it('keeps a video as it is, with its poster made into widths and a placeholder', async () => {
    const video = buildMp4({ width: 1080, height: 1920, durationMs: 6000, sound: true });
    const asset = prepared(await prepareAsset(video, await jpeg(720, 1280)));
    expect(asset).toMatchObject({ kind: 'VIDEO', mime: 'video/mp4', width: 1080, height: 1920, durationMs: 6000 });
    expect(asset.meta).toEqual({ codec: 'avc1', hasAudio: true });
    expect(asset.placeholder).toMatch(/^data:image\/webp;base64,/);
    expect(variantNames(asset)).toEqual(['original', 'poster-avif-320', 'poster-avif-640', 'poster-webp-320', 'poster-webp-640']);
    expect(fileOf(asset, 'original')).toMatchObject({ ext: 'mp4', contentType: 'video/mp4', body: video });
  });

  it('refuses a video without a poster, or with one that is not a picture', async () => {
    expect(await prepareAsset(buildMp4())).toEqual({ ok: false, reason: 'POSTER' });
    expect(await prepareAsset(buildMp4(), new TextEncoder().encode('<html></html>'))).toEqual({ ok: false, reason: 'POSTER' });
  });

  it('passes on why a scene file is refused', async () => {
    expect(await prepareAsset(buildGlb({ edit: (g) => (g.buffers[0].uri = 'https://example.com/a.bin') }))).toEqual({ ok: false, reason: 'MODEL_EXTERNAL' });
    expect(await prepareAsset(buildMp4({ codec: 'hvc1' }), await jpeg(100, 100))).toEqual({ ok: false, reason: 'VIDEO_CODEC' });
    expect(await prepareAsset(new TextEncoder().encode('{"v":"5","layers":[]}'))).toEqual({ ok: false, reason: 'LOTTIE_INVALID' });
  });

  it('holds each kind to its own limit: a model over 10 MB is refused', async () => {
    const big = new Uint8Array(10 * 1024 * 1024 + 1);
    big.set([0x67, 0x6c, 0x54, 0x46, 2, 0, 0, 0]);
    expect(await prepareAsset(big)).toEqual({ ok: false, reason: 'SIZE' });
  });

  it('writes a poster under the video, by format and width', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'buzzify-store-'));
    try {
      const storage = folderStorage(dir, '/api/dev-media', 'store-asset-test-secret-long-enough-for-hmac');
      const asset = prepared(await prepareAsset(buildMp4({ width: 640, height: 360 }), await jpeg(640, 360)));
      const stored = await storeAsset(storage, { restaurantId: 'cr1' }, asset);
      const folder = `r/cr1/${asset.contentHash}`;
      expect(stored.variants).toEqual({
        original: `${folder}/original.mp4`,
        poster: {
          avif: { '320': `${folder}/poster-avif-320.avif`, '640': `${folder}/poster-avif-640.avif` },
          webp: { '320': `${folder}/poster-webp-320.webp`, '640': `${folder}/poster-webp-640.webp` },
        },
      });
      expect(await storage.head(`${folder}/original.mp4`)).toMatchObject({ contentType: 'video/mp4' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
