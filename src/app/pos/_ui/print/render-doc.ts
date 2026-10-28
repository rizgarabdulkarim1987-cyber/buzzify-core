import type { PaperDoc, PaperRow } from '@/server/domain/pos/paper';

export interface Rendered {
  rgba: Uint8ClampedArray;
  width: number;
  height: number;
}

const BASE = 24;
const PAD = 8;

/** The width of a text in dots, in the row's font size and weight. */
export type Measure = (text: string, size: 1 | 2, bold: boolean) => number;

/**
 * Splits a line to fit `maxWidth`: at spaces where it can, inside a word wider than the line at the last character that
 * fits (whole code points, so a surrogate pair is never cut). Pieces keep the text's logical order, so right-to-left
 * lines are shaped by the canvas one piece at a time.
 */
export function wrapRow(text: string, maxWidth: number, measure: (s: string) => number): string[] {
  if (measure(text) <= maxWidth) return [text];
  const lines: string[] = [];
  let line = '';
  const push = (piece: string) => {
    lines.push(piece);
    line = '';
  };
  for (const word of text.split(' ')) {
    const joined = line === '' ? word : `${line} ${word}`;
    if (measure(joined) <= maxWidth) {
      line = joined;
      continue;
    }
    if (line !== '') push(line);
    if (measure(word) <= maxWidth) {
      line = word;
      continue;
    }
    // A word wider than the line: fill lines character by character.
    let piece = '';
    for (const char of Array.from(word)) {
      if (piece !== '' && measure(piece + char) > maxWidth) {
        lines.push(piece);
        piece = '';
      }
      piece += char;
    }
    line = piece;
  }
  if (line !== '') lines.push(line);
  return lines;
}

/**
 * Expands text rows so none is wider than its space. The right-hand column (a price) is reserved first and stays on the
 * first line; the rest of the text wraps under itself.
 */
export function layoutRows(rows: PaperRow[], widthDots: number, measure: Measure): PaperRow[] {
  const usable = widthDots - PAD * 2;
  return rows.flatMap((row): PaperRow[] => {
    if (row.kind !== 'text') return [row];
    const size = row.size ?? 1;
    const bold = row.bold ?? false;
    const fit = (s: string) => measure(s, size, bold);
    const rightWidth = row.right ? fit(row.right) + 12 : 0;
    const room = Math.max(usable - rightWidth, 40);
    // A word wider than the room beside the price would be cut inside, which breaks Arabic and Kurdish letter joins: give the
    // text the full width instead and keep the price on the last line, or on a line of its own when it does not fit there.
    if (row.right && row.left.split(' ').some((word) => fit(word) > room)) {
      const lines = wrapRow(row.left, usable, fit);
      const last = lines[lines.length - 1] ?? '';
      const own = fit(last) + rightWidth > usable;
      const out = lines.map((left, index) => ({ ...row, left, right: !own && index === lines.length - 1 ? row.right : undefined }));
      return own ? [...out, { ...row, left: '', right: row.right }] : out;
    }
    const lines = wrapRow(row.left, room, fit);
    if (lines.length <= 1) return [row];
    return lines.map((left, index) => ({ ...row, left, right: index === 0 ? row.right : undefined }));
  });
}

/**
 * Draws the rows on a canvas, black on white. The browser's own text engine shapes Arabic and Kurdish and orders the
 * numbers inside a line, which is why the paper is a picture and not a code page. The only file of the print path that
 * needs a DOM.
 */
export function renderDoc(doc: PaperDoc, widthDots: number, dir: 'rtl' | 'ltr', font: string): Rendered {
  const fontOf = (size: 1 | 2, bold: boolean) => `${bold ? '700 ' : ''}${BASE * size}px ${font}`;
  const probe = new OffscreenCanvas(1, 1).getContext('2d');
  if (!probe) throw new Error('canvas unavailable');
  probe.direction = dir;
  const rows = layoutRows(doc.rows, widthDots, (text, size, bold) => {
    probe.font = fontOf(size, bold);
    return probe.measureText(text).width;
  });
  const rowHeight = (size: 1 | 2) => Math.round(BASE * size * 1.45);
  let height = PAD * 2;
  for (const row of rows) height += row.kind === 'text' ? rowHeight(row.size ?? 1) : row.kind === 'rule' ? 14 : row.kind === 'gap' ? 24 : 72;

  const canvas = new OffscreenCanvas(widthDots, Math.max(height, 8));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas unavailable');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#000000';
  ctx.textBaseline = 'middle';
  ctx.direction = dir;
  const startX = dir === 'rtl' ? widthDots - PAD : PAD;
  const endX = dir === 'rtl' ? PAD : widthDots - PAD;

  let y = PAD;
  for (const row of rows) {
    if (row.kind === 'text') {
      const size = row.size ?? 1;
      ctx.font = fontOf(size, row.bold ?? false);
      const middle = y + rowHeight(size) / 2;
      if (row.align === 'center') {
        ctx.textAlign = 'center';
        ctx.fillText(row.left, widthDots / 2, middle, widthDots - PAD * 2);
      } else {
        ctx.textAlign = dir === 'rtl' ? 'right' : 'left';
        const room = row.right ? widthDots - PAD * 2 - ctx.measureText(row.right).width - 12 : widthDots - PAD * 2;
        ctx.fillText(row.left, row.align === 'end' ? endX : startX, middle, Math.max(room, 40));
        if (row.right) {
          ctx.textAlign = dir === 'rtl' ? 'left' : 'right';
          ctx.fillText(row.right, endX, middle);
        }
      }
      y += rowHeight(size);
    } else if (row.kind === 'rule') {
      ctx.fillRect(PAD, y + 6, widthDots - PAD * 2, 2);
      y += 14;
    } else if (row.kind === 'gap') {
      y += 24;
    } else {
      ctx.font = `${BASE}px monospace`;
      ctx.textAlign = 'center';
      ctx.fillText(row.value, widthDots / 2, y + 36);
      y += 72;
    }
  }
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return { rgba: image.data, width: canvas.width, height: canvas.height };
}
