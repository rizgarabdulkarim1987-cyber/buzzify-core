import sharp from 'sharp';
import { qualityDecision, type QualityMetrics, type QualityReason } from '@/server/domain/pharmacy/intake';

/**
 * The pixel metrics of an uploaded invoice photo (R5-6), measured BEFORE any AI call. The image is turned upright by its
 * EXIF orientation, reduced to grey and, if larger, shrunk to fit a fixed working box, so the thresholds in
 * `QUALITY_LIMITS` do not depend on how many megapixels the phone has. The decision is the pure `qualityDecision`.
 */

/** The working box the grey image is fitted into (never enlarged). */
const WORKING_BOX_PX = 1000;
/** A decompression bomb guard: more pixels than this is refused as unreadable. */
const MAX_INPUT_PIXELS = 100_000_000;

export class ImageUnreadableError extends Error {
  readonly code = 'IMAGE_UNREADABLE';
  constructor() {
    super('The image could not be read');
    this.name = 'ImageUnreadableError';
  }
}

/** Variance of the 4-neighbour Laplacian over the interior of a grey image (sharpness). */
function laplacianVariance(grey: Uint8Array, width: number, height: number): number {
  if (width < 3 || height < 3) return 0;
  let sum = 0;
  let sumSquares = 0;
  let count = 0;
  for (let y = 1; y < height - 1; y += 1) {
    const row = y * width;
    for (let x = 1; x < width - 1; x += 1) {
      const i = row + x;
      const value = grey[i - width]! + grey[i + width]! + grey[i - 1]! + grey[i + 1]! - 4 * grey[i]!;
      sum += value;
      sumSquares += value * value;
      count += 1;
    }
  }
  const mean = sum / count;
  return sumSquares / count - mean * mean;
}

/** Width, height (as displayed, after EXIF rotation), sharpness, mean grey level and contrast (standard deviation). */
export async function imageQualityMetrics(bytes: Uint8Array): Promise<QualityMetrics> {
  try {
    const input = sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS });
    const meta = await input.metadata();
    if (!meta.width || !meta.height) throw new ImageUnreadableError();
    const turned = (meta.orientation ?? 1) >= 5;
    const width = turned ? meta.height : meta.width;
    const height = turned ? meta.width : meta.height;
    const { data, info } = await input
      .rotate()
      .greyscale()
      .resize(WORKING_BOX_PX, WORKING_BOX_PX, { fit: 'inside', withoutEnlargement: true })
      .raw()
      .toBuffer({ resolveWithObject: true });
    const pixels = info.width * info.height;
    let sum = 0;
    let sumSquares = 0;
    for (let i = 0; i < pixels; i += 1) {
      const v = data[i]!;
      sum += v;
      sumSquares += v * v;
    }
    const meanLuma = sum / pixels;
    return {
      width,
      height,
      laplacianVariance: laplacianVariance(data, info.width, info.height),
      meanLuma,
      contrast: Math.sqrt(Math.max(0, sumSquares / pixels - meanLuma * meanLuma)),
    };
  } catch (error) {
    if (error instanceof ImageUnreadableError) throw error;
    throw new ImageUnreadableError();
  }
}

export interface QualityAssessment {
  ok: boolean;
  reasons: QualityReason[];
  /** The numbers behind the decision; null for a PDF (no pixel metrics). */
  metrics: QualityMetrics | null;
}

/** The gate: metrics for an image, then the decision. A PDF skips it. An image that cannot be decoded throws `ImageUnreadableError`. */
export async function assessQuality(bytes: Uint8Array, mediaType: string): Promise<QualityAssessment> {
  if (mediaType === 'application/pdf') return { ok: true, reasons: [], metrics: null };
  const metrics = await imageQualityMetrics(bytes);
  return { ...qualityDecision(metrics, mediaType), metrics };
}
