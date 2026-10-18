import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { QUALITY, searchQuality, VISUALLY_LOSSLESS } from '@/server/media/compress';
import { similarity } from '@/server/media/similarity';
import { photoLike } from './photo-like';

describe('searchQuality', () => {
  it('finds the lowest JPEG quality that still looks the same on a photo-like image', async () => {
    const source = await photoLike(1080, 720);
    const encode = (quality: number) => sharp(source).jpeg({ quality, mozjpeg: true }).toBuffer();
    // Enough tries to search every quality, so the answer is exact.
    const found = await searchQuality({ source, width: 1080, bounds: QUALITY.jpeg, encode, maxTries: 10 });
    expect(found.score).toBeGreaterThanOrEqual(VISUALLY_LOSSLESS);
    expect(found.quality).toBeGreaterThan(QUALITY.jpeg.floor);
    expect(found.quality).toBeLessThan(QUALITY.jpeg.ceiling);
    expect(await similarity(source, await encode(found.quality - 1), 1080)).toBeLessThan(VISUALLY_LOSSLESS);
  });

  it('stops at the ceiling for an image it can never pass', async () => {
    const source = await photoLike(320, 240);
    const encode = (quality: number) => sharp(source).webp({ quality }).toBuffer();
    const found = await searchQuality({ source, width: 320, bounds: QUALITY.webp, encode, threshold: 0.99999 });
    expect(found.quality).toBe(QUALITY.webp.ceiling);
    expect(found.body.equals(await encode(QUALITY.webp.ceiling))).toBe(true);
  });

  it('never encodes more than maxTries times', async () => {
    const source = await photoLike(320, 240);
    let calls = 0;
    const encode = (quality: number) => {
      calls++;
      return sharp(source).avif({ quality }).toBuffer();
    };
    await searchQuality({ source, width: 320, bounds: QUALITY.avif, encode, maxTries: 4 });
    expect(calls).toBeLessThanOrEqual(4);
  });

  it('returns the floor when even the floor looks the same', async () => {
    const flat = await sharp({ create: { width: 320, height: 240, channels: 3, background: '#3a6ea5' } }).png().toBuffer();
    const found = await searchQuality({ source: flat, width: 320, bounds: QUALITY.jpeg, encode: (quality) => sharp(flat).jpeg({ quality, mozjpeg: true }).toBuffer() });
    expect(found.quality).toBe(QUALITY.jpeg.floor);
  });

  it('keeps the bounds the spec sets', () => {
    expect(QUALITY).toEqual({ jpeg: { floor: 60, ceiling: 92 }, webp: { floor: 55, ceiling: 92 }, avif: { floor: 35, ceiling: 75 } });
  });
});
