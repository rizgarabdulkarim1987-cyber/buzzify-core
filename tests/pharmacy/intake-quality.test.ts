import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { QUALITY_LIMITS } from '@/server/domain/pharmacy/intake';
import { assessQuality, ImageUnreadableError, imageQualityMetrics } from '@/server/pharmacy/intake/quality';
import { blurredPage, pageImage, pdfWithPages, photoOfPage } from './intake-helpers';

/**
 * The quality gate on text-like synthetic pages made with sharp (nothing binary is committed): the same page sharp,
 * blurred, small, dark and flat. Each rendering must fail for its own reason and a good photo must pass. The numbers behind
 * `QUALITY_LIMITS` are in the comment on that constant; this file pins what they must keep deciding:
 *   - a photo of the page at 1000, 1600 and 3000 px wide (the drawing and the blur scale with the photo) reads the same;
 *   - blur of sigma 3 at 1600 px (and its equal at the other widths) FAILS, whatever the resolution;
 *   - a sharp page PASSES, including a sparse one that is mostly blank paper.
 */
const WIDTHS = [1000, 1600, 3000] as const;

describe('image quality metrics', () => {
  it('measures a sharp full-size page as readable', async () => {
    const metrics = await imageQualityMetrics(await pageImage());
    expect(metrics.width).toBe(1600);
    expect(metrics.height).toBe(2200);
    expect(metrics.sharpness).toBeGreaterThan(QUALITY_LIMITS.minSharpness);
    expect(metrics.meanLuma).toBeGreaterThan(QUALITY_LIMITS.minMeanLuma);
    expect(metrics.contrast).toBeGreaterThan(QUALITY_LIMITS.minContrast);
  });

  it.each(WIDTHS)('reads a sharp page the same at %i px wide, sparse or full', async (width) => {
    for (const lines of [undefined, 8]) {
      const metrics = await imageQualityMetrics(await photoOfPage({ width, lines }));
      expect(metrics.sharpness, `${width} ${lines ?? 'full'}`).toBeGreaterThan(QUALITY_LIMITS.minSharpness * 3);
    }
  });

  it.each(WIDTHS)('is far lower for the same page out of focus (sigma 3 at 1600 px), at %i px wide', async (width) => {
    for (const lines of [undefined, 8]) {
      const sharpOne = await imageQualityMetrics(await photoOfPage({ width, lines }));
      const blurred = await imageQualityMetrics(await photoOfPage({ width, lines, sigma: 3 }));
      expect(blurred.sharpness, `${width} ${lines ?? 'full'}`).toBeLessThan(QUALITY_LIMITS.minSharpness / 2);
      expect(blurred.sharpness).toBeLessThan(sharpOne.sharpness / 10);
    }
  });

  it('applies the EXIF rotation before measuring the size', async () => {
    const landscape = await sharp(await pageImage({ width: 1600, height: 900 })).withMetadata({ orientation: 6 }).jpeg().toBuffer();
    const metrics = await imageQualityMetrics(landscape);
    expect([metrics.width, metrics.height]).toEqual([900, 1600]);
  });

  it('refuses bytes that are not an image', async () => {
    await expect(imageQualityMetrics(Buffer.from('not an image at all'))).rejects.toThrow(ImageUnreadableError);
  });
});

describe('the quality decision on renderings of one page', () => {
  it('passes a sharp, large, well-lit page', async () => {
    const result = await assessQuality(await pageImage(), 'image/jpeg');
    expect(result.ok).toBe(true);
    expect(result.reasons).toEqual([]);
  });

  it.each(WIDTHS)('passes a sharp page, full or sparse, at %i px wide, and a slightly soft one (sigma 0.7)', async (width) => {
    for (const lines of [undefined, 8]) {
      expect((await assessQuality(await photoOfPage({ width, lines }), 'image/jpeg')).reasons, `${width} ${lines ?? 'full'} sharp`).toEqual([]);
      expect((await assessQuality(await photoOfPage({ width, lines, sigma: 0.7 }), 'image/jpeg')).reasons, `${width} ${lines ?? 'full'} soft`).toEqual([]);
    }
  });

  it.each(WIDTHS)('rejects the blurred page (sigma 3 at 1600 px) as BLURRY at %i px wide', async (width) => {
    const full = await assessQuality(await photoOfPage({ width, sigma: 3 }), 'image/jpeg');
    expect(full.reasons, `${width} full`).toEqual(['BLURRY']);
    // A blurred sparse page also loses what little ink contrast it had: BLURRY stays among the reasons.
    const sparse = await assessQuality(await photoOfPage({ width, lines: 8, sigma: 3 }), 'image/jpeg');
    expect(sparse.reasons, `${width} sparse`).toContain('BLURRY');
  });

  it('rejects the 1600 px photo at sigma 3 that the upload tests use', async () => {
    expect((await assessQuality(await blurredPage(1), 'image/jpeg')).reasons).toEqual(['BLURRY']);
  });

  it('passes the same page as PNG and WebP', async () => {
    expect((await assessQuality(await pageImage({ format: 'png' }), 'image/png')).ok).toBe(true);
    expect((await assessQuality(await pageImage({ format: 'webp' }), 'image/webp')).ok).toBe(true);
  });

  it('rejects a small page as TOO_SMALL', async () => {
    const result = await assessQuality(await pageImage({ width: 600, height: 800 }), 'image/jpeg');
    expect(result.ok).toBe(false);
    expect(result.reasons).toContain('TOO_SMALL');
  });

  it('rejects a dark page as TOO_DARK', async () => {
    const dark = await sharp(await pageImage()).linear(0.15, 0).jpeg({ quality: 92 }).toBuffer();
    const result = await assessQuality(dark, 'image/jpeg');
    expect(result.ok).toBe(false);
    expect(result.reasons).toContain('TOO_DARK');
  });

  it('rejects a flat grey page as LOW_CONTRAST', async () => {
    const flat = await pageImage({ ink: 120, paper: 150 });
    const result = await assessQuality(flat, 'image/jpeg');
    expect(result.ok).toBe(false);
    expect(result.reasons).toContain('LOW_CONTRAST');
  });

  it('lists every reason that applies', async () => {
    const result = await assessQuality(await pageImage({ width: 600, height: 800, ink: 20, paper: 30 }), 'image/jpeg');
    expect(result.reasons).toEqual(expect.arrayContaining(['TOO_SMALL', 'TOO_DARK', 'LOW_CONTRAST']));
  });

  it('skips the pixel metrics for a PDF', async () => {
    expect(await assessQuality(pdfWithPages(2), 'application/pdf')).toEqual({ ok: true, reasons: [], metrics: null });
  });

  it('reports an unreadable image as unreadable, not as poor quality', async () => {
    await expect(assessQuality(Buffer.from('\xff\xd8\xff garbage'), 'image/jpeg')).rejects.toThrow(ImageUnreadableError);
  });
});
