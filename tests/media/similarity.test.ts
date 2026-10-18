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

  /** A logo: a detailed mark on a transparent canvas whose hidden colour is `hidden`. */
  async function logoOn(hidden: { r: number; g: number; b: number }, mark?: Buffer) {
    const art = mark ?? (await sharp(await photoLike(120, 60)).ensureAlpha(1).png().toBuffer());
    return sharp({ create: { width: 480, height: 240, channels: 4, background: { ...hidden, alpha: 0 } } })
      .composite([{ input: art, left: 180, top: 90 }])
      .png()
      .toBuffer();
  }

  it('ignores the colour hidden under full transparency', async () => {
    const white = await logoOn({ r: 255, g: 255, b: 255 });
    const teal = await logoOn({ r: 76, g: 105, b: 113 });
    expect(await similarity(white, teal, 480)).toBeGreaterThan(0.999);
  });

  it('does not let a transparent area hide damage to what is visible', async () => {
    const mark = await sharp(await photoLike(120, 60)).ensureAlpha(1).png().toBuffer();
    const source = await logoOn({ r: 0, g: 0, b: 0 }, mark);
    const damaged = await logoOn({ r: 0, g: 0, b: 0 }, await sharp(mark).blur(3).png().toBuffer());
    expect(await similarity(source, damaged, 480)).toBeLessThan(0.9);
  });

  it('reads an image given as raw pixels like the same image encoded', async () => {
    const photo = await photoLike(320, 240);
    const { data, info } = await sharp(photo).raw().toBuffer({ resolveWithObject: true });
    const raw = { data, width: info.width, height: info.height, channels: info.channels as 3 };
    expect(await similarity(raw, photo, 320)).toBeCloseTo(1, 6);
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

  it('agrees with a plain window-by-window SSIM on planes of awkward sizes', () => {
    const plane = (width: number, height: number, seed: number) => {
      const data = new Uint8Array(width * height);
      let state = seed;
      for (let i = 0; i < data.length; i++) data[i] = (state = (state * 1103515245 + 12345) % 2 ** 31) % 256;
      return { data, width, height };
    };
    const naive = (a: ReturnType<typeof plane>, b: ReturnType<typeof plane>) => {
      const [C1, C2] = [(0.01 * 255) ** 2, (0.03 * 255) ** 2];
      let total = 0;
      let count = 0;
      for (let top = 0; top + 8 <= a.height; top += 4) {
        for (let left = 0; left + 8 <= a.width; left += 4) {
          let [sa, sb, saa, sbb, sab] = [0, 0, 0, 0, 0];
          for (let y = top; y < top + 8; y++) {
            for (let x = left; x < left + 8; x++) {
              const [va, vb] = [a.data[y * a.width + x]!, b.data[y * a.width + x]!];
              sa += va;
              sb += vb;
              saa += va * va;
              sbb += vb * vb;
              sab += va * vb;
            }
          }
          const [ma, mb] = [sa / 64, sb / 64];
          const [va, vb, cov] = [saa / 64 - ma * ma, sbb / 64 - mb * mb, sab / 64 - ma * mb];
          total += ((2 * ma * mb + C1) * (2 * cov + C2)) / ((ma * ma + mb * mb + C1) * (va + vb + C2));
          count++;
        }
      }
      return total / count;
    };
    for (const [width, height] of [[37, 29], [64, 48], [41, 8]] as const) {
      const a = plane(width, height, 1);
      const b = { ...plane(width, height, 2), data: a.data.map((v, i) => (i % 3 === 0 ? 255 - v : v)) };
      expect(ssim(a, b)).toBeCloseTo(naive(a, b), 10);
    }
  });

  it('refuses planes of different sizes', () => {
    expect(() => ssim({ data: new Uint8Array(4), width: 2, height: 2 }, { data: new Uint8Array(9), width: 3, height: 3 })).toThrow();
  });
});
