import { unzipSync, strFromU8 } from 'fflate';
import jsQR from 'jsqr';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { DEFAULT_QR_STYLE, type QrStyle } from '@/server/domain/qr';
import { frameTextPath, qrPng, qrZip, renderQr } from '@/server/qr/render';

const URL = 'https://menu.buzzify.me/atelier/t/12?qr=cmvexample000001';

/** A logo: a red mark on white, wider than tall. */
const LOGO_PNG = new Uint8Array(
  await sharp({ create: { width: 300, height: 150, channels: 3, background: { r: 255, g: 255, b: 255 } } })
    .composite([{ input: await sharp({ create: { width: 200, height: 100, channels: 3, background: { r: 200, g: 30, b: 30 } } }).png().toBuffer(), left: 50, top: 25 }])
    .png()
    .toBuffer(),
);

/** What a phone's scanner reads from a PNG. */
async function decode(png: Uint8Array): Promise<string | null> {
  const { data, info } = await sharp(Buffer.from(png)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return jsQR(new Uint8ClampedArray(data), info.width, info.height)?.data ?? null;
}

describe('rendering', () => {
  it.each<[string, QrStyle, Uint8Array | null]>([
    ['default', DEFAULT_QR_STYLE, null],
    ['brand colours', { ...DEFAULT_QR_STYLE, foreground: '#1B1A19', background: '#F7F5F1' }, null],
    ['logo', { ...DEFAULT_QR_STYLE, logo: true }, LOGO_PNG],
    ['Latin frame', { ...DEFAULT_QR_STYLE, frameText: 'Scan for the menu' }, null],
    ['Sorani frame', { ...DEFAULT_QR_STYLE, frameText: 'سکان بکە بۆ مینیو' }, null],
    ['logo and frame', { ...DEFAULT_QR_STYLE, logo: true, frameText: 'Menu' }, LOGO_PNG],
  ])('%s decodes to its URL at 512 px', async (_, style, logo) => {
    const png = await qrPng(await renderQr({ url: URL, style, logo }), 512);
    expect((await sharp(Buffer.from(png)).metadata()).width).toBe(512);
    expect(await decode(png)).toBe(URL);
  });

  it('keeps the logo within 20% of the code width', async () => {
    const svg = await renderQr({ url: URL, style: { ...DEFAULT_QR_STYLE, logo: true }, logo: LOGO_PNG });
    const codeWidth = Number(/viewBox="0 0 (\d+(?:\.\d+)?) /.exec(svg)![1]);
    const image = /<image [^>]*width="(\d+(?:\.\d+)?)"/.exec(svg);
    expect(image).not.toBeNull();
    expect(Number(image![1])).toBeLessThanOrEqual(codeWidth * 0.2);
  });

  it('draws no script, link or foreign reference', async () => {
    const svg = await renderQr({ url: URL, style: { ...DEFAULT_QR_STYLE, logo: true, frameText: '<script>' }, logo: LOGO_PNG });
    expect(svg).not.toMatch(/<script|href="http|xlink:href="http/);
  });

  it('shapes Arabic frame text (joined forms differ from isolated ones)', () => {
    // Beh joined three times is drawn with its initial, medial and final forms, each narrower than the isolated letter.
    const isolated = frameTextPath('ب', 40);
    const joined = frameTextPath('ببب', 40);
    expect(joined.width).toBeLessThan(isolated.width * 3 * 0.8);
    expect(frameTextPath('Menu', 40).width).toBeGreaterThan(0);
  });

  it('zips an SVG and a PNG per table code with an index', async () => {
    const svg = await renderQr({ url: URL, style: DEFAULT_QR_STYLE, logo: null });
    const zip = qrZip([
      { name: 'atelier-table-12.svg', body: new TextEncoder().encode(svg) },
      { name: 'atelier-table-12.png', body: await qrPng(svg, 1024) },
      { name: 'codes.csv', body: new TextEncoder().encode('table,label,url\n12,Table 12,' + URL + '\n') },
    ]);
    const files = unzipSync(zip);
    expect(Object.keys(files).sort()).toEqual(['atelier-table-12.png', 'atelier-table-12.svg', 'codes.csv']);
    expect(strFromU8(files['codes.csv']!)).toContain(URL);
    expect(await decode(files['atelier-table-12.png']!)).toBe(URL);
  });
});
