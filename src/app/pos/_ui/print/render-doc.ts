import type { PaperDoc } from '@/server/domain/pos/paper';

export interface Rendered {
  rgba: Uint8ClampedArray;
  width: number;
  height: number;
}

const BASE = 24;
const PAD = 8;

/**
 * Draws the rows on a canvas, black on white. The browser's own text engine shapes Arabic and Kurdish and orders the
 * numbers inside a line, which is why the paper is a picture and not a code page. The only file of the print path that
 * needs a DOM.
 */
export function renderDoc(doc: PaperDoc, widthDots: number, dir: 'rtl' | 'ltr', font: string): Rendered {
  const rowHeight = (size: 1 | 2) => Math.round(BASE * size * 1.45);
  let height = PAD * 2;
  for (const row of doc.rows) height += row.kind === 'text' ? rowHeight(row.size ?? 1) : row.kind === 'rule' ? 14 : row.kind === 'gap' ? 24 : 72;

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
  for (const row of doc.rows) {
    if (row.kind === 'text') {
      const size = row.size ?? 1;
      ctx.font = `${row.bold ? '700 ' : ''}${BASE * size}px ${font}`;
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
