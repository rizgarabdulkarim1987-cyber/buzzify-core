import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { zipSync } from 'fflate';
import * as fontkit from 'fontkit';
import QRCode from 'qrcode';
import sharp from 'sharp';
import type { QrStyle } from '@/server/domain/qr';

/**
 * Drawing a printed QR code (spec 10.8): an SVG with the modules as one path, the brand's logo on a pad in the middle
 * and a line of text below, drawn as outlines so the file needs no font where it is printed; PNGs of it; and a ZIP of
 * many. The highest error correction (H, 30%) is what lets the logo cover the middle.
 */

/** User units per module. */
const MODULE = 10;
/** Modules of light margin around the code: scanners need four. */
const QUIET = 4;
/** The logo's pad, at most this share of the code's width. */
const LOGO_SHARE = 0.2;
/** The frame text's em size, in user units, before it is shrunk to fit the code's width. */
const FRAME_EM = 56;

/** The fonts the frame text is drawn with: the Studio's own, read from their packages (traced into the build). */
const FONT_FILES = {
  arabic: 'node_modules/@fontsource-variable/noto-sans-arabic/files/noto-sans-arabic-arabic-wght-normal.woff2',
  latin: 'node_modules/@fontsource-variable/hanken-grotesk/files/hanken-grotesk-latin-wght-normal.woff2',
} as const;

const ARABIC_SCRIPT = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;

const fonts = new Map<keyof typeof FONT_FILES, fontkit.Font>();

function fontFor(script: keyof typeof FONT_FILES): fontkit.Font {
  let font = fonts.get(script);
  if (!font) {
    // The variable font's default instance: fontkit cannot make another instance of a WOFF2 file.
    font = fontkit.create(readFileSync(join(process.cwd(), FONT_FILES[script]))) as fontkit.Font;
    fonts.set(script, font);
  }
  return font;
}

/** A number for an SVG attribute: at most two decimals, no trailing zeros. */
const n = (value: number) => String(Math.round(value * 100) / 100);
const n1 = (value: number) => String(Math.round(value * 10) / 10);

const escapeAttribute = (value: string) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/**
 * A line of text as one SVG path, shaped by the font (Arabic letters joined, right to left), with its box from (0, 0)
 * to (width, height) at `sizePx` per em. Text in Arabic script uses Noto Sans Arabic, anything else Hanken Grotesk.
 */
export function frameTextPath(text: string, sizePx: number): { path: string; width: number; height: number } {
  const font = fontFor(ARABIC_SCRIPT.test(text) ? 'arabic' : 'latin');
  const scale = sizePx / font.unitsPerEm;
  // fontkit returns a right-to-left run already in visual order, left to right.
  const run = font.layout(text);
  const baseline = font.ascent * scale;
  let pen = 0;
  const parts: string[] = [];
  run.glyphs.forEach((glyph, index) => {
    const position = run.positions[index]!;
    const path = glyph.path.scale(scale, -scale).translate(pen + position.xOffset * scale, baseline - position.yOffset * scale);
    // One decimal of a user unit (a tenth of a module) is finer than any print.
    const svg = path.toSVG().replace(/-?\d*\.\d+(?:e-?\d+)?/g, (number) => n1(Number(number)));
    if (svg) parts.push(svg);
    pen += position.xAdvance * scale;
  });
  return { path: parts.join(''), width: pen, height: (font.ascent - font.descent) * scale };
}

/**
 * The code as SVG: a quiet zone of four modules, the dark modules as one path, the logo centred on a pad of the
 * background colour no wider than 20% of the code, and the frame text centred below, shrunk to the code's width.
 */
export function qrSvg(
  modules: { size: number; get(x: number, y: number): boolean },
  style: QrStyle,
  extras: { logo?: { href: string; width: number; height: number }; frame?: { path: string; width: number; height: number } } = {},
): string {
  const codeWidth = modules.size * MODULE;
  const width = codeWidth + 2 * QUIET * MODULE;
  const origin = QUIET * MODULE;

  // Each row's runs of dark modules as rectangles, in modules (the path is scaled once): half the bytes of user units.
  const runs: string[] = [];
  for (let y = 0; y < modules.size; y += 1) {
    let x = 0;
    while (x < modules.size) {
      if (!modules.get(x, y)) {
        x += 1;
        continue;
      }
      const start = x;
      while (x < modules.size && modules.get(x, y)) x += 1;
      const length = x - start;
      runs.push(`M${QUIET + start} ${QUIET + y}h${length}v1h-${length}z`);
    }
  }

  const parts = [`<rect width="${width}" height="HEIGHT" fill="${style.background}"/>`, `<path fill="${style.foreground}" transform="scale(${MODULE})" d="${runs.join('')}"/>`];

  if (extras.logo) {
    // The pad covers whole modules, an odd number of them so it sits on the centre module.
    let padModules = Math.floor(modules.size * LOGO_SHARE);
    if (padModules % 2 === 0) padModules -= 1;
    const pad = padModules * MODULE;
    const padAt = origin + ((modules.size - padModules) / 2) * MODULE;
    const room = pad - 2 * MODULE;
    const fit = Math.min(room / extras.logo.width, room / extras.logo.height);
    const logoWidth = extras.logo.width * fit;
    const logoHeight = extras.logo.height * fit;
    parts.push(
      `<rect x="${n(padAt)}" y="${n(padAt)}" width="${pad}" height="${pad}" rx="${MODULE}" fill="${style.background}"/>`,
      `<image x="${n(padAt + (pad - logoWidth) / 2)}" y="${n(padAt + (pad - logoHeight) / 2)}" width="${n(logoWidth)}" height="${n(logoHeight)}" href="${escapeAttribute(extras.logo.href)}"/>`,
    );
  }

  let height = width;
  if (extras.frame && extras.frame.width > 0) {
    const fit = Math.min(1, codeWidth / extras.frame.width);
    const textWidth = extras.frame.width * fit;
    const textHeight = extras.frame.height * fit;
    parts.push(`<path fill="${style.foreground}" transform="translate(${n((width - textWidth) / 2)} ${width}) scale(${Math.round(fit * 10_000) / 10_000})" d="${extras.frame.path}"/>`);
    height = width + Math.ceil(textHeight) + origin;
  }

  const body = parts.join('').replace('HEIGHT', String(height));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">${body}</svg>`;
}

/** The brand's logo as a PNG data URI no larger than the pad needs. */
async function logoImage(bytes: Uint8Array): Promise<{ href: string; width: number; height: number } | null> {
  try {
    const { data, info } = await sharp(bytes).resize({ width: 320, height: 320, fit: 'inside', withoutEnlargement: true }).png().toBuffer({ resolveWithObject: true });
    return { href: `data:image/png;base64,${data.toString('base64')}`, width: info.width, height: info.height };
  } catch {
    // A logo that cannot be read leaves the code without one rather than without a code.
    return null;
  }
}

/** Frame texts already drawn: a ZIP of table codes draws the same line for every table. */
const frames = new Map<string, { path: string; width: number; height: number }>();

function frameFor(text: string) {
  let frame = frames.get(text);
  if (!frame) {
    frame = frameTextPath(text, FRAME_EM);
    if (frames.size >= 50) frames.delete(frames.keys().next().value!);
    frames.set(text, frame);
  }
  return frame;
}

function codeSvg(url: string, style: QrStyle, logo: { href: string; width: number; height: number } | null): string {
  const code = QRCode.create(url, { errorCorrectionLevel: 'H' });
  // qrcode reads its matrix by row, then column.
  const modules = { size: code.modules.size, get: (x: number, y: number) => Boolean(code.modules.get(y, x)) };
  const frameText = style.frameText.trim();
  return qrSvg(modules, style, { ...(logo ? { logo } : {}), ...(frameText ? { frame: frameFor(frameText) } : {}) });
}

/** The code for `url` in `style`, with `logo` (the brand's, as an image file) embedded when the style asks for it. */
export async function renderQr(args: { url: string; style: QrStyle; logo: Uint8Array | null }): Promise<string> {
  return codeSvg(args.url, args.style, args.style.logo && args.logo ? await logoImage(args.logo) : null);
}

/** The code for the Studio's page: the logo linked by its address, so a page of many codes stays small. */
export function previewQr(args: { url: string; style: QrStyle; logo: { href: string; width: number; height: number } | null }): string {
  return codeSvg(args.url, args.style, args.style.logo ? args.logo : null);
}

/** The code `svg` as a PNG `size` pixels wide. */
export async function qrPng(svg: string, size: 512 | 1024 | 2048): Promise<Uint8Array> {
  const width = Number(/viewBox="0 0 (\d+(?:\.\d+)?) /.exec(svg)?.[1] ?? size);
  // Drawn at least as large as asked, then brought to the exact width.
  const density = Math.ceil((72 * size) / width);
  const png = await sharp(Buffer.from(svg), { density }).resize({ width: size }).png().toBuffer();
  return new Uint8Array(png);
}

/** Files as one ZIP. */
export function qrZip(files: Array<{ name: string; body: Uint8Array }>): Uint8Array {
  return zipSync(Object.fromEntries(files.map((file) => [file.name, [file.body, { level: file.name.endsWith('.png') ? 0 : 6 }]])));
}
