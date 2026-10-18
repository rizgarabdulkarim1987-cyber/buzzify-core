import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { planesOf, similarity, ssim } from '@/server/media/similarity';
import { photoLike } from './photo-like';

describe('similarity', () => {
  it('scores an image against itself as 1', async () => {
    const photo = await photoLike(640, 480);
    expect(await similarity(photo, photo, 640)).toBeCloseTo(1, 6);
  });

  it('scores a heavily blurred copy below 0.9', async () => {
    const photo = await photoLike(640, 480);
    const blurred = await sharp(photo).blur(6).png().toBuffer();
    expect(await similarity(photo, blurred, 640)).toBeLessThan(0.9);
  });

  it('scores a JPEG at quality 95 above 0.98', async () => {
    const photo = await photoLike(640, 480);
    expect(await similarity(photo, await sharp(photo).jpeg({ quality: 95 }).toBuffer(), 640)).toBeGreaterThan(0.98);
  });

  it('counts the alpha channel: a logo whose transparency is lost scores low', async () => {
    const mark = await sharp({ create: { width: 200, height: 100, channels: 4, background: '#c8261c' } }).png().toBuffer();
    const logo = await sharp({ create: { width: 400, height: 200, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: mark, left: 100, top: 50 }])
      .png()
      .toBuffer();
    const flattened = await sharp(logo).flatten({ background: '#000000' }).ensureAlpha(1).png().toBuffer();
    expect(await similarity(logo, flattened, 400)).toBeLessThan(0.9);
  });

  it('keeps the image’s proportions when only a width is given', async () => {
    const { luma } = await planesOf(await photoLike(800, 600), 400);
    expect([luma.width, luma.height]).toEqual([400, 300]);
  });

  it('compares a source with a smaller rendition of itself as alike', async () => {
    const source = await photoLike(1200, 900);
    const rendition = await sharp(source).resize({ width: 600 }).png().toBuffer();
    expect(await similarity(source, rendition, 600)).toBeGreaterThan(0.995);
  });

  it('refuses planes of different sizes', () => {
    expect(() => ssim({ data: new Uint8Array(4), width: 2, height: 2 }, { data: new Uint8Array(9), width: 3, height: 3 })).toThrow();
  });
});
