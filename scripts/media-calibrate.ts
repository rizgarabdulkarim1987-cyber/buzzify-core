import { readdirSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import sharp from 'sharp';
import { IMAGE_WIDTHS, prepareAsset } from '@/server/media/process';
import { similarity } from '@/server/media/similarity';

/**
 * Compares what upload processing stores for real photos with what the fixed settings used to store:
 * `npm run media:calibrate -- <folder>`. For each JPEG, PNG, WebP or AVIF in the folder it prints the upload's size, the
 * old total, the new total, and each new file's size and similarity to its source. It reads only the folder given and
 * writes nothing. Real photos are calibration material only and never belong in the repository.
 */

const KB = (bytes: number) => `${(bytes / 1024).toFixed(0)} KB`;

/** What the fixed settings stored: the original at full size, AVIF 55 and WebP 75 at each width. */
async function legacyBytes(bytes: Buffer): Promise<number> {
  const upright = () => sharp(bytes).rotate();
  const meta = await upright().metadata();
  const width = meta.autoOrient?.width ?? meta.width ?? 0;
  const original = await (meta.format === 'png'
    ? upright().png()
    : meta.format === 'webp'
      ? upright().webp({ quality: 90 })
      : meta.format === 'heif'
        ? upright().avif({ quality: 70 })
        : upright().jpeg({ quality: 90 })
  ).toBuffer();
  let total = original.length;
  const widths: number[] = IMAGE_WIDTHS.filter((w) => w <= width);
  if (widths.length === 0) widths.push(width);
  for (const w of widths) {
    total += (await upright().resize({ width: w }).avif({ quality: 55, effort: 4 }).toBuffer()).length;
    total += (await upright().resize({ width: w }).webp({ quality: 75 }).toBuffer()).length;
  }
  return total;
}

async function main(): Promise<void> {
  const folder = process.argv[2];
  if (!folder) {
    console.error('Usage: npm run media:calibrate -- <folder of photos>');
    process.exitCode = 1;
    return;
  }
  const files = readdirSync(folder).filter((name) => ['.jpg', '.jpeg', '.png', '.webp', '.avif'].includes(extname(name).toLowerCase()));
  for (const name of files) {
    const bytes = readFileSync(join(folder, name));
    const started = Date.now();
    const result = await prepareAsset(new Uint8Array(bytes));
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    if (!result.ok) {
      console.log(`${name}: refused (${result.reason})`);
      continue;
    }
    const stored = result.asset.files.reduce((sum, file) => sum + file.body.length, 0);
    console.log(`${name}: upload ${KB(bytes.length)}, before ${KB(await legacyBytes(bytes))}, now ${KB(stored)} in ${seconds} s`);
    for (const file of result.asset.files) {
      const width = file.variant === 'original' ? result.asset.width! : Number(file.variant.split('-')[1]);
      console.log(`  ${file.variant.padEnd(10)} ${KB(file.body.length).padStart(8)}  ${(await similarity(bytes, file.body, width)).toFixed(4)}`);
    }
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
