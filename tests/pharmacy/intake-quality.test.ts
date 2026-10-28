import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { QUALITY_LIMITS } from '@/server/domain/pharmacy/intake';
import { assessQuality, ImageUnreadableError, imageQualityMetrics } from '@/server/pharmacy/intake/quality';
import { pageImage, pdfWithPages } from './intake-helpers';

/**
 * The quality gate on text-like synthetic pages made with sharp (nothing binary is committed): the same page sharp,
 * blurred, small, dark and flat. Each rendering must fail for its own reason and a good photo must pass.
 *
 * Calibration of `QUALITY_LIMITS` (measured here, Laplacian variance at the working size; sharp page | blur sigma 1, 2, 3, 5, 8):
 *   1600x2200: 22182 | 14967, 3498, 718, 149, 15      1000x1400: 12164 | 4820, 678, 129, 31, 5      820x1100: 9222 | 2164, 267, 54, 16, 4
 * The limit of 100 separates a sharp page from a heavily blurred one by two orders of magnitude, so it is kept. A fixed
 * sigma is not a fixed severity (the working size shrinks a large photo, and its blur with it): the blurred fixture is the
 * 1000x1400 page at sigma 5 (31), which is below the limit at every size. Real photos are softer than these hard-edged
 * pages, so the limit is recalibrated on real invoices at UAT (listed).
 */
const BLUR_SIGMA = 5;
const blurredPage = async () => sharp(await pageImage({ width: 1000, height: 1400 })).blur(BLUR_SIGMA).jpeg({ quality: 92 }).toBuffer();

describe('image quality metrics', () => {
  it('measures a sharp full-size page as readable', async () => {
    const metrics = await imageQualityMetrics(await pageImage());
    expect(metrics.width).toBe(1600);
    expect(metrics.height).toBe(2200);
    expect(metrics.laplacianVariance).toBeGreaterThan(QUALITY_LIMITS.minLaplacianVariance);
    expect(metrics.meanLuma).toBeGreaterThan(QUALITY_LIMITS.minMeanLuma);
    expect(metrics.contrast).toBeGreaterThan(QUALITY_LIMITS.minContrast);
  });

  it('gives the same sharpness whatever the megapixels: a 4x larger rendering of the same page is not "sharper"', async () => {
    const small = await imageQualityMetrics(await pageImage({ width: 1200, height: 1600 }));
    const large = await imageQualityMetrics(await sharp(await pageImage({ width: 1200, height: 1600 })).resize(3600, 4800).jpeg().toBuffer());
    // The large one is the small one enlarged (softer): it must not read as hugely different, and must still pass.
    expect(large.laplacianVariance).toBeGreaterThan(QUALITY_LIMITS.minLaplacianVariance);
    expect(small.laplacianVariance).toBeGreaterThan(QUALITY_LIMITS.minLaplacianVariance);
  });

  it('is much lower for the same page blurred', async () => {
    const sharpMetrics = await imageQualityMetrics(await pageImage({ width: 1000, height: 1400 }));
    const blurred = await imageQualityMetrics(await blurredPage());
    expect(blurred.laplacianVariance).toBeLessThan(sharpMetrics.laplacianVariance / 100);
    expect(blurred.laplacianVariance).toBeLessThan(QUALITY_LIMITS.minLaplacianVariance);
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

  it('passes the same page as PNG and WebP', async () => {
    expect((await assessQuality(await pageImage({ format: 'png' }), 'image/png')).ok).toBe(true);
    expect((await assessQuality(await pageImage({ format: 'webp' }), 'image/webp')).ok).toBe(true);
  });

  it('rejects the blurred page as BLURRY, and only for that', async () => {
    const result = await assessQuality(await blurredPage(), 'image/jpeg');
    expect(result.ok).toBe(false);
    expect(result.reasons).toEqual(['BLURRY']);
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
