import sharp from 'sharp';
import { DEFAULT_PALETTES, HEX, type Palette } from '@/lib/brand';
import { frameTextPath } from '@/server/qr/render';

/**
 * A dish's share card (plan feature `share.dishCards`): a portrait PNG with the dish's photo, its name and price, and the
 * restaurant's name, in the menu's colours. The text is drawn as outlines shaped by the font, the way the printed QR code's
 * is, so Arabic and Kurdish join correctly and no font is needed where the card is opened.
 */

export const CARD = { width: 1080, height: 1350, photo: 800 } as const;

const MARGIN = 80;
const MAX_TEXT = CARD.width - 2 * MARGIN;

export interface DishCardInput {
  name: string;
  /** The price as the menu shows it, already formatted. */
  price: string;
  restaurant: string;
  palette: Palette;
  /** The dish's photo as stored (any format sharp reads), or none: the card then shows a plain panel. */
  photo: Buffer | null;
}

/** A line of text as SVG paths in its own coordinates (from 0, 0), the width it takes and the scale that fits it. */
interface Line {
  markup: string;
  width: number;
  height: number;
  scale: number;
}

const safe = (color: string, fallback: string) => (HEX.test(color) ? color : fallback);

/** Letters of the Arabic script: the font for these has no Latin letters, digits or full stop, so they are shaped apart. */
const ARABIC_RUN = /([؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]+)/;
/** Direction marks (a formatted price has them) are not in the fonts and would draw as boxes; no-break spaces become spaces. */
const DIRECTION_MARKS = /[‎‏؜‪-‮⁦-⁩]/g;

/**
 * One line, its Arabic runs and everything else shaped with their own fonts and set side by side: right to left when the
 * line holds Arabic letters (the first run at the right), else left to right. A number inside Arabic text stays whole.
 */
function shapeLine(text: string, size: number): Omit<Line, 'scale'> {
  // The spaces at the ends of a run are runs of their own, so reversing the runs of a right-to-left line keeps them between
  // the words they separated; the words inside a Latin run keep their order.
  const logical = text
    .split(ARABIC_RUN)
    .flatMap((run) => (run.match(/^(\s*)([\s\S]*?)(\s*)$/) ?? ['', '', run, '']).slice(1))
    .filter((run) => run !== '');
  const rtl = ARABIC_RUN.test(text);
  const shaped = logical.map((run) => ({ run, ...frameTextPath(run, size) }));
  const visual = rtl ? [...shaped].reverse() : shaped;
  let x = 0;
  const parts = visual.map((entry) => {
    const part = `<path transform="translate(${x} 0)" d="${entry.path}"/>`;
    x += entry.width;
    return part;
  });
  return { markup: parts.join(''), width: x, height: Math.max(0, ...shaped.map((entry) => entry.height)) };
}

/** The text on at most `maxLines` lines, broken between words; a line still too wide is scaled down to fit. */
function setText(text: string, size: number, maxLines: number): Line[] {
  const words = text.replace(DIRECTION_MARKS, '').replace(/ /g, ' ').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (current && shapeLine(next, size).width > MAX_TEXT && lines.length < maxLines - 1) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  lines.push(current);
  return lines.map((line) => {
    const shaped = shapeLine(line, size);
    return { ...shaped, scale: Math.min(1, MAX_TEXT / shaped.width) };
  });
}

/** The card as PNG bytes. */
export async function renderDishCard(input: DishCardInput): Promise<Buffer> {
  const dark = DEFAULT_PALETTES.dark;
  const bg = safe(input.palette.bg, dark.bg);
  const surface = safe(input.palette.surface, dark.surface);
  const accent = safe(input.palette.accent, dark.accent);
  const text = safe(input.palette.text, dark.text);
  const muted = safe(input.palette.muted, dark.muted);

  const parts: string[] = [`<rect width="${CARD.width}" height="${CARD.height}" fill="${bg}"/>`, `<rect width="${CARD.width}" height="${CARD.photo}" fill="${surface}"/>`];
  let y = CARD.photo + 70;
  const place = (lines: Line[], color: string, gap: number) => {
    for (const line of lines) {
      const width = line.width * line.scale;
      parts.push(`<g fill="${color}" transform="translate(${(CARD.width - width) / 2} ${y}) scale(${line.scale})">${line.markup}</g>`);
      y += line.height * line.scale + gap;
    }
  };

  parts.push(`<rect x="${(CARD.width - 120) / 2}" y="${CARD.photo + 30}" width="120" height="6" rx="3" fill="${accent}"/>`);
  place(setText(input.name, 76, 2), text, 12);
  y += 10;
  place(setText(input.price, 60, 1), accent, 0);
  y = CARD.height - 100;
  place(setText(input.restaurant, 40, 1), muted, 0);

  const base = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${CARD.width}" height="${CARD.height}" viewBox="0 0 ${CARD.width} ${CARD.height}">${parts.join('')}</svg>`)).png().toBuffer();
  if (!input.photo) return base;
  const photo = await sharp(input.photo).rotate().resize(CARD.width, CARD.photo, { fit: 'cover' }).png().toBuffer();
  return sharp(base).composite([{ input: photo, left: 0, top: 0 }]).png().toBuffer();
}
